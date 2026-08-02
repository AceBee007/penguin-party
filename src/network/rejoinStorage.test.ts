import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredRejoinSession,
  getRejoinCodeExpiresAt,
  readStoredRejoinSession,
  REJOIN_SESSION_STORAGE_KEY,
  storeRejoinSession,
} from './rejoinStorage';

describe('rejoinStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads a live re-join session', () => {
    const session = {
      rejoinCode: code(31_000),
      signalingServerUrl: 'http://127.0.0.1:15201',
    };

    storeRejoinSession(session);

    expect(readStoredRejoinSession(1_000)).toEqual(session);
  });

  it('removes expired and malformed sessions', () => {
    storeRejoinSession({
      rejoinCode: code(1_000),
      signalingServerUrl: 'http://127.0.0.1:15201',
    });

    expect(readStoredRejoinSession(1_000)).toBeNull();
    expect(window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, '{not-json');
    expect(readStoredRejoinSession()).toBeNull();
    expect(window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('does not clear a newer session when an older request finishes late', () => {
    storeRejoinSession({
      rejoinCode: code(Date.now() + 30_000, 'new-code'),
      signalingServerUrl: 'http://127.0.0.1:15201',
    });

    clearStoredRejoinSession(code(Date.now() + 30_000, 'old-code'));

    expect(readStoredRejoinSession()?.rejoinCode).toContain('new-code.');
  });

  it('reads the expiry timestamp embedded in a code', () => {
    expect(getRejoinCodeExpiresAt(code(123_456))).toBe(123_456);
    expect(getRejoinCodeExpiresAt('missing-expiry')).toBeNull();
    expect(getRejoinCodeExpiresAt('random.not-valid!')).toBeNull();
  });
});

function code(expiresAt: number, random = 'random'): string {
  return `${random}.${expiresAt.toString(36)}`;
}
