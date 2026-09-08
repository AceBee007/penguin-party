import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { createLocalGame, getLegalMovesForPlayer, playCard } from '../game/rules';
import type { CardId, MoveTarget } from '../game/types';
import { PixiDragStage } from './PixiDragStage';

interface DragHint {
  endX: number;
  endY: number;
  startX: number;
  startY: number;
}

function InteractiveStage() {
  const [game, setGame] = useState(() => createLocalGame({
    playerCount: 2,
    playerNames: ['You', 'Player 2'],
    seed: 'storybook-pixi-interactive',
  }));
  const activePlayerId = game.currentRound?.activePlayerId ?? null;
  const legalMoves = useMemo(
    () => activePlayerId ? getLegalMovesForPlayer(game, activePlayerId) : [],
    [activePlayerId, game],
  );
  const [dragHint, setDragHint] = useState<DragHint | null>(null);
  const handlePlayCard = useCallback((cardId: CardId, target: MoveTarget) => {
    setGame((currentGame) => {
      const currentPlayerId = currentGame.currentRound?.activePlayerId;

      return currentPlayerId ? playCard(currentGame, currentPlayerId, cardId, target).state : currentGame;
    });
  }, []);

  useEffect(() => {
    setDragHint(null);
    let attempts = 0;
    let timeoutId = 0;

    const readDragHint = () => {
      const debug = window.__PENGUIN_STAGE_DEBUG__ as
        | {
            debugId: string;
            handCards: Array<{
              centerX: number;
              centerY: number;
              targets: Array<{ centerX: number; centerY: number }>;
            }>;
          }
        | undefined;
      const card = debug?.debugId === 'storybook-interactive-stage'
        ? debug.handCards.find((candidate) => candidate.targets.length > 0)
        : null;
      const target = card?.targets[0];

      if (card && target) {
        setDragHint({
          endX: target.centerX,
          endY: target.centerY,
          startX: card.centerX,
          startY: card.centerY,
        });
        return;
      }

      attempts += 1;

      if (attempts < 20) {
        timeoutId = window.setTimeout(readDragHint, 50);
      }
    };

    timeoutId = window.setTimeout(readDragHint, 50);

    return () => window.clearTimeout(timeoutId);
  }, [game.revision]);

  const boardCount = game.currentRound?.board.occupiedCellKeys.length ?? 0;

  return (
    <section style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: 'min(760px, 100vh)', minHeight: '480px' }}>
      <div
        data-drag-end-x={dragHint?.endX}
        data-drag-end-y={dragHint?.endY}
        data-drag-ready={dragHint ? 'true' : 'false'}
        data-drag-start-x={dragHint?.startX}
        data-drag-start-y={dragHint?.startY}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', padding: '12px 16px', background: '#ffffff' }}
      >
        <strong>Drag a card onto a highlighted target</strong>
        <span data-storybook-board-count>Board: {boardCount}</span>
        <span data-storybook-active-player>Active: {activePlayerId ?? 'none'}</span>
        <span data-storybook-revision>Revision: {game.revision}</span>
      </div>
      <PixiDragStage
        activePlayerId={activePlayerId}
        debugId="storybook-interactive-stage"
        game={game}
        handPlayerId={activePlayerId}
        legalMoves={legalMoves}
        onPlayCard={handlePlayCard}
      />
    </section>
  );
}

const boardOnlyGame = createLocalGame({
  playerCount: 6,
  playerNames: ['A', 'B', 'C', 'D', 'E', 'F'],
  seed: 'storybook-pixi-board-only',
});

const meta = {
  title: 'Components/Pixi Drag Stage',
  component: PixiDragStage,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof PixiDragStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  args: {
    activePlayerId: null,
    game: boardOnlyGame,
    legalMoves: [],
    onPlayCard: () => undefined,
  },
  render: () => <InteractiveStage />,
};

export const BoardOnly: Story = {
  args: {
    activePlayerId: null,
    debugId: 'storybook-board-only-stage',
    fitMode: 'perfect-pyramid',
    game: boardOnlyGame,
    legalMoves: [],
    onPlayCard: () => undefined,
    showHand: false,
  },
  render: (args) => (
    <div style={{ height: 'min(760px, 100vh)', minHeight: '480px' }}>
      <PixiDragStage {...args} />
    </div>
  ),
};
