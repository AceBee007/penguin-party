import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LegalMove } from './game/types';

vi.mock('./components/PixiDragStage', () => ({
  PixiDragStage: ({
    legalMoves,
    onDragStatusChange,
    onPlayCard,
  }: {
    legalMoves: LegalMove[];
    onDragStatusChange: (status: { selectedCard: string; target: string }) => void;
    onPlayCard: (cardId: string, target: { level: number; x: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        const firstMove = legalMoves[0];
        onDragStatusChange({
          selectedCard: firstMove.cardId,
          target: `${firstMove.target.level}:${firstMove.target.x}`,
        });
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

  it('renders the multiplayer lobby by default', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Penguin Party' })).toBeInTheDocument();
    expect(screen.getByText('P2P party room')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create room' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Join room' })).toBeInTheDocument();
  });

  it('renders the local verification game shell for local-test mode', () => {
    window.history.replaceState({}, '', '/?mode=local-test');

    const { container } = render(<App />);

    expect(screen.getByRole('heading', { name: 'Penguin Party' })).toBeInTheDocument();
    expect(screen.getByText('Local verification mode')).toBeInTheDocument();
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Player 2').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-selected-card]')).toHaveTextContent('Ready');
  });

  it('updates the board and hand metrics after the Pixi stage plays a card', () => {
    window.history.replaceState({}, '', '/?mode=local-test');

    const { container } = render(<App />);

    expect(container.querySelector('[data-selected-card]')).toHaveTextContent('Ready');
    expect(container.querySelector('[data-hand-count]')).toHaveTextContent('18');

    fireEvent.click(screen.getByRole('button', { name: 'Mock Pixi Play' }));

    expect(container.querySelector('[data-target-readout]')).toHaveTextContent('No target');
    expect(container.querySelector('[data-active-player]')).toHaveTextContent('Player 2');
    expect(container.querySelector('[data-board-count]')).toHaveTextContent('1');
  });
});
