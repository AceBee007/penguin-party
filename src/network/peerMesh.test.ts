import { describe, expect, it } from 'vitest';
import { shouldCreateOffer } from './peerMesh';
import type { PeerSummary } from './types';

describe('shouldCreateOffer', () => {
  it('selects only the earlier peer as the offerer', () => {
    const earlier = peer('peer-a', 100);
    const later = peer('peer-b', 200);

    expect(shouldCreateOffer(earlier, later)).toBe(true);
    expect(shouldCreateOffer(later, earlier)).toBe(false);
  });

  it('uses peer id as a stable tie-breaker', () => {
    const peerA = peer('peer-a', 100);
    const peerB = peer('peer-b', 100);

    expect(shouldCreateOffer(peerA, peerB)).toBe(true);
    expect(shouldCreateOffer(peerB, peerA)).toBe(false);
  });
});

function peer(peerId: string, joinedAt: number): PeerSummary {
  return {
    peerId,
    joinedAt,
    displayName: peerId,
    playerId: peerId,
    role: 'player',
  };
}
