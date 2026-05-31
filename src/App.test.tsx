import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LegalMove } from './game/types';

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
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '接続' })).toBeEnabled();
  });

  it('uses the signaling server query as the landing default', () => {
    window.history.replaceState({}, '', '/?signaling-server=http%3A%2F%2F10.0.0.8%3A15201');

    render(<App />);

    expect(screen.getByLabelText('Signaling server')).toHaveValue('http://10.0.0.8:15201');
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
