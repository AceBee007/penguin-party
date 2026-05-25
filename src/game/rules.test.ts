import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  createDeck,
  createEmptyBoard,
  createLocalGame,
  getLegalMoves,
  getLegalMovesForPlayer,
  getLegalTargetsForColor,
  playCard,
  startNextRound,
} from './rules';
import type { BoardState, CardInstance } from './types';

describe('Penguin Party rules', () => {
  it('creates the official 36-card color composition', () => {
    const deck = createDeck();

    expect(deck).toHaveLength(36);
    expect(deck.filter((card) => card.color === 'green')).toHaveLength(8);
    expect(deck.filter((card) => card.color === 'yellow')).toHaveLength(7);
    expect(deck.filter((card) => card.color === 'red')).toHaveLength(7);
    expect(deck.filter((card) => card.color === 'purple')).toHaveLength(7);
    expect(deck.filter((card) => card.color === 'blue')).toHaveLength(7);
  });

  it('deals 18 cards per player in the two-player local verification mode', () => {
    const game = createLocalGame({ playerCount: 2, seed: 'deal-test' });

    expect(game.currentRound?.players['player-1'].handCardIds).toHaveLength(18);
    expect(game.currentRound?.players['player-2'].handCardIds).toHaveLength(18);
    expect(game.currentRound?.board.occupiedCellKeys).toHaveLength(0);
  });

  it('places the five-player remainder as the initial base card', () => {
    const game = createLocalGame({ playerCount: 5, seed: 'five-player' });

    expect(game.currentRound?.players['player-1'].handCardIds).toHaveLength(7);
    expect(game.currentRound?.board.occupiedCellKeys).toHaveLength(1);
    expect(game.currentRound?.board.baseMinX).toBe(0);
    expect(game.currentRound?.board.baseMaxX).toBe(0);
  });

  it('allows any color as the first base card and then the two base edges', () => {
    const board = createEmptyBoard();
    const hand = [
      { cardId: 'red-1', color: 'red', serial: 1 },
      { cardId: 'blue-1', color: 'blue', serial: 1 },
    ] satisfies CardInstance[];

    expect(getLegalMoves(board, hand)).toEqual([
      { cardId: 'red-1', color: 'red', target: { level: 0, x: 0 } },
      { cardId: 'blue-1', color: 'blue', target: { level: 0, x: 0 } },
    ]);

    const game = createLocalGame({ playerCount: 2, seed: 'first-move' });
    const firstMove = getLegalMovesForPlayer(game, 'player-1')[0];
    const afterFirstMove = playCard(game, 'player-1', firstMove.cardId, firstMove.target).state;
    const edgeTargets = getLegalTargetsForColor(afterFirstMove.currentRound!.board, 'green').filter(
      (target) => target.level === 0,
    );

    expect(edgeTargets).toEqual([
      { level: 0, x: -1 },
      { level: 0, x: 1 },
    ]);
  });

  it('only allows upper cards matching one of the two supporting colors', () => {
    const board: BoardState = {
      baseWidthLimit: DEFAULT_RULES.normalBaseWidth,
      maxHeight: DEFAULT_RULES.normalBaseWidth,
      cardsByCell: {
        '0:0': {
          cardId: 'red-1',
          color: 'red',
          ownerPlayerId: 'player-1',
          level: 0,
          x: 0,
          playedAtTurn: 1,
        },
        '0:1': {
          cardId: 'blue-1',
          color: 'blue',
          ownerPlayerId: 'player-2',
          level: 0,
          x: 1,
          playedAtTurn: 2,
        },
      },
      occupiedCellKeys: ['0:0', '0:1'],
      baseMinX: 0,
      baseMaxX: 1,
    };

    expect(getLegalTargetsForColor(board, 'red')).toContainEqual({ level: 1, x: 0 });
    expect(getLegalTargetsForColor(board, 'blue')).toContainEqual({ level: 1, x: 0 });
    expect(getLegalTargetsForColor(board, 'yellow')).not.toContainEqual({ level: 1, x: 0 });
  });

  it('updates board, hand, revision, and state hash when a card is played', () => {
    const game = createLocalGame({ playerCount: 2, seed: 'play-test' });
    const firstMove = getLegalMovesForPlayer(game, 'player-1')[0];
    const result = playCard(game, 'player-1', firstMove.cardId, firstMove.target).state;

    expect(result.currentRound?.board.occupiedCellKeys).toHaveLength(1);
    expect(result.currentRound?.players['player-1'].handCardIds).toHaveLength(17);
    expect(result.currentRound?.activePlayerId).toBe('player-2');
    expect(result.revision).toBeGreaterThan(game.revision);
    expect(result.stateHash).not.toBe(game.stateHash);
  });

  it('scores blocked players by remaining cards and finished players with a two-point reduction', () => {
    let game = createLocalGame({ playerCount: 2, seed: 'scoring-test' });

    game = {
      ...game,
      currentRoundIndex: 1,
      players: game.players.map((player) =>
        player.playerId === 'player-1' ? { ...player, totalPenalty: 3 } : player,
      ),
      currentRound: {
        ...game.currentRound!,
        activePlayerId: 'player-1',
        players: {
          'player-1': {
            ...game.currentRound!.players['player-1'],
            handCardIds: [game.currentRound!.players['player-1'].handCardIds[0]],
            remainingCardCount: 1,
          },
          'player-2': {
            ...game.currentRound!.players['player-2'],
            status: 'blocked',
            blockedAtTurn: 1,
            handCardIds: game.currentRound!.players['player-2'].handCardIds.slice(0, 4),
            remainingCardCount: 4,
            roundPenaltyDelta: 4,
          },
        },
        eliminatedPlayerIds: ['player-2'],
      },
    };

    const finishingMove = getLegalMovesForPlayer(game, 'player-1')[0];
    const scored = playCard(game, 'player-1', finishingMove.cardId, finishingMove.target).state;

    expect(scored.status).toBe('game_result');
    expect(scored.players.find((player) => player.playerId === 'player-1')?.totalPenalty).toBe(1);
    expect(scored.players.find((player) => player.playerId === 'player-2')?.totalPenalty).toBe(4);
  });

  it('starts the next round with the next starting player when a round result is available', () => {
    let game = createLocalGame({ playerCount: 2, seed: 'next-round' });

    game = {
      ...game,
      status: 'round_result',
      currentRoundIndex: 0,
    };

    const next = startNextRound(game);

    expect(next.status).toBe('round_active');
    expect(next.currentRoundIndex).toBe(1);
    expect(next.currentRound?.startingPlayerId).toBe('player-2');
  });
});
