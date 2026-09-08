import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LegalMove } from './game/types';
import {
  getRejoinSessionStorageKey,
  storeRejoinSession,
} from './network/rejoinStorage';

vi.mock('./components/PixiDragStage', () => ({
  PixiDragStage: ({
    legalMoves,
    onPlayCard,
  }: {
    legalMoves: LegalMove[];
    onPlayCard: (cardId: string, target: { level: number; x: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        const firstMove = legalMoves[0];
        onPlayCard(firstMove.cardId, firstMove.target);
      }}
    >
      Mock Pixi Play
    </button>
  ),
}));

describe('App', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'prefered-language=; Max-Age=0; Path=/';
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders the multiplayer landing page by default', () => {
    const { container } = render(<App />);

    const title = screen.getByRole('heading', { name: 'Penguin Party' });
    const titleLetters = title.querySelectorAll('.brand__title-letter');

    expect(title).toBeInTheDocument();
    expect(container.querySelector('.brand__mark')).toBeNull();
    expect(titleLetters).toHaveLength(12);
    for (let index = 0; index < titleLetters.length; index += 1) {
      expect(titleLetters[index]).toHaveClass(`brand__title-letter--${index % 5}`);
    }
    expect(screen.getByText('Landing page')).toBeInTheDocument();
    expect((screen.getByLabelText('Player name') as HTMLInputElement).value).toMatch(/^Player_[0-9a-f]{6}$/);
    expect(screen.getByLabelText('Signaling server')).toHaveValue(`http://${window.location.hostname}:15201`);
    expect(screen.queryByLabelText('Re-join code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(screen.getByLabelText('Connection status: Not connected.')).toHaveAttribute('data-status', 'idle');
  });

  it('shows re-join only after a stored session is validated', async () => {
    const signalingServerUrl = 'http://10.0.0.9:15201';
    storeRejoinSession({
      rejoinCode: rejoinCode(Date.now() + 30_000, 'stored-code'),
      signalingServerUrl,
    });
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status')
        ? { valid: true, room: rejoinRoom('Stored room', 3) }
        : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${signalingServerUrl}/rejoin/status`, expect.anything()));
    expect(screen.getByRole('button', { name: 'Re-join previous game' })).toBeEnabled();
    expect(screen.getByText('Stored room')).toBeInTheDocument();
    expect(screen.getByText('3 / 6 players')).toBeInTheDocument();
  });

  it('removes an invalid stored re-join session without showing a button', async () => {
    const signalingServerUrl = 'http://10.0.0.10:15201';
    const rejoinCodeValue = rejoinCode(Date.now() + 30_000, 'invalid-code');
    storeRejoinSession({
      rejoinCode: rejoinCodeValue,
      signalingServerUrl,
    });
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status') ? { valid: false } : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(window.localStorage.getItem(getRejoinSessionStorageKey(rejoinCodeValue))).toBeNull());
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
  });

  it('removes a locally expired re-join code without contacting the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const rejoinCodeValue = rejoinCode(Date.now() - 1, 'expired-code');
    window.localStorage.setItem(getRejoinSessionStorageKey(rejoinCodeValue), JSON.stringify({
      rejoinCode: rejoinCodeValue,
      signalingServerUrl: 'http://10.0.0.11:15201',
    }));

    render(<App />);

    expect(window.localStorage.getItem(getRejoinSessionStorageKey(rejoinCodeValue))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
  });

  it('removes an expired query-only code without checking it with the server', async () => {
    const signalingServerUrl = 'http://10.0.0.11:15201';
    const rejoinCodeValue = rejoinCode(Date.now() - 1, 'expired-query-only');
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(rejoinCodeValue)}`);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rooms: [] }),
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(new URL(window.location.href).searchParams.get('rejoin-code')).toBeNull());
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/rejoin/status'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
  });

  it('validates a query-only code, stores it, and highlights its room', async () => {
    const signalingServerUrl = 'http://10.0.0.12:15201';
    const rejoinCodeValue = rejoinCode(Date.now() + 30_000, 'query-only');
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(rejoinCodeValue)}`);
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status')
        ? { valid: true, room: rejoinRoom('Query room', 4) }
        : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const roomName = await screen.findByText('Query room');
    expect(roomName.closest('[data-current-tab]')).toHaveAttribute('data-current-tab', 'true');
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(rejoinCodeValue))).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get('rejoin-code')).toBe(rejoinCodeValue);
  });

  it('revalidates a current query code when its shared storage entry disappears', async () => {
    const signalingServerUrl = 'http://10.0.0.16:15201';
    const rejoinCodeValue = rejoinCode(Date.now() + 30_000, 'restore-query-superset');
    const storageKey = getRejoinSessionStorageKey(rejoinCodeValue);
    storeRejoinSession({ rejoinCode: rejoinCodeValue, signalingServerUrl });
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(rejoinCodeValue)}`);
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status')
        ? { valid: true, room: rejoinRoom('Restored query room', 3) }
        : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('Restored query room');

    const oldValue = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    const storageEvent = new Event('storage');
    Object.defineProperties(storageEvent, {
      key: { value: storageKey },
      newValue: { value: null },
      oldValue: { value: oldValue },
      storageArea: { value: window.localStorage },
      url: { value: window.location.href },
    });
    fireEvent(window, storageEvent);

    await waitFor(() => expect(window.localStorage.getItem(storageKey)).not.toBeNull());
    expect(new URL(window.location.href).searchParams.get('rejoin-code')).toBe(rejoinCodeValue);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/rejoin/status')).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('shows every valid stored code and puts the current tab room first', async () => {
    const signalingServerUrl = 'http://10.0.0.13:15201';
    const otherTabCode = rejoinCode(Date.now() + 40_000, 'other-tab');
    const currentTabCode = rejoinCode(Date.now() + 50_000, 'current-tab');
    storeRejoinSession({ rejoinCode: otherTabCode, signalingServerUrl });
    storeRejoinSession({ rejoinCode: currentTabCode, signalingServerUrl });
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(currentTabCode)}`);
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const requestBody = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { rejoinCode?: string }
        : {};
      const roomName = requestBody.rejoinCode === currentTabCode ? 'Current tab room' : 'Other tab room';

      return {
        ok: true,
        json: async () => String(input).endsWith('/rejoin/status')
          ? { valid: true, room: rejoinRoom(roomName, 2) }
          : { rooms: [] },
        status: 200,
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Re-join previous game' })).toHaveLength(2));
    const cards = document.querySelectorAll<HTMLElement>('[data-rejoin-room-id]');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-current-tab', 'true');
    expect(cards[0]).toHaveTextContent('Current tab room');
    expect(cards[1]).toHaveTextContent('Other tab room');
  });

  it('removes an invalid current-tab code from storage and the URL together', async () => {
    const signalingServerUrl = 'http://10.0.0.14:15201';
    const rejoinCodeValue = rejoinCode(Date.now() + 30_000, 'invalid-current-tab');
    storeRejoinSession({ rejoinCode: rejoinCodeValue, signalingServerUrl });
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(rejoinCodeValue)}`);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status') ? { valid: false } : { rooms: [] },
      status: 200,
    })));

    render(<App />);

    await waitFor(() => expect(new URL(window.location.href).searchParams.get('rejoin-code')).toBeNull());
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(rejoinCodeValue))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
  });

  it('keeps another tab\'s valid stored code when the current-tab code is invalid', async () => {
    const signalingServerUrl = 'http://10.0.0.15:15201';
    const currentTabCode = rejoinCode(Date.now() + 30_000, 'invalid-current-tab');
    const otherTabCode = rejoinCode(Date.now() + 40_000, 'valid-other-tab');
    storeRejoinSession({ rejoinCode: currentTabCode, signalingServerUrl });
    storeRejoinSession({ rejoinCode: otherTabCode, signalingServerUrl });
    window.history.replaceState({}, '', `/?signaling-server=${encodeURIComponent(signalingServerUrl)}&rejoin-code=${encodeURIComponent(currentTabCode)}`);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { rejoinCode?: string }
        : {};

      return {
        ok: true,
        json: async () => String(input).endsWith('/rejoin/status')
          ? body.rejoinCode === otherTabCode
            ? { valid: true, room: rejoinRoom('Other tab room', 2) }
            : { valid: false }
          : { rooms: [] },
        status: 200,
      };
    }));

    render(<App />);

    await screen.findByText('Other tab room');
    expect(new URL(window.location.href).searchParams.get('rejoin-code')).toBeNull();
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(currentTabCode))).toBeNull();
    expect(window.localStorage.getItem(getRejoinSessionStorageKey(otherTabCode))).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Re-join previous game' })).toBeEnabled();
  });

  it('auto-connects once with the signaling server query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rooms: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/?signaling-server=http%3A%2F%2F10.0.0.8%3A15201');

    render(<App />);

    expect(screen.getByLabelText('Signaling server')).toHaveValue('http://10.0.0.8:15201');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.8:15201/rooms');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
    expect(screen.getByText('Connected: http://10.0.0.8:15201')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection status: Connected')).toHaveAttribute('data-status', 'connected');
  });

  it('uses the lang query before cookies for the landing page language', () => {
    document.cookie = 'prefered-language=en; Path=/';
    window.history.replaceState({}, '', '/?lang=ja');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'ペンギンパーティー' })).toBeInTheDocument();
    expect(screen.getByLabelText('言語')).toHaveValue('ja');
    expect(screen.getByRole('button', { name: '接続' })).toBeEnabled();
  });

  it('stores manual language selection in the cookie and removes lang from the URL', () => {
    window.history.replaceState({}, '', '/?lang=ja&signaling-server=http%3A%2F%2F10.0.0.8%3A15201');

    render(<App />);

    fireEvent.change(screen.getByLabelText('言語'), { target: { value: 'en' } });

    expect(document.cookie).toContain('prefered-language=en');
    expect(new URL(window.location.href).searchParams.get('lang')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('signaling-server')).toBe('http://10.0.0.8:15201');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('uses the language cookie when lang query is absent', () => {
    document.cookie = 'prefered-language=ja; Path=/';

    render(<App />);

    expect(screen.getByRole('heading', { name: 'ペンギンパーティー' })).toBeInTheDocument();
    expect(screen.getByLabelText('言語')).toHaveValue('ja');
  });

  it('renders the local verification game shell for local-test mode', () => {
    window.history.replaceState({}, '', '/?mode=local-test');

    const { container } = render(<App />);

    expect(screen.getByRole('heading', { name: 'Penguin Party' })).toBeInTheDocument();
    expect(screen.getByText('Local verification mode')).toBeInTheDocument();
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Player 2').length).toBeGreaterThan(0);
    expect(container.querySelector('.hud')).toBeNull();
    expect(container.querySelector('.player-row[data-active="true"] strong')).toHaveTextContent('You');
  });

  it('updates the board and hand metrics after the Pixi stage plays a card', () => {
    window.history.replaceState({}, '', '/?mode=local-test');

    const { container } = render(<App />);

    expect(container.querySelector('[data-hand-count]')).toHaveTextContent('18');

    fireEvent.click(screen.getByRole('button', { name: 'Mock Pixi Play' }));

    expect(container.querySelector('.player-row[data-active="true"] strong')).toHaveTextContent('Player 2');
    expect(container.querySelector('[data-board-count]')).toHaveTextContent('1');
  });
});

function rejoinCode(expiresAt: number, random: string): string {
  return `${random}.${expiresAt.toString(36)}`;
}

function rejoinRoom(roomName: string, currentPlayerCount: number) {
  return {
    roomId: `room-${roomName}`,
    roomName,
    currentPlayerCount,
    maxPlayers: 6,
  };
}
