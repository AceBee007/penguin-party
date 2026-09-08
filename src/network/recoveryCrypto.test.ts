import { describe, expect, it } from 'vitest';
import { createLocalGame } from '../game/rules';
import {
  decryptRecoverySnapshot,
  encryptRecoverySnapshot,
  generateRecoveryKey,
  isRecoveryKey,
} from './recoveryCrypto';

describe('recoveryCrypto', () => {
  it('round-trips a complete game snapshot with authenticated metadata', async () => {
    const snapshot = createLocalGame({ playerCount: 2, seed: 'recovery-round-trip' });
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptRecoverySnapshot(snapshot, 7, recoveryKey);

    expect(isRecoveryKey(recoveryKey)).toBe(true);
    expect(encrypted).toMatchObject({
      algorithm: 'AES-GCM',
      eventSeq: 7,
      gameId: snapshot.gameId,
      revision: snapshot.revision,
      stateHash: snapshot.stateHash,
      version: 1,
    });
    expect(JSON.stringify(encrypted)).not.toContain('"randomSeed"');
    expect(JSON.stringify(encrypted)).not.toContain('"handCardIds"');
    await expect(decryptRecoverySnapshot(encrypted, recoveryKey)).resolves.toEqual(snapshot);
  });

  it('rejects the wrong player recovery key', async () => {
    const snapshot = createLocalGame({ playerCount: 2, seed: 'recovery-wrong-key' });
    const encrypted = await encryptRecoverySnapshot(snapshot, 0, generateRecoveryKey());

    await expect(decryptRecoverySnapshot(encrypted, generateRecoveryKey())).rejects.toThrow();
  });

  it('rejects tampered recovery metadata', async () => {
    const snapshot = createLocalGame({ playerCount: 2, seed: 'recovery-tamper' });
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptRecoverySnapshot(snapshot, 0, recoveryKey);

    await expect(decryptRecoverySnapshot({ ...encrypted, revision: encrypted.revision + 1 }, recoveryKey)).rejects.toThrow();
  });
});
