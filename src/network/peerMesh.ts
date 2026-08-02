import { getSignalingWsUrl, SignalingClient } from './signalingClient';
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
  createdAt: number;
}

interface PeerMeshOptions {
  identity: NetworkIdentity;
  hostPeerId: string;
  signalingHttpUrl: string;
  onPeersChanged: (peers: PeerRuntimeView[]) => void;
  onPayload: (envelope: P2PEnvelope) => void;
  onChannelOpen: (peer: PeerSummary) => void;
  onPeerLeft?: (peerId: string) => void;
  onStatus: (status: string) => void;
}

export class PeerMeshClient {
  private readonly peers = new Map<string, PeerSummary>();
  private readonly connections = new Map<string, PeerConnectionRecord>();
  private readonly pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly signaling: SignalingClient;
  private currentHostPeerId: string;
  private hostEpoch = 1;
  private retryIntervalId: number | null = null;

  constructor(private readonly options: PeerMeshOptions) {
    this.peers.set(options.identity.peerId, toLocalSummary(options.identity));
    this.currentHostPeerId = options.hostPeerId;
    this.signaling = new SignalingClient(
      options.identity,
      (message) => this.handleSignalingMessage(message),
      options.onStatus,
    );
  }

  connect(): void {
    this.signaling.connect(getSignalingWsUrl(this.options.signalingHttpUrl));
    this.retryIntervalId = window.setInterval(() => {
      void this.retryStaleOffererConnections();
    }, 2500);
  }

  close(): void {
    for (const record of this.connections.values()) {
      record.channel?.close();
      record.connection.close();
    }

    this.signaling.close();
    if (this.retryIntervalId !== null) {
      window.clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
    this.connections.clear();
    this.publishPeers();
  }

  getConnectedPeerCount(): number {
    return [...this.connections.values()].filter((record) => record.channel?.readyState === 'open').length;
  }

  setHostPeerId(peerId: string): void {
    this.currentHostPeerId = peerId;
    this.hostEpoch += 1;
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
      hostPeerId: this.currentHostPeerId,
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
      const localPeer = toLocalSummary(this.options.identity);

      for (const peer of message.peers) {
        this.peers.set(peer.peerId, peer);

        if (shouldConnectPeers(localPeer, peer, this.currentHostPeerId)) {
          void this.ensureConnection(peer, shouldCreateOffer(localPeer, peer));
        }
      }

      this.publishPeers();
      return;
    }

    if (message.type === 'peer_joined') {
      const localPeer = toLocalSummary(this.options.identity);
      const knownPeerRejoined = this.peers.has(message.peer.peerId);

      this.peers.set(message.peer.peerId, message.peer);

      if (knownPeerRejoined) {
        this.resetConnection(message.peer.peerId);
      }

      this.publishPeers();

      if (shouldConnectPeers(localPeer, message.peer, this.currentHostPeerId)) {
        void this.ensureConnection(message.peer, shouldCreateOffer(localPeer, message.peer));
      }
      return;
    }

    if (message.type === 'peer_disconnected') {
      const record = this.connections.get(message.peerId);

      if (record) {
        record.status = 'disconnected';
        record.channel?.close();
        record.connection.close();
      }

      this.publishPeers();
      return;
    }

    if (message.type === 'peer_left') {
      this.resetConnection(message.peerId);
      this.peers.delete(message.peerId);
      this.options.onPeerLeft?.(message.peerId);
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
      const record = this.connections.get(message.fromPeerId);

      if (record) {
        void record.connection.setRemoteDescription(message.description).then(() => {
          void this.flushQueuedIceCandidates(message.fromPeerId);
        });
      }
      return;
    }

    if (message.type === 'ice_candidate') {
      void this.addOrQueueIceCandidate(message.fromPeerId, message.candidate);
      return;
    }

    if (message.type === 'error') {
      this.options.onStatus(message.message);
    }
  }

  private async ensureConnection(peer: PeerSummary, createOffer: boolean): Promise<PeerConnectionRecord> {
    const existing = this.connections.get(peer.peerId);

    if (existing) {
      existing.peer = peer;

      if (
        existing.connection.connectionState === 'closed' ||
        existing.connection.connectionState === 'failed' ||
        existing.channel?.readyState === 'closed'
      ) {
        existing.channel?.close();
        existing.connection.close();
        this.connections.delete(peer.peerId);
      } else {
        if (createOffer && !existing.offered) {
          await this.createOffer(peer, existing);
        }

        return existing;
      }
    }

    const connection = new RTCPeerConnection(RTC_CONFIG);
    const record: PeerConnectionRecord = {
      peer,
      connection,
      channel: null,
      status: 'connecting',
      offered: false,
      createdAt: Date.now(),
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

  private resetConnection(peerId: string): void {
    const record = this.connections.get(peerId);

    if (!record) {
      return;
    }

    record.channel?.close();
    record.connection.close();
    this.connections.delete(peerId);
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
    const existing = this.connections.get(peer.peerId);

    if (existing && existing.channel?.readyState !== 'open') {
      existing.channel?.close();
      existing.connection.close();
      this.connections.delete(peer.peerId);
    }

    const record = await this.ensureConnection(peer, false);
    await record.connection.setRemoteDescription(description);
    await this.flushQueuedIceCandidates(peer.peerId);
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

  private async retryStaleOffererConnections(): Promise<void> {
    const localPeer = toLocalSummary(this.options.identity);
    const now = Date.now();

    for (const peer of this.peers.values()) {
      if (peer.peerId === localPeer.peerId || !shouldConnectPeers(localPeer, peer, this.currentHostPeerId)) {
        continue;
      }

      if (!shouldCreateOffer(localPeer, peer)) {
        continue;
      }

      const record = this.connections.get(peer.peerId);

      if (record?.channel?.readyState === 'open') {
        continue;
      }

      if (record && now - record.createdAt < 5000) {
        continue;
      }

      record?.channel?.close();
      record?.connection.close();
      this.connections.delete(peer.peerId);
      await this.ensureConnection(peer, true);
    }
  }

  private async addOrQueueIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const record = this.connections.get(peerId);

    if (!record || !record.connection.remoteDescription) {
      const queued = this.pendingIceCandidates.get(peerId) ?? [];
      queued.push(candidate);
      this.pendingIceCandidates.set(peerId, queued);
      return;
    }

    await record.connection.addIceCandidate(candidate);
  }

  private async flushQueuedIceCandidates(peerId: string): Promise<void> {
    const record = this.connections.get(peerId);
    const queued = this.pendingIceCandidates.get(peerId);

    if (!record || !queued) {
      return;
    }

    this.pendingIceCandidates.delete(peerId);

    for (const candidate of queued) {
      await record.connection.addIceCandidate(candidate);
    }
  }
}

export function shouldCreateOffer(localPeer: PeerSummary, remotePeer: PeerSummary): boolean {
  if (localPeer.joinedAt !== remotePeer.joinedAt) {
    return localPeer.joinedAt < remotePeer.joinedAt;
  }

  return localPeer.peerId < remotePeer.peerId;
}

function shouldConnectPeers(localPeer: PeerSummary, remotePeer: PeerSummary, hostPeerId: string): boolean {
  if (localPeer.role === 'spectator' || remotePeer.role === 'spectator') {
    if (localPeer.peerId !== hostPeerId && remotePeer.peerId !== hostPeerId) {
      return false;
    }
  }

  return shouldCreateOffer(localPeer, remotePeer);
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
