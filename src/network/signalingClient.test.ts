import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRejoinCodeQuery,
  getRejoinCodeQuery,
  setRejoinCodeQuery,
  setSignalingServerQuery,
} from './signalingClient';

describe('re-join query helpers', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('stores one tab-specific code and preserves it when the signaling server changes', () => {
    setRejoinCodeQuery('tab-code.expiry');
    setSignalingServerQuery('http://127.0.0.1:15201');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('rejoin-code')).toBe('tab-code.expiry');
    expect(url.searchParams.get('signaling-server')).toBe('http://127.0.0.1:15201');
    expect(getRejoinCodeQuery()).toBe('tab-code.expiry');
  });

  it('reads a legacy query and normalizes it on update', () => {
    window.history.replaceState({}, '', '/?rejoin=legacy.expiry');

    expect(getRejoinCodeQuery()).toBe('legacy.expiry');
    setRejoinCodeQuery('legacy.expiry');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('rejoin')).toBeNull();
    expect(url.searchParams.get('rejoin-code')).toBe('legacy.expiry');
  });

  it('only clears the code expected by the current operation', () => {
    setRejoinCodeQuery('newer.expiry');
    clearRejoinCodeQuery('older.expiry');
    expect(getRejoinCodeQuery()).toBe('newer.expiry');

    clearRejoinCodeQuery('newer.expiry');
    expect(getRejoinCodeQuery()).toBeNull();
  });
});
