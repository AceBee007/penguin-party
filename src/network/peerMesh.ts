import { SignalingClient } from './signalingClient';
import type {
  NetworkIdentity,
  P2PEnvelope,
  P2PGamePayload,
  PeerConnectionStatus,
  PeerRuntimeView,
  PeerSummary,
  SignalingServerMessage,
} from './types';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ],
  iceCandidatePoolSize: 4,
};

interface PeerConnectionRecord {
  peer: PeerSummary;
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  status: PeerConnectionStatus;
  offered: boolean;
}

interface PeerMeshOptions {
  identity: NetworkIdentity;
  hostPeerId: string;
  onPeersChanged: (peers: PeerRuntimeView[]) => void;
  onPayload: (envelope: P2PEnvelope) => void;
  onChannelOpen: (peer: PeerSummary) => void;
  onStatus: (status: string) => void;
}

export class PeerMeshClient {
  private readonly peers = new Map<string, PeerSummary>();
  private readonly connections = new Map<string, PeerConnectionRecord>();
  private readonly signaling: SignalingClient;
  private hostEpoch = 1;

  constructor(private readonly options: PeerMeshOptions) {
    this.peers.set(options.identity.peerId, toLocalSummary(options.identity));
    this.signaling = new SignalingClient(
      options.identity,
      (message) => this.handleSignalingMessage(message),
      options.onStatus,
    );
  }

  connect(): void {
    this.signaling.connect();
  }

  close(): void {
    for (const record of this.connections.values()) {
      record.channel?.close();
      record.connection.close();
    }

    this.signaling.close();
    this.connections.clear();
    this.publishPeers();
  }

  getConnectedPeerCount(): number {
    return [...this.connections.values()].filter((record) => record.channel?.readyState === 'open').length;
  }

  sendPayload(toPeerId: string, payload: P2PGamePayload): void {
    const channel = this.connections.get(toPeerId)?.channel;

    if (!channel || channel.readyState !== 'open') {
      return;
    }

    const envelope: P2PEnvelope = {
      protocolVersion: 1,
      roomId: this.options.identity.room.roomId,
      fromPeerId: this.options.identity.peerId,
      toPeerId,
      hostPeerId: this.options.hostPeerId,
      hostEpoch: this.hostEpoch,
      messageId: createMessageId(),
      sentAt: Date.now(),
      payload,
    };

    channel.send(JSON.stringify(envelope));
  }

  broadcastPayload(payload: P2PGamePayload): void {
    for (const peerId of this.connections.keys()) {
      this.sendPayload(peerId, payload);
    }
  }

  private handleSignalingMessage(message: SignalingServerMessage): void {
    if (message.type === 'hello_ok') {
      for (const peer of message.peers) {
        this.peers.set(peer.peerId, peer);

        if (shouldCreateOffer(toLocalSummary(this.options.identity), peer)) {
          void this.ensureConnection(peer, true);
        }
      }

      this.publishPeers();
      return;
    }

    if (message.type === 'peer_joined') {
      this.peers.set(message.peer.peerId, message.peer);
      this.publishPeers();

      if (shouldCreateOffer(toLocalSummary(this.options.identity), message.peer)) {
        void this.ensureConnection(message.peer, true);
      }
      return;
    }

    if (message.type === 'peer_left') {
      this.connections.get(message.peerId)?.connection.close();
      this.connections.delete(message.peerId);
      this.peers.delete(message.peerId);
      this.publishPeers();
      return;
    }

    if (message.type === 'offer') {
      const peer = this.peers.get(message.fromPeerId);

      if (peer) {
        void this.acceptOffer(peer, message.description);
      }
      return;
    }

    if (message.type === 'answer') {
      void this.connections.get(message.fromPeerId)?.connection.setRemoteDescription(message.description);
      return;
    }

    if (message.type === 'ice_candidate') {
      void this.connections.get(message.fromPeerId)?.connection.addIceCandidate(message.candidate);
      return;
    }

    if (message.type === 'error') {
      this.options.onStatus(message.message);
    }
  }

