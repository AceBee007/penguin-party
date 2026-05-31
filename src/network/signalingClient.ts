import type {
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  NetworkIdentity,
  PlayerNameReservation,
  ResumeGameRequest,
  ResumeGameResponse,
  RoomStatus,
  RoomMetadata,
  SignalingClientMessage,
  SignalingServerMessage,
} from './types';

const SIGNALING_SERVER_QUERY_PARAM = 'signaling-server';
const LEGACY_SIGNALING_SERVER_QUERY_PARAM = 'signal';
const FALLBACK_SIGNALING_HOST = '127.0.0.1';
const DEFAULT_SIGNALING_PORT = 15201;

export function getSignalingHttpUrl(): string {
  const fromQuery = getSignalingServerQueryValue();

  if (fromQuery) {
    try {
      return normalizeSignalingHttpUrl(fromQuery);
    } catch {
      return normalizeSignalingHttpUrl(buildDefaultSignalingUrl());
    }
  }

  return normalizeSignalingHttpUrl(buildDefaultSignalingUrl());
}

export function normalizeSignalingHttpUrl(rawUrl: string): string {
  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    throw new Error('Signaling server URL is required.');
  }

  const urlWithProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl) ? trimmedUrl : `http://${trimmedUrl}`;
  const url = new URL(urlWithProtocol);

  if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Signaling server URL must use http, https, ws, or wss.');
  }

  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

export function setSignalingServerQuery(httpUrl: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set(SIGNALING_SERVER_QUERY_PARAM, normalizeSignalingHttpUrl(httpUrl));
  pageUrl.searchParams.delete(LEGACY_SIGNALING_SERVER_QUERY_PARAM);
  window.history.replaceState(window.history.state, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}

export function getSignalingWsUrl(httpUrl = getSignalingHttpUrl()): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/signaling';
  return url.toString();
}

export async function listRooms(httpUrl = getSignalingHttpUrl()): Promise<RoomMetadata[]> {
  return fetchRooms(normalizeSignalingHttpUrl(httpUrl));
}

export async function checkSignalingServer(httpUrl = getSignalingHttpUrl()): Promise<void> {
  await fetchRooms(normalizeSignalingHttpUrl(httpUrl));
}

export async function createRoom(request: CreateRoomRequest, httpUrl = getSignalingHttpUrl()): Promise<NetworkIdentity> {
  const response = await fetch(`${httpUrl}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  const payload = (await response.json()) as CreateRoomResponse | { code: string; message: string };

  if (!response.ok || 'code' in payload) {
    throw new JoinRoomFailure(
      'code' in payload ? payload.code : 'create_failed',
      'message' in payload ? payload.message : `Room creation failed: ${response.status}`,
    );
  }

  return {
    ...payload,
    joinedAt: payload.room.createdAt,
    displayName: request.hostDisplayName,
  };
}

export async function validatePlayerName(
  displayName: string,
  nameReservationToken?: string,
  httpUrl = getSignalingHttpUrl(),
): Promise<PlayerNameReservation> {
  const response = await fetch(`${httpUrl}/players/name-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, nameReservationToken }),
  });
  const payload = (await response.json()) as
    | ({ ok: true } & PlayerNameReservation)
    | { code: string; message: string };

  if (!response.ok || 'code' in payload) {
    throw new JoinRoomFailure(
      'code' in payload ? payload.code : 'name_check_failed',
      'message' in payload ? payload.message : `Name check failed: ${response.status}`,
    );
  }

  return payload;
}

