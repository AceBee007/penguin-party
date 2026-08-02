export const REJOIN_SESSION_STORAGE_KEY = 'penguin-party.rejoinSession';

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

export function readStoredRejoinSession(now = Date.now()): StoredRejoinSession | null {
  if (typeof window === 'undefined' || typeof window.localStorage?.getItem !== 'function') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredRejoinSession>;
    const session = {
      rejoinCode: typeof parsed.rejoinCode === 'string' ? parsed.rejoinCode.trim() : '',
      signalingServerUrl: typeof parsed.signalingServerUrl === 'string' ? parsed.signalingServerUrl.trim() : '',
    };
    const expiresAt = getRejoinCodeExpiresAt(session.rejoinCode);

    if (
      !session.rejoinCode ||
      expiresAt === null ||
      !session.signalingServerUrl ||
      expiresAt <= now
    ) {
      clearStoredRejoinSession();
      return null;
    }

    return session;
  } catch {
    clearStoredRejoinSession();
    return null;
  }
}

export function storeRejoinSession(session: StoredRejoinSession): void {
  if (typeof window === 'undefined' || typeof window.localStorage?.setItem !== 'function') {
    return;
  }

  try {
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Re-join remains best-effort when storage is unavailable.
  }
}

export function clearStoredRejoinSession(expectedRejoinCode?: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage?.removeItem !== 'function') {
    return;
  }

  try {
    if (expectedRejoinCode) {
      const current = window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY);

      if (current) {
        const parsed = JSON.parse(current) as Partial<StoredRejoinSession>;

        if (parsed.rejoinCode !== expectedRejoinCode) {
          return;
        }
      }
    }

    window.localStorage.removeItem(REJOIN_SESSION_STORAGE_KEY);
  } catch {
    // Storage access can be denied by the browser.
  }
}
