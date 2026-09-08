import { buildStateHash } from '../game/rules';
import type { GameSessionState } from '../game/types';
import type { EncryptedRecoverySnapshot } from './types';

const RECOVERY_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const RECOVERY_SNAPSHOT_VERSION = 1;

export function generateRecoveryKey(): string {
  const bytes = new Uint8Array(RECOVERY_KEY_BYTES);
  getWebCrypto().getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function isRecoveryKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }

  try {
    return decodeBase64Url(value).byteLength === RECOVERY_KEY_BYTES;
  } catch {
    return false;
  }
}

export async function encryptRecoverySnapshot(
  snapshot: GameSessionState,
  eventSeq: number,
  recoveryKey: string,
): Promise<EncryptedRecoverySnapshot> {
  const crypto = getWebCrypto();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const metadata = createMetadata(snapshot, eventSeq);
  const key = await importRecoveryKey(recoveryKey, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encodeAdditionalData(metadata)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    ...metadata,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptRecoverySnapshot(
  encrypted: EncryptedRecoverySnapshot,
  recoveryKey: string,
): Promise<GameSessionState> {
  if (
    encrypted.version !== RECOVERY_SNAPSHOT_VERSION ||
    encrypted.algorithm !== 'AES-GCM' ||
    !Number.isSafeInteger(encrypted.revision) ||
    !Number.isSafeInteger(encrypted.eventSeq)
  ) {
    throw new Error('Unsupported recovery snapshot.');
  }

  const crypto = getWebCrypto();
  const iv = decodeBase64Url(encrypted.iv);

  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error('Invalid recovery snapshot IV.');
  }

  const key = await importRecoveryKey(recoveryKey, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encodeAdditionalData(encrypted)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(decodeBase64Url(encrypted.ciphertext)),
  );
  const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as GameSessionState;

  if (
    snapshot.gameId !== encrypted.gameId ||
    snapshot.revision !== encrypted.revision ||
    snapshot.stateHash !== encrypted.stateHash ||
    !hasValidStateHash(snapshot)
  ) {
    throw new Error('Recovery snapshot metadata does not match its decrypted state.');
  }

  return snapshot;
}

function createMetadata(snapshot: GameSessionState, eventSeq: number) {
  return {
    version: 1 as const,
    algorithm: 'AES-GCM' as const,
    gameId: snapshot.gameId,
    revision: snapshot.revision,
    eventSeq,
    stateHash: snapshot.stateHash,
  };
}

function encodeAdditionalData(
  snapshot: Pick<EncryptedRecoverySnapshot, 'version' | 'algorithm' | 'gameId' | 'revision' | 'eventSeq' | 'stateHash'>,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    'penguin-party-recovery',
    snapshot.version,
    snapshot.algorithm,
    snapshot.gameId,
    snapshot.revision,
    snapshot.eventSeq,
    snapshot.stateHash,
  ]));
}

async function importRecoveryKey(
  recoveryKey: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (!isRecoveryKey(recoveryKey)) {
    throw new Error('Invalid recovery key.');
  }

  return getWebCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(decodeBase64Url(recoveryKey)),
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

function hasValidStateHash(snapshot: GameSessionState): boolean {
  const { stateHash, ...withoutHash } = snapshot;
  return buildStateHash(withoutHash) === stateHash;
}

function getWebCrypto(): Crypto {
  if (typeof globalThis.crypto?.getRandomValues !== 'function' || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto is unavailable.');
  }

  return globalThis.crypto;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