export async function releasePlayerNameReservation(
  nameReservationToken: string,
  httpUrl = getSignalingHttpUrl(),
): Promise<void> {
  await fetch(`${httpUrl}/players/name-release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nameReservationToken }),
  });
}

export async function resumeGame(request: ResumeGameRequest, httpUrl = getSignalingHttpUrl()): Promise<NetworkIdentity> {
  const response = await fetch(`${httpUrl}/rejoin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as ResumeGameResponse | { code: string; message: string };

  if (!response.ok || 'code' in payload) {
    throw new JoinRoomFailure(
      'code' in payload ? payload.code : 'rejoin_failed',
      'message' in payload ? payload.message : `Rejoin failed: ${response.status}`,
    );
  }

  return {
    ...payload,
    joinedAt: payload.joinedAt,
    displayName: payload.displayName,
  };
}

export async function joinRoom(
  roomId: string,
  request: JoinRoomRequest,
  httpUrl = getSignalingHttpUrl(),
): Promise<NetworkIdentity> {
  const response = await fetch(`${httpUrl}/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as JoinRoomResponse | { code: string; message: string };

  if (!response.ok || 'code' in payload) {
    throw new JoinRoomFailure(
      'code' in payload ? payload.code : 'join_failed',
      'message' in payload ? payload.message : `Join failed: ${response.status}`,
    );
  }

  return {
    ...payload,
    joinedAt: Date.now(),
    displayName: request.displayName,
  };
}

export class JoinRoomFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JoinRoomFailure';
  }
}

export async function markRoomPlaying(roomId: string, httpUrl = getSignalingHttpUrl()): Promise<void> {
  await updateRoomStatus(roomId, 'playing', httpUrl);
}

export async function markRoomWaitingForStart(roomId: string, httpUrl = getSignalingHttpUrl()): Promise<void> {
  await updateRoomStatus(roomId, 'waiting_for_start', httpUrl);
}

async function updateRoomStatus(roomId: string, status: RoomStatus, httpUrl = getSignalingHttpUrl()): Promise<void> {
  await fetch(`${httpUrl}/rooms/${roomId}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export class SignalingClient {
  private socket: WebSocket | null = null;

  constructor(
    private readonly identity: NetworkIdentity,
    private readonly onMessage: (message: SignalingServerMessage) => void,
    private readonly onStatus: (status: string) => void,
  ) {}

  connect(wsUrl = getSignalingWsUrl()): void {
    this.socket = new WebSocket(wsUrl);
    this.onStatus('signaling');
    this.socket.addEventListener('open', () => {
      this.send({
        type: 'hello',
        roomId: this.identity.room.roomId,
        peerId: this.identity.peerId,
        signalingToken: this.identity.signalingToken,
      });
    });
    this.socket.addEventListener('message', (event) => {
      const message = parseMessage(event.data);

      if (message) {
        this.onMessage(message);
      }
    });
    this.socket.addEventListener('close', () => {
      this.onStatus('closed');
    });
    this.socket.addEventListener('error', () => {
      this.onStatus('error');
    });
  }

  send(message: SignalingClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.send({ type: 'leave_room' });
    this.socket?.close();
    this.socket = null;
  }
}

function parseMessage(data: unknown): SignalingServerMessage | null {
  try {
    return JSON.parse(String(data)) as SignalingServerMessage;
  } catch {
    return null;
  }
}

function buildDefaultSignalingUrl(): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const host = import.meta.env.VITE_SIGNALING_HOST?.trim() || getDefaultSignalingHost();
  const port = readPort(import.meta.env.VITE_SIGNALING_PORT, DEFAULT_SIGNALING_PORT);

  return `http://${formatUrlHost(host)}:${port}`;
}

function getSignalingServerQueryValue(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get(SIGNALING_SERVER_QUERY_PARAM) ?? params.get(LEGACY_SIGNALING_SERVER_QUERY_PARAM);
}

function getDefaultSignalingHost(): string {
  if (typeof window === 'undefined') {
    return FALLBACK_SIGNALING_HOST;
  }

  return window.location.hostname || FALLBACK_SIGNALING_HOST;
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function readPort(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return fallback;
  }

  const port = Number(trimmed);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

async function fetchRooms(httpUrl: string): Promise<RoomMetadata[]> {
  const response = await fetch(`${httpUrl}/rooms`);

  if (!response.ok) {
    throw new Error(`Signaling server returned ${response.status}.`);
  }

  const payload = (await response.json()) as { rooms?: unknown };

  if (!Array.isArray(payload.rooms)) {
    throw new Error('Signaling server response is invalid.');
  }

  return payload.rooms as RoomMetadata[];
}
