import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const HOST = process.env.SIGNALING_HOST?.trim() || '0.0.0.0';
const PORT = readPort(process.env.SIGNALING_PORT, 15201);
const MAX_PLAYERS = 6;
const REJOIN_TTL_MS = 30 * 60 * 1000;
const LOBBY_RESERVATION_TTL_MS = 30 * 1000;

/** @type {Map<string, RoomRecord>} */
const rooms = new Map();
/** @type {Map<string, WebSocket>} */
const socketsByPeerId = new Map();
/** @type {Map<string, LobbyNameReservation>} */
const lobbyNameReservations = new Map();

const server = http.createServer(async (request, response) => {
  try {
    await routeHttp(request, response);
  } catch (error) {
    writeJson(response, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

const wss = new WebSocketServer({ server, path: '/signaling' });

wss.on('connection', (socket) => {
  /** @type {{ roomId: string; peerId: string } | null} */
  let session = null;

  socket.on('message', (raw) => {
    const parsed = parseJson(raw.toString());

    if (!parsed || typeof parsed.type !== 'string') {
      sendSocket(socket, { type: 'error', code: 'invalid_message', message: 'Message must be JSON.' });
      return;
    }

    if (parsed.type === 'hello') {
      const room = rooms.get(parsed.roomId);
      const peer = room?.peers.get(parsed.peerId);

      if (!room || !peer || peer.signalingToken !== parsed.signalingToken) {
        sendSocket(socket, { type: 'error', code: 'unauthorized', message: 'Invalid signaling token.' });
        socket.close();
        return;
      }

      session = { roomId: room.roomId, peerId: peer.peerId };
      peer.connectionStatus = 'connected';
      peer.wsConnectedAt = Date.now();
      socketsByPeerId.set(peer.peerId, socket);

      sendSocket(socket, {
        type: 'hello_ok',
        room: buildRoomMetadata(room),
        peers: [...room.peers.values()].map(toPeerSummary).filter((candidate) => candidate.peerId !== peer.peerId),
      });
      broadcastToRoom(room, peer.peerId, { type: 'peer_joined', peer: toPeerSummary(peer) });
      return;
    }

    if (!session) {
      sendSocket(socket, { type: 'error', code: 'hello_required', message: 'Send hello first.' });
      return;
    }

    const room = rooms.get(session.roomId);

    if (!room) {
      sendSocket(socket, { type: 'room_closed', reason: 'Room no longer exists.' });
      socket.close();
      return;
    }

    if (parsed.type === 'offer' || parsed.type === 'answer' || parsed.type === 'ice_candidate') {
      const target = socketsByPeerId.get(parsed.toPeerId);

      if (!target || target.readyState !== WebSocket.OPEN) {
        sendSocket(socket, { type: 'error', code: 'peer_unavailable', message: 'Target peer is not connected.' });
        return;
      }

      if (parsed.type === 'ice_candidate') {
        sendSocket(target, {
          type: parsed.type,
          fromPeerId: session.peerId,
          candidate: parsed.candidate,
        });
      } else {
        sendSocket(target, {
          type: parsed.type,
          fromPeerId: session.peerId,
          description: parsed.description,
        });
      }
      return;
    }

    if (parsed.type === 'leave_room') {
      socket.close();
      return;
    }

    sendSocket(socket, { type: 'error', code: 'unknown_message', message: `Unsupported message: ${parsed.type}` });
  });

  socket.on('close', () => {
    if (!session) {
      return;
    }

    const room = rooms.get(session.roomId);

    socketsByPeerId.delete(session.peerId);

    if (room) {
      handlePeerDisconnected(room, session.peerId);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Penguin Party signaling server listening on http://${HOST}:${PORT}`);
});

function readPort(raw, fallback) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  if (!trimmed) {
    return fallback;
  }

  const port = Number(trimmed);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

async function routeHttp(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  cleanupLobbyNameReservations();

  if (request.method === 'OPTIONS') {
    writeCors(response, 204);
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/rooms') {
    writeJson(response, 200, {
      rooms: [...rooms.values()].filter(hasConnectedPeer).map(buildRoomMetadata),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/players/name-check') {
    const body = await readJsonBody(request);
    const displayName = sanitizeName(body.displayName, '', 16);
    const existingReservationToken = String(body.nameReservationToken ?? '').trim();

    if (!displayName) {
      writeJson(response, 200, { code: 'invalid_name', message: 'Player name is required.' });
      return;
    }

    if (isDisplayNameOnline(displayName, existingReservationToken || null)) {
      writeJson(response, 200, { code: 'duplicate_online_name', message: 'Player name is already online.' });
      return;
    }

    const now = Date.now();
    const nameReservationToken = existingReservationToken || createId('lobby-name');
    const expiresAt = now + LOBBY_RESERVATION_TTL_MS;

    lobbyNameReservations.set(nameReservationToken, {
      displayName,
      expiresAt,
      normalizedDisplayName: normalizeDisplayName(displayName),
    });

    writeJson(response, 200, { ok: true, displayName, expiresAt, nameReservationToken });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/players/name-release') {
    const body = await readJsonBody(request);
    const nameReservationToken = String(body.nameReservationToken ?? '').trim();

    if (nameReservationToken) {
      lobbyNameReservations.delete(nameReservationToken);
    }

    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/rooms') {
    const body = await readJsonBody(request);
    const roomName = sanitizeName(body.roomName, 'Penguin Room', 32);
    const hostDisplayName = sanitizeName(body.hostDisplayName, 'Peer A', 16);
    const nameReservationToken = String(body.nameReservationToken ?? '').trim();
    const password = String(body.password ?? '').trim();

    if (isDisplayNameOnline(hostDisplayName, nameReservationToken || null)) {
      writeJson(response, 200, { code: 'duplicate_online_name', message: 'Player name is already online.' });
      return;
    }

    const roomId = createRoomId();
    const now = Date.now();
    const peer = createPeer({
      displayName: hostDisplayName,
      joinedAt: now,
      peerId: createId('peer'),
      playerId: 'player-1',
      role: 'host',
    });
    const room = {
      roomId,
      roomName,
      createdAt: now,
      updatedAt: now,
      hostPeerId: peer.peerId,
      maxPlayers: MAX_PLAYERS,
      status: 'waiting_for_start',
      passwordRecord: password ? createPasswordRecord(password) : null,
      peers: new Map([[peer.peerId, peer]]),
      nextPlayerNumber: 2,
    };

    rooms.set(roomId, room);
    consumeLobbyNameReservation(nameReservationToken);
    writeJson(response, 201, {
      room: buildRoomMetadata(room),
      peerId: peer.peerId,
      playerId: peer.playerId,
      reconnectToken: peer.reconnectToken,
      rejoinCode: peer.rejoinCode ?? undefined,
      signalingToken: peer.signalingToken,
      existingPeers: [],
      role: peer.role,
    });
    return;
  }

  const joinMatch = /^\/rooms\/([^/]+)\/join$/.exec(url.pathname);

  if (request.method === 'POST' && joinMatch) {
    const room = rooms.get(joinMatch[1]);

    if (!room) {
      writeJoinError(response, { code: 'room_closed', message: 'Room is no longer available.' });
      return;
    }

    const body = await readJsonBody(request);
    const password = String(body.password ?? '').trim();
    const displayName = sanitizeName(body.displayName, `Peer ${room.nextPlayerNumber}`, 16);
    const nameReservationToken = String(body.nameReservationToken ?? '').trim();

    if (room.passwordRecord && !password) {
      writeJoinError(response, { code: 'password_required', message: 'Room password is required.' });
      return;
    }

    if (room.passwordRecord && !verifyPassword(room.passwordRecord, password)) {
      writeJoinError(response, { code: 'invalid_password', message: 'Invalid room password.' });
      return;
    }

    const playerCount = [...room.peers.values()].filter((peer) => peer.role !== 'spectator').length;

    if (room.status === 'waiting_for_start' && playerCount >= room.maxPlayers) {
      writeJoinError(response, { code: 'room_full', message: 'Room is full.' });
      return;
    }

    if (isDisplayNameOnline(displayName, nameReservationToken || null)) {
      writeJoinError(response, { code: 'duplicate_online_name', message: 'Player name is already online.' });
      return;
    }

    const role = room.status === 'playing' ? 'spectator' : 'player';
    const peer = createPeer({
      displayName,
      joinedAt: Date.now(),
      peerId: createId('peer'),
      playerId: role === 'spectator' ? null : `player-${room.nextPlayerNumber}`,
      role,
    });
    const existingPeers = [...room.peers.values()].map(toPeerSummary);

    room.nextPlayerNumber += role === 'spectator' ? 0 : 1;
    room.peers.set(peer.peerId, peer);
    room.updatedAt = Date.now();
    consumeLobbyNameReservation(nameReservationToken);

    writeJson(response, 200, {
      room: buildRoomMetadata(room),
      peerId: peer.peerId,
      playerId: peer.playerId,
      reconnectToken: peer.reconnectToken,
      rejoinCode: peer.rejoinCode ?? undefined,
      signalingToken: peer.signalingToken,
      existingPeers,
      role,
    });
    return;
  }

  const rejoinCodeMatch = /^\/rooms\/([^/]+)\/rejoin-code$/.exec(url.pathname);

  if (request.method === 'POST' && rejoinCodeMatch) {
    cleanupExpiredRejoinCodes();
    const room = rooms.get(rejoinCodeMatch[1]);
    const body = await readJsonBody(request);
    const peerId = String(body.peerId ?? '').trim();
    const signalingToken = String(body.signalingToken ?? '').trim();
    const peer = room?.peers.get(peerId);

    if (!room || !peer || peer.signalingToken !== signalingToken || room.status !== 'playing' || peer.role === 'spectator') {
      writeJoinError(response, { code: 'invalid_rejoin_code', message: 'このrejoin codeは無効' });
      return;
    }

    issueGameRejoinCode(peer);
    room.updatedAt = Date.now();

    writeJson(response, 200, {
      rejoinCode: peer.rejoinCode,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/rejoin/status') {
    cleanupExpiredRejoinCodes();
    const body = await readJsonBody(request);
    const rejoinCode = String(body.rejoinCode ?? '').trim();
    const match = findPeerByRejoinCode(rejoinCode);
    const valid = Boolean(match && isRejoinCodeLive(match.room, match.peer));

    writeJson(response, 200, { valid });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/rejoin') {
    cleanupExpiredRejoinCodes();
    const body = await readJsonBody(request);
    const rejoinCode = String(body.rejoinCode ?? '').trim();
    const match = findPeerByRejoinCode(rejoinCode);

    if (!match) {
      writeJoinError(response, { code: 'invalid_rejoin_code', message: 'このrejoin codeは無効' });
      return;
    }

    const { room, peer } = match;

    if (!isRejoinCodeLive(room, peer)) {
      clearPeerRejoinCode(peer);
      writeJoinError(response, { code: 'invalid_rejoin_code', message: 'このrejoin codeは無効' });
      return;
    }

    const oldSocket = socketsByPeerId.get(peer.peerId);

    if (oldSocket?.readyState === WebSocket.OPEN) {
      writeJoinError(response, { code: 'invalid_rejoin_code', message: 'このrejoin codeは無効' });
      return;
    }

    if (peer.connectionStatus !== 'disconnected') {
      writeJoinError(response, { code: 'invalid_rejoin_code', message: 'このrejoin codeは無効' });
      return;
    }

    peer.signalingToken = createId('signal');
    peer.reconnectToken = createId('reconnect');
    peer.connectionStatus = 'new';
    peer.wsConnectedAt = null;
    room.updatedAt = Date.now();

    writeJson(response, 200, {
      room: buildRoomMetadata(room),
      peerId: peer.peerId,
      playerId: peer.playerId,
      reconnectToken: peer.reconnectToken,
      rejoinCode: peer.rejoinCode ?? undefined,
      signalingToken: peer.signalingToken,
      existingPeers: [...room.peers.values()].map(toPeerSummary).filter((candidate) => candidate.peerId !== peer.peerId),
      role: peer.role,
      joinedAt: peer.joinedAt,
      displayName: peer.displayName,
    });
    return;
  }

  const invalidateRejoinCodesMatch = /^\/rooms\/([^/]+)\/rejoin-codes\/invalidate$/.exec(url.pathname);

  if (request.method === 'POST' && invalidateRejoinCodesMatch) {
    cleanupExpiredRejoinCodes();
    const room = rooms.get(invalidateRejoinCodesMatch[1]);
    const body = await readJsonBody(request);
    const peerId = String(body.peerId ?? '').trim();
    const signalingToken = String(body.signalingToken ?? '').trim();
    const peer = room?.peers.get(peerId);

    if (!room || !peer || room.hostPeerId !== peerId || peer.signalingToken !== signalingToken) {
      writeJson(response, 403, { code: 'unauthorized', message: 'Only the current host can end re-join access.' });
      return;
    }

    invalidateRoomRejoinCodes(room);
    room.updatedAt = Date.now();
    writeJson(response, 200, { ok: true });
    return;
  }

  const statusMatch = /^\/rooms\/([^/]+)\/status$/.exec(url.pathname);

  if (request.method === 'POST' && statusMatch) {
    const room = rooms.get(statusMatch[1]);
    const body = await readJsonBody(request);

    if (!room) {
      writeJson(response, 404, { code: 'room_closed', message: 'Room is no longer available.' });
      return;
    }

    if (body.status === 'playing') {
      invalidateRoomRejoinCodes(room);
    }

    if (body.status === 'waiting_for_start') {
      invalidateRoomRejoinCodes(room);
    }

    if (body.status === 'waiting_for_start' || body.status === 'playing') {
      room.status = body.status;
      room.updatedAt = Date.now();
      writeJson(response, 200, { room: buildRoomMetadata(room) });
      return;
    }

    writeJson(response, 400, { code: 'invalid_status', message: 'Unsupported room status.' });
    return;
  }

  writeJson(response, 404, { code: 'not_found', message: 'Endpoint not found.' });
}

function writeJoinError(response, payload) {
  writeJson(response, 200, payload);
}

function createPeer({ displayName, joinedAt, peerId, playerId, role }) {
  return {
    peerId,
    playerId,
    displayName,
    joinedAt,
    role,
    reconnectToken: createId('reconnect'),
    rejoinCode: null,
    signalingToken: createId('signal'),
    connectionStatus: 'new',
    wsConnectedAt: null,
  };
}

function buildRoomMetadata(room) {
  const peers = [...room.peers.values()];

  return {
    roomId: room.roomId,
    roomName: room.roomName,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    hostPeerId: room.hostPeerId,
    currentPlayerCount: peers.filter((peer) => peer.role !== 'spectator').length,
    currentSpectatorCount: peers.filter((peer) => peer.role === 'spectator').length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    hasPassword: Boolean(room.passwordRecord),
  };
}

function handlePeerDisconnected(room, peerId) {
  const peer = room.peers.get(peerId);

  if (!peer) {
    return;
  }

  if (room.status === 'playing') {
    peer.connectionStatus = 'disconnected';
    peer.wsConnectedAt = null;
    room.updatedAt = Date.now();

    const wasHost = room.hostPeerId === peerId;

    if (wasHost) {
      const nextHost = [...room.peers.values()].find(
        (candidate) => candidate.peerId !== peerId && candidate.role !== 'spectator' && candidate.connectionStatus !== 'disconnected',
      );

      if (nextHost) {
        peer.role = peer.playerId ? 'player' : peer.role;
        room.hostPeerId = nextHost.peerId;
        nextHost.role = 'host';
      }
    }

    if (!hasConnectedPeer(room)) {
      rooms.delete(room.roomId);
      return;
    }

    broadcastToRoom(room, peerId, { type: wasHost ? 'peer_left' : 'peer_disconnected', peerId });
    return;
  }

  removePeerFromRoom(room, peerId);
}

function removePeerFromRoom(room, peerId) {
  const peer = room.peers.get(peerId);

  if (!peer) {
    return;
  }

  room.peers.delete(peerId);
  room.updatedAt = Date.now();

  if (room.peers.size === 0 || !hasConnectedPeer(room)) {
    rooms.delete(room.roomId);
    return;
  }

  if (room.hostPeerId === peerId) {
    const nextHost = [...room.peers.values()].find((candidate) => candidate.role !== 'spectator') ?? [...room.peers.values()][0];
    room.hostPeerId = nextHost.peerId;

    if (nextHost.role !== 'spectator') {
      nextHost.role = 'host';
    }
  }

  broadcastToRoom(room, peerId, { type: 'peer_left', peerId });
}

function hasConnectedPeer(room) {
  return [...room.peers.values()].some((peer) => socketsByPeerId.has(peer.peerId));
}

function isDisplayNameOnline(displayName, allowedReservationToken = null) {
  const normalized = normalizeDisplayName(displayName);

  const isReservedInLobby = [...lobbyNameReservations.entries()].some(
    ([token, reservation]) =>
      token !== allowedReservationToken && reservation.normalizedDisplayName === normalized,
  );

  if (isReservedInLobby) {
    return true;
  }

  return [...rooms.values()].some((room) =>
    [...room.peers.values()].some(
      (peer) => peer.connectionStatus !== 'disconnected' && normalizeDisplayName(peer.displayName) === normalized,
    ),
  );
}

function cleanupLobbyNameReservations() {
  const now = Date.now();

  for (const [token, reservation] of lobbyNameReservations.entries()) {
    if (reservation.expiresAt <= now) {
      lobbyNameReservations.delete(token);
    }
  }
}

function consumeLobbyNameReservation(nameReservationToken) {
  if (!nameReservationToken) {
    return;
  }

  lobbyNameReservations.delete(nameReservationToken);
}

function normalizeDisplayName(displayName) {
  return String(displayName ?? '').trim().toLocaleLowerCase();
}

function findPeerByRejoinCode(rejoinCode) {
  if (!rejoinCode) {
    return null;
  }

  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (peer.rejoinCode === rejoinCode) {
        return { room, peer };
      }
    }
  }

  return null;
}

function issueGameRejoinCode(peer) {
  if (peer.rejoinCode && getRejoinCodeExpiresAt(peer.rejoinCode) > Date.now()) {
    return;
  }

  peer.rejoinCode = createRejoinCode(Date.now() + REJOIN_TTL_MS);
}

function isRejoinCodeLive(room, peer) {
  const expiresAt = getRejoinCodeExpiresAt(peer.rejoinCode);

  return Boolean(
    room.status === 'playing' &&
      peer.rejoinCode &&
      expiresAt &&
      expiresAt > Date.now(),
  );
}

function cleanupExpiredRejoinCodes(now = Date.now()) {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (peer.rejoinCode && (getRejoinCodeExpiresAt(peer.rejoinCode) ?? 0) <= now) {
        clearPeerRejoinCode(peer);
      }
    }
  }
}

function invalidateRoomRejoinCodes(room) {
  for (const peer of room.peers.values()) {
    clearPeerRejoinCode(peer);
  }
}

function clearPeerRejoinCode(peer) {
  peer.rejoinCode = null;
}

function toPeerSummary(peer) {
  return {
    peerId: peer.peerId,
    playerId: peer.playerId,
    displayName: peer.displayName,
    joinedAt: peer.joinedAt,
    role: peer.role,
  };
}

function broadcastToRoom(room, exceptPeerId, message) {
  for (const peer of room.peers.values()) {
    if (peer.peerId === exceptPeerId) {
      continue;
    }

    const socket = socketsByPeerId.get(peer.peerId);

    if (socket?.readyState === WebSocket.OPEN) {
      sendSocket(socket, message);
    }
  }
}

function sendSocket(socket, message) {
  socket.send(JSON.stringify(message));
}

function writeJson(response, status, payload) {
  writeCors(response, status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function writeCors(response, status) {
  response.statusCode = status;
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitizeName(value, fallback, maxLength) {
  const trimmed = String(value ?? '').trim();
  return (trimmed || fallback).slice(0, maxLength);
}

function createRoomId() {
  let roomId = '';

  do {
    roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(roomId));

  return roomId;
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createRejoinCode(expiresAt) {
  return `${crypto.randomBytes(9).toString('base64url')}.${expiresAt.toString(36)}`;
}

function getRejoinCodeExpiresAt(rejoinCode) {
  const segments = String(rejoinCode ?? '').trim().split('.');

  if (segments.length !== 2 || !segments[0] || !/^[0-9a-z]+$/i.test(segments[1])) {
    return null;
  }

  const expiresAt = Number.parseInt(segments[1], 36);

  return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : null;
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');

  return { salt, hash };
}

function verifyPassword(record, password) {
  if (!record) {
    return true;
  }

  const hash = crypto.scryptSync(password, record.salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.hash, 'hex'));
}

/**
 * @typedef {object} RoomRecord
 * @property {string} roomId
 * @property {string} roomName
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} hostPeerId
 * @property {number} maxPlayers
 * @property {'waiting_for_start' | 'playing'} status
 * @property {{ salt: string; hash: string } | null} passwordRecord
 * @property {Map<string, ReturnType<typeof createPeer>>} peers
 * @property {number} nextPlayerNumber
 */

/**
 * @typedef {object} LobbyNameReservation
 * @property {string} displayName
 * @property {string} normalizedDisplayName
 * @property {number} expiresAt
 */
