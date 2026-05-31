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

const DEFAULT_SIGNALING_URL = 'http://127.0.0.1:8787';

export function getSignalingHttpUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('signal');
  return (fromQuery ?? DEFAULT_SIGNALING_URL).replace(/\/$/, '');
}

export function getSignalingWsUrl(httpUrl = getSignalingHttpUrl()): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/signaling';
  return url.toString();
}

export async function listRooms(httpUrl = getSignalingHttpUrl()): Promise<RoomMetadata[]> {
  const response = await fetch(`${httpUrl}/rooms`);
  const payload = (await response.json()) as { rooms: RoomMetadata[] };
  return payload.rooms;
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
