import type { CardId, GameEvent, GameSessionState, MoveTarget, PlayerId } from '../game/types';

export type RoomStatus = 'waiting_for_start' | 'playing';
export type PeerRole = 'host' | 'player' | 'spectator';
export type PeerConnectionStatus = 'new' | 'signaling' | 'connecting' | 'connected' | 'disconnected' | 'closed';

export interface RoomMetadata {
  roomId: string;
  roomName: string;
  createdAt: number;
  updatedAt: number;
  hostPeerId: string;
  currentPlayerCount: number;
  currentSpectatorCount: number;
  maxPlayers: 6;
  status: RoomStatus;
  hasPassword: boolean;
}

export interface PeerSummary {
  peerId: string;
  playerId: PlayerId | null;
  displayName: string;
  joinedAt: number;
  role: PeerRole;
}

export interface NetworkIdentity {
  room: RoomMetadata;
  peerId: string;
  playerId: PlayerId | null;
  role: PeerRole;
  joinedAt: number;
  reconnectToken: string;
  rejoinCode?: string;
  signalingToken: string;
  existingPeers: PeerSummary[];
  displayName: string;
}

export interface CreateRoomRequest {
  roomName: string;
  hostDisplayName: string;
  password?: string;
  maxPlayers: 6;
}

export interface JoinRoomRequest {
  displayName: string;
  password?: string;
}

export interface ResumeGameRequest {
  rejoinCode: string;
}

export interface CreateRoomResponse extends Omit<NetworkIdentity, 'displayName'> {}
export interface JoinRoomResponse extends Omit<NetworkIdentity, 'displayName'> {}
export interface ResumeGameResponse extends NetworkIdentity {}

export type SignalingClientMessage =
  | { type: 'hello'; roomId: string; peerId: string; signalingToken: string }
  | { type: 'offer'; toPeerId: string; description: RTCSessionDescriptionInit }
  | { type: 'answer'; toPeerId: string; description: RTCSessionDescriptionInit }
  | { type: 'ice_candidate'; toPeerId: string; candidate: RTCIceCandidateInit }
  | { type: 'leave_room' };

export type SignalingServerMessage =
  | { type: 'hello_ok'; room: RoomMetadata; peers: PeerSummary[] }
  | { type: 'peer_joined'; peer: PeerSummary }
  | { type: 'peer_disconnected'; peerId: string }
  | { type: 'peer_left'; peerId: string }
  | { type: 'offer'; fromPeerId: string; description: RTCSessionDescriptionInit }
  | { type: 'answer'; fromPeerId: string; description: RTCSessionDescriptionInit }
  | { type: 'ice_candidate'; fromPeerId: string; candidate: RTCIceCandidateInit }
  | { type: 'room_closed'; reason: string }
  | { type: 'error'; code: string; message: string };

export interface P2PEnvelope<TPayload extends P2PGamePayload = P2PGamePayload> {
  protocolVersion: 1;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  hostPeerId: string;
  hostEpoch: number;
  messageId: string;
  sentAt: number;
  payload: TPayload;
}

export type P2PGamePayload =
  | HostHello
  | PeerReady
  | PlayerCommand
  | CommandRejected
  | EventCommitted
  | Heartbeat;

export interface HostHello {
  type: 'host_hello';
  currentHostPeerId: string;
  hostEpoch: number;
  playerIdByPeerId: Record<string, PlayerId | null>;
  roleByPeerId: Record<string, PeerRole>;
  snapshot: GameSessionState;
}

export interface PeerReady {
  type: 'peer_ready';
  playerId: PlayerId | null;
  role: PeerRole;
  ready: boolean;
  stateRevision: number;
  stateHash: string;
}

export interface PlayerCommand {
  type: 'player_command';
  commandId: string;
  playerId: PlayerId;
  command: { type: 'play_card'; cardId: CardId; target: MoveTarget };
  clientRevision: number;
  clientSentAt: number;
}

export interface CommandRejected {
  type: 'command_rejected';
  commandId: string;
  reason: 'not_current_host' | 'not_your_turn' | 'illegal_move' | 'stale_revision' | 'unknown_player';
  expectedRevision: number;
}

export interface EventCommitted {
  type: 'event_committed';
  event: GameEvent;
  eventSeq: number;
  revision: number;
  stateHash: string;
  snapshot: GameSessionState;
}

export interface Heartbeat {
  type: 'heartbeat';
  hostPeerId: string;
  hostEpoch: number;
  revision: number;
  eventSeq: number;
  stateHash: string;
  snapshot?: GameSessionState;
}

export interface PeerRuntimeView {
  peerId: string;
  playerId: PlayerId | null;
  displayName: string;
  role: PeerRole;
  connectionStatus: PeerConnectionStatus;
}
