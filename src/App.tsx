import { useCallback, useMemo, useState } from 'react';
import { BrandTitle } from './components/BrandTitle';
import { useSelectedLocale } from './components/LanguageSelector';
import { MultiplayerGame } from './components/MultiplayerGame';
import { PixiDragStage } from './components/PixiDragStage';
import {
  buildStateHash,
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
import {
  cardColorLabel,
  gameStatusLabel,
  roundEndReasonLabel,
  roundPlayerStatusLabel,
  t,
} from './i18n/uiText';
import type { LocaleCode } from './i18n/uiText';

export function App() {
  const locale = useSelectedLocale();
  const mode = new URLSearchParams(window.location.search).get('mode');
  const isLocalTestMode = mode === 'local-test';

  if (isLocalTestMode) {
    return <LocalGame locale={locale} />;
  }

  return <MultiplayerGame locale={locale} />;
}

interface LocaleAwareProps {
  locale: LocaleCode;
}

interface LocalGameProps extends LocaleAwareProps {
  initialGame?: ReturnType<typeof createLocalGame>;
}

export function LocalGame({ locale, initialGame }: LocalGameProps) {
  const [game, setGame] = useState(() => initialGame ?? createInitialLocalGame());
  const [message, setMessage] = useState(t('message.initialLocal'));
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
          setMessage(t('message.cardPlayed', {
            color: cardColorLabel(card.color),
            displayName: currentGame.players.find((player) => player.playerId === activePlayerId)?.displayName,
          }));
          return result.state;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : t('message.moveRejected'));
          return currentGame;
        }
      });
    },
    [activePlayerId],
  );

  const handleResolveNoMoves = useCallback(() => {
    setGame((currentGame) => resolveCurrentPlayerNoMoves(currentGame));
    setMessage(t('message.noLegalMoveResolved'));
  }, []);

  const handleNextRound = useCallback(() => {
    setGame((currentGame) => startNextRound(currentGame));
    setMessage(t('message.nextRoundStarted'));
  }, []);

  const handleReset = useCallback(() => {
    setGame(createLocalGame({ playerCount: 2, playerNames: createLocalPlayerNames(2), seed: `local-${Date.now()}` }));
    setMessage(t('message.startedLocalGame'));
  }, []);

  const boardCount = game.currentRound?.board.occupiedCellKeys.length ?? 0;
  const activeHandCount = activeRoundPlayer?.remainingCardCount ?? 0;
  const latestSummary = game.completedRounds.at(-1);

  return (
    <main className="app-shell" lang={locale}>
      <header className="topbar">
        <div className="brand">
          <div className="brand__copy">
            <BrandTitle />
            <span className="brand__mode">{t('local.mode')}</span>
          </div>
        </div>
        <div className="connection-indicator" aria-label={t('aria.connectionLocalGood')}>
          <span className="connection-indicator__dot" />
          {t('connection.local')}
        </div>
      </header>

      <section className="game-shell" aria-label={t('aria.localGame')}>
        <aside className="scoreboard" aria-label={t('aria.players')}>
          <div className="scoreboard__header">
            <span>{t('common.roundOfTotal', {
              round: Math.min(game.currentRoundIndex + 1, game.totalRounds),
              total: game.totalRounds,
            })}</span>
            <strong data-round-status>{gameStatusLabel(game.status)}</strong>
          </div>
          <div className="player-list">
            {game.players.map((player) => {
              const roundPlayer = getCurrentRoundPlayer(game, player.playerId);
              const isActive = player.playerId === activePlayerId;

              return (
                <div className="player-row" data-active={isActive} key={player.playerId}>
                  <div>
                    <strong>{player.displayName}</strong>
                    <span>{roundPlayer ? roundPlayerStatusLabel(roundPlayer.status) : t('player.betweenRounds')}</span>
                  </div>
                  <div className="player-row__stats">
                    <span>{t('common.cards', { count: roundPlayer?.remainingCardCount ?? 0 })}</span>
                    <span>{t('common.points', { count: player.totalPenalty })}</span>
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
                  {t('button.resolveNoMoves')}
                </button>
              ) : null}
              {game.status === 'round_result' ? (
                <button type="button" onClick={handleNextRound}>
                  {t('button.nextRound')}
                </button>
              ) : null}
              <button type="button" onClick={handleReset}>
                {t('button.newLocalGame')}
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

        <aside className="round-panel" aria-label={t('aria.roundDetails')}>
          <div className="metric-grid">
            <div>
              <span>{t('metric.board')}</span>
              <strong data-board-count>{boardCount}</strong>
            </div>
            <div>
              <span>{t('metric.hand')}</span>
              <strong data-hand-count>{activeHandCount}</strong>
            </div>
            <div>
              <span>{t('metric.legal')}</span>
              <strong data-legal-count>{legalMoves.length}</strong>
            </div>
            <div>
              <span>{t('metric.revision')}</span>
              <strong data-revision>{game.revision}</strong>
            </div>
          </div>

          {latestSummary ? (
            <div className="summary-panel" data-round-summary>
              <h2>{t('summary.lastRound')}</h2>
              <p>{roundEndReasonLabel(latestSummary.endedReason)}</p>
              {latestSummary.playerResults.map((result) => (
                <div className="summary-row" key={result.playerId}>
                  <span>{game.players.find((player) => player.playerId === result.playerId)?.displayName}</span>
                  <strong>{t('common.points', { count: formatPenaltyDelta(result.netPenaltyDelta) })}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {game.status === 'game_result' ? (
            <div className="summary-panel" data-game-result>
              <h2>{t('summary.final')}</h2>
              {standings.map((standing) => (
                <div className="summary-row" key={standing.playerId}>
                  <span>{t('common.rankedName', { displayName: standing.displayName, rank: standing.rank })}</span>
                  <strong>{t('common.points', { count: standing.totalPenalty })}</strong>
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
  const game = createLocalGame({
    playerCount: 2,
    playerNames: createLocalPlayerNames(2),
    seed: params.get('seed') ?? 'goal-1-local',
  });

  if (params.get('state') === 'round-complete-hand') {
    return createRoundCompleteHandPreview(game);
  }

  return game;
}

function createLocalPlayerNames(playerCount: number): string[] {
  return Array.from({ length: playerCount }, (_, index) =>
    index === 0 ? t('player.local') : t('player.numbered', { number: index + 1 }),
  );
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
