import { useCallback, useMemo, useState } from 'react';
import { BrandTitle } from './components/BrandTitle';
import { MultiplayerGame } from './components/MultiplayerGame';
import { PixiDragStage } from './components/PixiDragStage';
import {
  buildStateHash,
  CARD_COLOR_LABELS,
  createLocalGame,
  getActivePlayer,
  getCurrentRoundPlayer,
  getFinalStandings,
  getLegalMovesForPlayer,
  playCard,
  resolveCurrentPlayerNoMoves,
  startNextRound,
} from './game/rules';
import type { CardId, MoveTarget } from './game/types';

export function App() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  const isLocalTestMode = mode === 'local-test';

  if (isLocalTestMode) {
    return <LocalGame />;
  }

  return <MultiplayerGame />;
}

function LocalGame() {
  const [game, setGame] = useState(createInitialLocalGame);
  const [message, setMessage] = useState('Drag a card to a highlighted pyramid slot.');
  const activePlayer = getActivePlayer(game);
  const activePlayerId = activePlayer?.playerId ?? null;
  const legalMoves = useMemo(
    () => (activePlayerId ? getLegalMovesForPlayer(game, activePlayerId) : []),
    [activePlayerId, game],
  );
  const activeRoundPlayer = activePlayerId ? getCurrentRoundPlayer(game, activePlayerId) : null;
  const localHandPlayerId = activePlayerId ?? game.seatingOrder[0] ?? null;
  const standings = getFinalStandings(game);

  const handlePlayCard = useCallback(
    (cardId: CardId, target: MoveTarget) => {
      if (!activePlayerId) {
        return;
      }

      setGame((currentGame) => {
        try {
          const result = playCard(currentGame, activePlayerId, cardId, target);
          const card = currentGame.cardsById[cardId];
          setMessage(`${currentGame.players.find((player) => player.playerId === activePlayerId)?.displayName} played ${CARD_COLOR_LABELS[card.color]}.`);
          return result.state;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Move rejected.');
          return currentGame;
        }
      });
    },
    [activePlayerId],
  );

  const handleResolveNoMoves = useCallback(() => {
    setGame((currentGame) => resolveCurrentPlayerNoMoves(currentGame));
    setMessage('No legal move was available, so the active player was eliminated for this round.');
  }, []);

  const handleNextRound = useCallback(() => {
    setGame((currentGame) => startNextRound(currentGame));
    setMessage('Next round started.');
  }, []);

  const handleReset = useCallback(() => {
    setGame(createLocalGame({ playerCount: 2, seed: `local-${Date.now()}` }));
    setMessage('Started a new local verification game.');
  }, []);

  const boardCount = game.currentRound?.board.occupiedCellKeys.length ?? 0;
  const activeHandCount = activeRoundPlayer?.remainingCardCount ?? 0;
  const latestSummary = game.completedRounds.at(-1);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand__copy">
            <BrandTitle />
            <span className="brand__mode">Local verification mode</span>
          </div>
        </div>
        <div className="connection-indicator" aria-label="Local connection good">
          <span className="connection-indicator__dot" />
          Local
        </div>
      </header>

      <section className="game-shell" aria-label="Penguin Party local game">
        <aside className="scoreboard" aria-label="Players">
          <div className="scoreboard__header">
            <span>Round {Math.min(game.currentRoundIndex + 1, game.totalRounds)} / {game.totalRounds}</span>
            <strong data-round-status>{game.status.replace('_', ' ')}</strong>
          </div>
          <div className="player-list">
            {game.players.map((player) => {
              const roundPlayer = getCurrentRoundPlayer(game, player.playerId);
              const isActive = player.playerId === activePlayerId;

              return (
                <div className="player-row" data-active={isActive} key={player.playerId}>
                  <div>
                    <strong>{player.displayName}</strong>
                    <span>{roundPlayer?.status ?? 'between rounds'}</span>
                  </div>
                  <div className="player-row__stats">
                    <span>{roundPlayer?.remainingCardCount ?? 0} cards</span>
                    <span>{player.totalPenalty} pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="play-area">
          <div className="action-bar">
            <div className="action-bar__buttons">
              {game.status === 'round_active' && legalMoves.length === 0 ? (
                <button type="button" onClick={handleResolveNoMoves}>
                  Resolve no moves
                </button>
              ) : null}
              {game.status === 'round_result' ? (
                <button type="button" onClick={handleNextRound}>
                  Next round
                </button>
              ) : null}
              <button type="button" onClick={handleReset}>
                New local game
              </button>
            </div>
          </div>

          <div className="stage-frame">
            <PixiDragStage
              activePlayerId={activePlayerId}
              game={game}
              handPlayerId={localHandPlayerId}
              legalMoves={legalMoves}
              onPlayCard={handlePlayCard}
            />
          </div>

          <p className="game-message" data-game-message>{message}</p>
        </section>

        <aside className="round-panel" aria-label="Round details">
          <div className="metric-grid">
            <div>
              <span>Board</span>
              <strong data-board-count>{boardCount}</strong>
            </div>
            <div>
              <span>Hand</span>
              <strong data-hand-count>{activeHandCount}</strong>
            </div>
            <div>
              <span>Legal</span>
              <strong data-legal-count>{legalMoves.length}</strong>
            </div>
            <div>
              <span>Revision</span>
              <strong data-revision>{game.revision}</strong>
            </div>
          </div>

          {latestSummary ? (
            <div className="summary-panel" data-round-summary>
              <h2>Last round</h2>
              <p>{latestSummary.endedReason.replaceAll('_', ' ')}</p>
              {latestSummary.playerResults.map((result) => (
                <div className="summary-row" key={result.playerId}>
                  <span>{game.players.find((player) => player.playerId === result.playerId)?.displayName}</span>
                  <strong>{formatPenaltyDelta(result.netPenaltyDelta)} pts</strong>
                </div>
              ))}
            </div>
          ) : null}

          {game.status === 'game_result' ? (
            <div className="summary-panel" data-game-result>
              <h2>Final</h2>
              {standings.map((standing) => (
                <div className="summary-row" key={standing.playerId}>
                  <span>#{standing.rank} {standing.displayName}</span>
                  <strong>{standing.totalPenalty} pts</strong>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function createInitialLocalGame() {
  const params = new URLSearchParams(window.location.search);
  const game = createLocalGame({ playerCount: 2, seed: params.get('seed') ?? 'goal-1-local' });

  if (params.get('state') === 'round-complete-hand') {
    return createRoundCompleteHandPreview(game);
  }

  return game;
}

function createRoundCompleteHandPreview(game: ReturnType<typeof createLocalGame>) {
  const round = game.currentRound;

  if (!round) {
    return game;
  }

  const endedPlayers = Object.fromEntries(
    Object.entries(round.players).map(([playerId, player], index) => {
      const handCardIds = player.handCardIds.slice(0, index === 0 ? 5 : 3);

      return [
        playerId,
        {
          ...player,
          blockedAtTurn: round.turnNumber,
          handCardIds,
          remainingCardCount: handCardIds.length,
          roundPenaltyDelta: handCardIds.length,
          status: 'blocked' as const,
        },
      ];
    }),
  );
  const endedRound = {
    ...round,
    activePlayerId: null,
    eliminatedPlayerIds: round.playerOrder,
    endedReason: 'all_players_resolved' as const,
    players: endedPlayers,
    status: 'ended' as const,
  };
  const nextGame = {
    ...game,
    currentRound: endedRound,
    revision: game.revision + 1,
    status: 'round_result' as const,
  };

  return {
    ...nextGame,
    stateHash: buildStateHash(nextGame),
  };
}

function formatPenaltyDelta(penaltyDelta: number): string {
  if (penaltyDelta === 0) {
    return '+0';
  }

  return penaltyDelta > 0 ? `+${penaltyDelta}` : String(penaltyDelta);
}
