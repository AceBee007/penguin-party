export const REJOIN_SESSION_STORAGE_KEY = 'penguin-party.rejoinSession';
export const REJOIN_SESSION_STORAGE_KEY_PREFIX = `${REJOIN_SESSION_STORAGE_KEY}.`;

export interface StoredRejoinSession {
  rejoinCode: string;
  signalingServerUrl: string;
}

export function getRejoinCodeExpiresAt(rejoinCode: string): number | null {
  const segments = rejoinCode.trim().split('.');

  if (segments.length !== 2 || !segments[0] || !/^[0-9a-z]+$/i.test(segments[1])) {
    return null;
  }

  const expiresAt = Number.parseInt(segments[1], 36);

  return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : null;
}

export function readStoredRejoinSessions(now = Date.now()): StoredRejoinSession[] {
  if (typeof window === 'undefined' || typeof window.localStorage?.getItem !== 'function') {
    return [];
  }

  try {
    migrateLegacyRejoinSession(now);
    const storageKeys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string => Boolean(key?.startsWith(REJOIN_SESSION_STORAGE_KEY_PREFIX)));
    const sessions = new Map<string, StoredRejoinSession>();

    for (const storageKey of storageKeys) {
      const session = parseStoredSession(window.localStorage.getItem(storageKey));
      const expiresAt = session ? getRejoinCodeExpiresAt(session.rejoinCode) : null;

      if (
        !session ||
        expiresAt === null ||
        expiresAt <= now ||
        storageKey !== getRejoinSessionStorageKey(session.rejoinCode)
      ) {
        window.localStorage.removeItem(storageKey);
        continue;
      }

      sessions.set(session.rejoinCode, session);
    }

    return [...sessions.values()].sort((left, right) =>
      (getRejoinCodeExpiresAt(left.rejoinCode) ?? 0) - (getRejoinCodeExpiresAt(right.rejoinCode) ?? 0),
    );
  } catch {
    return [];
  }
}

export function storeRejoinSession(session: StoredRejoinSession): void {
  if (typeof window === 'undefined' || typeof window.localStorage?.setItem !== 'function') {
    return;
  }

  const normalizedSession = normalizeStoredSession(session);
  const expiresAt = normalizedSession ? getRejoinCodeExpiresAt(normalizedSession.rejoinCode) : null;

  if (!normalizedSession || expiresAt === null || expiresAt <= Date.now()) {
    return;
  }

  try {
    window.localStorage.setItem(
      getRejoinSessionStorageKey(normalizedSession.rejoinCode),
      JSON.stringify(normalizedSession),
    );
  } catch {
    // Re-join remains best-effort when storage is unavailable.
  }
}

export function clearStoredRejoinSession(rejoinCode: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage?.removeItem !== 'function') {
    return;
  }

  try {
    window.localStorage.removeItem(getRejoinSessionStorageKey(rejoinCode));
  } catch {
    // Storage access can be denied by the browser.
  }
}

export function clearAllStoredRejoinSessions(): void {
  if (typeof window === 'undefined' || typeof window.localStorage?.removeItem !== 'function') {
    return;
  }

  try {
    const storageKeys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string => Boolean(
      key === REJOIN_SESSION_STORAGE_KEY || key?.startsWith(REJOIN_SESSION_STORAGE_KEY_PREFIX),
    ));

    for (const storageKey of storageKeys) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage access can be denied by the browser.
  }
}

export function isRejoinSessionStorageKey(storageKey: string | null): boolean {
  return storageKey === REJOIN_SESSION_STORAGE_KEY
    || Boolean(storageKey?.startsWith(REJOIN_SESSION_STORAGE_KEY_PREFIX));
}

export function getRejoinSessionStorageKey(rejoinCode: string): string {
  return `${REJOIN_SESSION_STORAGE_KEY_PREFIX}${encodeURIComponent(rejoinCode.trim())}`;
}

function migrateLegacyRejoinSession(now: number): void {
  const legacyRaw = window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY);

  if (!legacyRaw) {
    return;
  }

  window.localStorage.removeItem(REJOIN_SESSION_STORAGE_KEY);
  const session = parseStoredSession(legacyRaw);
  const expiresAt = session ? getRejoinCodeExpiresAt(session.rejoinCode) : null;

  if (!session || expiresAt === null || expiresAt <= now) {
    return;
  }

  window.localStorage.setItem(getRejoinSessionStorageKey(session.rejoinCode), JSON.stringify(session));
}

function parseStoredSession(raw: string | null): StoredRejoinSession | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeStoredSession(JSON.parse(raw) as Partial<StoredRejoinSession>);
  } catch {
    return null;
  }
}

function normalizeStoredSession(session: Partial<StoredRejoinSession>): StoredRejoinSession | null {
  const rejoinCode = typeof session.rejoinCode === 'string' ? session.rejoinCode.trim() : '';
  const signalingServerUrl = typeof session.signalingServerUrl === 'string'
    ? session.signalingServerUrl.trim()
    : '';

  return rejoinCode && signalingServerUrl ? { rejoinCode, signalingServerUrl } : null;
}
