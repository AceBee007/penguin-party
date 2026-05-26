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
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Penguin Party' })).toBeInTheDocument();
    expect(screen.getByText('Landing page')).toBeInTheDocument();
    expect((screen.getByLabelText('Player name') as HTMLInputElement).value).toMatch(/^Player_[0-9a-f]{6}$/);
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
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
