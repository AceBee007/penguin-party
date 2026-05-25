import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const HOST = process.env.SIGNALING_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SIGNALING_PORT ?? 8787);
const MAX_PLAYERS = 6;

/** @type {Map<string, RoomRecord>} */
const rooms = new Map();
/** @type {Map<string, WebSocket>} */
const socketsByPeerId = new Map();

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
    const peer = room?.peers.get(session.peerId);

    socketsByPeerId.delete(session.peerId);

    if (room && peer) {
      peer.connectionStatus = 'disconnected';
      broadcastToRoom(room, session.peerId, { type: 'peer_left', peerId: session.peerId });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Penguin Party signaling server listening on http://${HOST}:${PORT}`);
});

async function routeHttp(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

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
      rooms: [...rooms.values()].filter((room) => room.status !== 'closed').map(buildRoomMetadata),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/rooms') {
    const body = await readJsonBody(request);
    const roomName = sanitizeName(body.roomName, 'Penguin Room', 32);
    const hostDisplayName = sanitizeName(body.hostDisplayName, 'Peer A', 16);
    const visibility = body.visibility === 'private' ? 'private' : 'public';
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
      visibility,
      createdAt: now,
      updatedAt: now,
      hostPeerId: peer.peerId,
      maxPlayers: MAX_PLAYERS,
      status: 'lobby',
      passwordRecord: visibility === 'private' ? createPasswordRecord(String(body.password ?? '')) : null,
      peers: new Map([[peer.peerId, peer]]),
      nextPlayerNumber: 2,
    };

    rooms.set(roomId, room);
    writeJson(response, 201, {
      room: buildRoomMetadata(room),
      peerId: peer.peerId,
      playerId: peer.playerId,
      reconnectToken: peer.reconnectToken,
      signalingToken: peer.signalingToken,
      existingPeers: [],
      role: peer.role,
    });
    return;
  }

  const joinMatch = /^\/rooms\/([^/]+)\/join$/.exec(url.pathname);

  if (request.method === 'POST' && joinMatch) {
    const room = rooms.get(joinMatch[1]);

    if (!room || room.status === 'closed') {
      writeJoinError(response, { code: 'room_not_found', message: 'Room was not found.' });
      return;
    }

    const body = await readJsonBody(request);

    if (room.visibility === 'private' && !verifyPassword(room.passwordRecord, String(body.password ?? ''))) {
      writeJoinError(response, { code: 'invalid_password', message: 'Invalid room password.' });
      return;
    }

    const playerCount = [...room.peers.values()].filter((peer) => peer.role !== 'spectator').length;

    if (room.status === 'lobby' && playerCount >= room.maxPlayers) {
      writeJoinError(response, { code: 'room_full', message: 'Room is full.' });
      return;
    }

    const role = room.status === 'playing' ? 'spectator' : 'player';
    const peer = createPeer({
      displayName: sanitizeName(body.displayName, `Peer ${room.nextPlayerNumber}`, 16),
      joinedAt: Date.now(),
      peerId: createId('peer'),
      playerId: role === 'spectator' ? null : `player-${room.nextPlayerNumber}`,
      role,
    });
    const existingPeers = [...room.peers.values()].map(toPeerSummary);

    room.nextPlayerNumber += role === 'spectator' ? 0 : 1;
    room.peers.set(peer.peerId, peer);
    room.updatedAt = Date.now();

    writeJson(response, 200, {
      room: buildRoomMetadata(room),
      peerId: peer.peerId,
      playerId: peer.playerId,
      reconnectToken: peer.reconnectToken,
      signalingToken: peer.signalingToken,
      existingPeers,
      role,
    });
    return;
  }

  const statusMatch = /^\/rooms\/([^/]+)\/status$/.exec(url.pathname);

  if (request.method === 'POST' && statusMatch) {
    const room = rooms.get(statusMatch[1]);
    const body = await readJsonBody(request);

    if (!room) {
      writeJson(response, 404, { code: 'room_not_found', message: 'Room was not found.' });
      return;
    }

    if (body.status === 'lobby' || body.status === 'playing' || body.status === 'closed') {
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
    visibility: room.visibility,
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
 * @property {'public' | 'private'} visibility
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} hostPeerId
 * @property {number} maxPlayers
 * @property {'lobby' | 'playing' | 'closed'} status
 * @property {{ salt: string; hash: string } | null} passwordRecord
 * @property {Map<string, ReturnType<typeof createPeer>>} peers
 * @property {number} nextPlayerNumber
 */
