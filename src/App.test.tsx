import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LegalMove } from './game/types';
import { REJOIN_SESSION_STORAGE_KEY } from './network/rejoinStorage';

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
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify({
      rejoinCode: rejoinCode(Date.now() + 30_000, 'stored-code'),
      signalingServerUrl,
    }));
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status') ? { valid: true } : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${signalingServerUrl}/rejoin/status`, expect.anything()));
    expect(screen.getByRole('button', { name: 'Re-join previous game' })).toBeEnabled();
  });

  it('removes an invalid stored re-join session without showing a button', async () => {
    const signalingServerUrl = 'http://10.0.0.10:15201';
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify({
      rejoinCode: rejoinCode(Date.now() + 30_000, 'invalid-code'),
      signalingServerUrl,
    }));
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith('/rejoin/status') ? { valid: false } : { rooms: [] },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
  });

  it('removes a locally expired re-join code without contacting the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem(REJOIN_SESSION_STORAGE_KEY, JSON.stringify({
      rejoinCode: rejoinCode(Date.now() - 1, 'expired-code'),
      signalingServerUrl: 'http://10.0.0.11:15201',
    }));

    render(<App />);

    expect(window.localStorage.getItem(REJOIN_SESSION_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Re-join previous game' })).not.toBeInTheDocument();
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