  private async ensureConnection(peer: PeerSummary, createOffer: boolean): Promise<PeerConnectionRecord> {
    const existing = this.connections.get(peer.peerId);

    if (existing) {
      if (createOffer && !existing.offered) {
        await this.createOffer(peer, existing);
      }

      return existing;
    }

    const connection = new RTCPeerConnection(RTC_CONFIG);
    const record: PeerConnectionRecord = {
      peer,
      connection,
      channel: null,
      status: 'connecting',
      offered: false,
    };

    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice_candidate',
          toPeerId: peer.peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    });
    connection.addEventListener('connectionstatechange', () => {
      record.status = mapConnectionStatus(connection.connectionState);
      this.publishPeers();
    });
    connection.addEventListener('datachannel', (event) => {
      this.attachDataChannel(record, event.channel);
    });

    this.connections.set(peer.peerId, record);

    if (createOffer) {
      const channel = connection.createDataChannel('game', { ordered: true });
      this.attachDataChannel(record, channel);
      await this.createOffer(peer, record);
    }

    this.publishPeers();
    return record;
  }

  private async createOffer(peer: PeerSummary, record: PeerConnectionRecord): Promise<void> {
    record.offered = true;
    const offer = await record.connection.createOffer();
    await record.connection.setLocalDescription(offer);
    this.signaling.send({
      type: 'offer',
      toPeerId: peer.peerId,
      description: offer,
    });
  }

  private async acceptOffer(peer: PeerSummary, description: RTCSessionDescriptionInit): Promise<void> {
    const record = await this.ensureConnection(peer, false);
    await record.connection.setRemoteDescription(description);
    const answer = await record.connection.createAnswer();
    await record.connection.setLocalDescription(answer);
    this.signaling.send({
      type: 'answer',
      toPeerId: peer.peerId,
      description: answer,
    });
  }

  private attachDataChannel(record: PeerConnectionRecord, channel: RTCDataChannel): void {
    record.channel = channel;
    channel.addEventListener('open', () => {
      record.status = 'connected';
      this.publishPeers();
      this.options.onChannelOpen(record.peer);
    });
    channel.addEventListener('message', (event) => {
      const envelope = parseEnvelope(event.data);

      if (envelope?.roomId === this.options.identity.room.roomId && envelope.fromPeerId === record.peer.peerId) {
        this.options.onPayload(envelope);
      }
    });
    channel.addEventListener('close', () => {
      record.status = 'closed';
      this.publishPeers();
    });
    channel.addEventListener('error', () => {
      record.status = 'disconnected';
      this.publishPeers();
    });
  }

  private publishPeers(): void {
    const local = toLocalSummary(this.options.identity);
    const views: PeerRuntimeView[] = [local, ...this.peers.values()]
      .filter((peer, index, all) => all.findIndex((candidate) => candidate.peerId === peer.peerId) === index)
      .map((peer) => {
        const record = this.connections.get(peer.peerId);

        return {
          peerId: peer.peerId,
          playerId: peer.playerId,
          displayName: peer.displayName,
          role: peer.role,
          connectionStatus:
            peer.peerId === this.options.identity.peerId ? 'connected' : (record?.status ?? 'signaling'),
        };
      });

    this.options.onPeersChanged(views);
  }
}

export function shouldCreateOffer(localPeer: PeerSummary, remotePeer: PeerSummary): boolean {
  if (localPeer.joinedAt !== remotePeer.joinedAt) {
    return localPeer.joinedAt < remotePeer.joinedAt;
  }

  return localPeer.peerId < remotePeer.peerId;
}

function toLocalSummary(identity: NetworkIdentity): PeerSummary {
  return {
    peerId: identity.peerId,
    playerId: identity.playerId,
    displayName: identity.displayName,
    joinedAt: identity.joinedAt,
    role: identity.role,
  };
}

function mapConnectionStatus(state: RTCPeerConnectionState): PeerConnectionStatus {
  if (state === 'connected') {
    return 'connected';
  }

  if (state === 'closed') {
    return 'closed';
  }

  if (state === 'failed' || state === 'disconnected') {
    return 'disconnected';
  }

  return 'connecting';
}

function parseEnvelope(data: unknown): P2PEnvelope | null {
  try {
    return JSON.parse(String(data)) as P2PEnvelope;
  } catch {
    return null;
  }
}

function createMessageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
