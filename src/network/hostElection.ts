import type { PeerRuntimeView } from './types';

interface ElectHostInput {
  previousHostPeerId: string;
  peers: PeerRuntimeView[];
  revision: number;
  stateHash: string;
}

export function electNextHostPeerId(input: ElectHostInput): string | null {
  const candidates = input.peers
    .filter((peer) => peer.peerId !== input.previousHostPeerId)
    .filter((peer) => peer.role !== 'spectator')
    .filter((peer) => peer.playerId !== null)
    .filter((peer) => peer.connectionStatus === 'connected')
    .sort((left, right) => {
      const leftPlayer = left.playerId ?? '';
      const rightPlayer = right.playerId ?? '';
      return leftPlayer.localeCompare(rightPlayer) || left.peerId.localeCompare(right.peerId);
    });

  if (candidates.length === 0) {
    return null;
  }

  const seed = `${input.revision}:${input.stateHash}:${candidates.map((peer) => peer.peerId).join('|')}`;
  const index = hashString(seed) % candidates.length;
  return candidates[index].peerId;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
