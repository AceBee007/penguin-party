import { beforeEach, describe, expect, it } from 'vitest';
import { generateRecoveryKey } from './recoveryCrypto';
import {
  clearAllStoredRejoinSessions,
  clearStoredRejoinSession,
  getRejoinCodeExpiresAt,
  getRejoinSessionStorageKey,
  readStoredRejoinSessions,
  REJOIN_SESSION_STORAGE_KEY,
  storeRejoinSession,
} from './rejoinStorage';

describe('rejoinStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores multiple live sessions without overwriting another tab', () => {
    const sessions = [
      session('tab-one', 'http://127.0.0.1:15201'),
      session('tab-two', 'http://127.0.0.1:15202'),
    ];

    sessions.forEach(storeRejoinSession);

    expect(readStoredRejoinSessions()).toEqual(sessions);
    expect(window.localStorage).toHaveLength(2);
  });

  it('clears only the selected code', () => {
    const first = session('tab-one', 'http://127.0.0.1:15201');
    const second = session('tab-two', 'http://127.0.0.1:15201');
    storeRejoinSession(first);
    storeRejoinSession(second);

    clearStoredRejoinSession(first.rejoinCode);

    expect(readStoredRejoinSessions()).toEqual([second]);
  });

  it('keeps each player recovery key scoped to its re-join code', () => {
    const first = { ...session('tab-one', 'http://127.0.0.1:15201'), recoveryKey: generateRecoveryKey() };
    const second = { ...session('tab-two', 'http://127.0.0.1:15201'), recoveryKey: generateRecoveryKey() };

    storeRejoinSession(first);
    storeRejoinSession(second);

    expect(readStoredRejoinSessions()).toEqual([first, second]);

    clearStoredRejoinSession(first.rejoinCode);

    expect(readStoredRejoinSessions()).toEqual([second]);
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(first.rejoinCode))).toBeNull();
  });

  it('drops a malformed recovery key without discarding a valid re-join session', () => {
    const stored = { ...session('tab-one', 'http://127.0.0.1:15201'), recoveryKey: 'not-a-256-bit-key' };
    window.localStorage.setItem(getRejoinSessionStorageKey(stored.rejoinCode), JSON.stringify(stored));

    expect(readStoredRejoinSessions()).toEqual([{
      rejoinCode: stored.rejoinCode,
      signalingServerUrl: stored.signalingServerUrl,
    }]);
  });

  it('removes expired and malformed per-code entries', () => {
    const now = Date.now();
    const expired = session('expired', 'http://127.0.0.1:15201', now - 1);
    const malformedKey = `${REJOIN_SESSION_STORAGE_KEY}.malformed`;
    window.localStorage.setItem(getRejoinSessionStorageKey(expired.rejoinCode), JSON.stringify(expired));
    window.localStorage.setItem(malformedKey, '{not-json');

    expect(readStoredRejoinSessions(now)).toEqual([]);
    expect(window.localStorage).toHaveLength(0);
  });

  it('migrates the previous single-session value', () => {
    const legacySession = session('legacy', 'http://127.0.0.1:15201');
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify(legacySession));

    expect(readStoredRejoinSessions()).toEqual([legacySession]);
    expect(window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(legacySession.rejoinCode))).not.toBeNull();
  });

  it('clears every current and legacy session when explicitly requested', () => {
    const current = session('current', 'http://127.0.0.1:15201');
    storeRejoinSession(current);
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify(session('legacy', 'http://127.0.0.1:15201')));

    clearAllStoredRejoinSessions();

    expect(window.localStorage).toHaveLength(0);
  });

  it('reads the expiry timestamp embedded in a code', () => {
    expect(getRejoinCodeExpiresAt(code(123_456))).toBe(123_456);
    expect(getRejoinCodeExpiresAt('missing-expiry')).toBeNull();
    expect(getRejoinCodeExpiresAt('random.not-valid!')).toBeNull();
  });
});

function session(random: string, signalingServerUrl: string, expiresAt = Date.now() + 30_000) {
  return {
    rejoinCode: code(expiresAt, random),
    signalingServerUrl,
  };
}

function code(expiresAt: number, random = 'random'): string {
  return `${random}.${expiresAt.toString(36)}`;
}
