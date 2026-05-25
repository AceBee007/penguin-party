import {
  CARD_COLORS,
  type BoardCardState,
  type BoardState,
  type CardColor,
  type CardId,
  type CardInstance,
  type CellKey,
  type FinalStanding,
  type GameEvent,
  type GamePlayerState,
  type GameRulesConfig,
  type GameSessionState,
  type LegalMove,
  type MoveTarget,
  type PlayerId,
  type RoundDeckState,
  type RoundEndReason,
  type RoundPlayerResult,
  type RoundPlayerState,
  type RoundState,
  type RoundSummary,
} from './types';

export const DEFAULT_RULES: GameRulesConfig = {
  minPlayers: 2,
  maxPlayers: 6,
  normalBaseWidth: 8,
  colors: [...CARD_COLORS],
  deckComposition: {
    green: 8,
    yellow: 7,
    red: 7,
    purple: 7,
    blue: 7,
  },
  finishBonusPenaltyReduction: 2,
};

export const CARD_COLOR_LABELS: Record<CardColor, string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  purple: 'Purple',
  blue: 'Blue',
};

interface CreateLocalGameOptions {
  playerCount?: number;
  seed?: string;
  playerNames?: string[];
}

interface PlayResult {
  state: GameSessionState;
  event: Extract<GameEvent, { type: 'card_played' }>;
}

export function createDeck(config: GameRulesConfig = DEFAULT_RULES): CardInstance[] {
  return config.colors.flatMap((color) =>
    Array.from({ length: config.deckComposition[color] }, (_, index) => ({
      cardId: `${color}-${index + 1}`,
      color,
      serial: index + 1,
    })),
  );
}

export function createLocalGame(options: CreateLocalGameOptions = {}): GameSessionState {
  const playerCount = options.playerCount ?? 2;

  if (playerCount < DEFAULT_RULES.minPlayers || playerCount > DEFAULT_RULES.maxPlayers) {
    throw new Error(`Penguin Party requires ${DEFAULT_RULES.minPlayers}-${DEFAULT_RULES.maxPlayers} players.`);
  }

  const deck = createDeck(DEFAULT_RULES);
  const cardsById = Object.fromEntries(deck.map((card) => [card.cardId, card]));
  const players: GamePlayerState[] = Array.from({ length: playerCount }, (_, index) => ({
    playerId: `player-${index + 1}`,
    seatIndex: index,
    displayName: options.playerNames?.[index] ?? (index === 0 ? 'You' : `Player ${index + 1}`),
    isHost: index === 0,
    isLocal: true,
    totalPenalty: 0,
    roundsStarted: [],
  }));
  const seed = options.seed ?? `local-${Date.now()}`;
  const baseState: GameSessionState = {
    gameId: `local-${seed}`,
    status: 'round_active',
    rules: DEFAULT_RULES,
    players,
    seatingOrder: players.map((player) => player.playerId),
    totalRounds: playerCount,
    currentRoundIndex: 0,
    startingPlayerOrder: players.map((player) => player.playerId),
    currentRound: null,
    completedRounds: [],
    cardsById,
    randomSeed: seed,
    revision: 0,
    stateHash: '',
    eventLog: [],
  };

  return startRound(baseState, 0);
}

export function startNextRound(game: GameSessionState): GameSessionState {
  if (game.status === 'game_result') {
    return game;
  }

  return startRound(game, game.currentRoundIndex + 1);
}

export function startRound(game: GameSessionState, roundIndex: number): GameSessionState {
  if (roundIndex >= game.totalRounds) {
    return withHash({
      ...game,
      status: 'game_result',
      currentRound: null,
      currentRoundIndex: game.totalRounds,
      revision: game.revision + 1,
    });
  }

  const playerIds = [...game.seatingOrder];
  const startingPlayerId = game.startingPlayerOrder[roundIndex % game.startingPlayerOrder.length];
  const shuffledDeck = shuffleCards(Object.values(game.cardsById), `${game.randomSeed}:round:${roundIndex}`);
  const roundDeck = createRoundDeck(playerIds, shuffledDeck);
  const board = createInitialBoard(roundDeck, playerIds.length, game.cardsById, game.rules);
  const players = Object.fromEntries(
    playerIds.map((playerId) => [
      playerId,
      {
        playerId,
        status: 'active' as const,
        handCardIds: [...roundDeck.dealtCardIdsByPlayer[playerId]],
        playedCardIds: [],
        remainingCardCount: roundDeck.dealtCardIdsByPlayer[playerId].length,
        blockedAtTurn: null,
        finishedAtTurn: null,
        roundPenaltyDelta: 0,
        receivedFinishBonus: false,
      },
    ]),
  );
  const round: RoundState = {
    roundId: `${game.gameId}-round-${roundIndex + 1}`,
    roundIndex,
    status: 'active',
    startingPlayerId,
    activePlayerId: startingPlayerId,
    playerOrder: rotatePlayerOrder(playerIds, startingPlayerId),
    turnNumber: 1,
    deck: roundDeck,
    board,
    players,
    eliminatedPlayerIds: [],
    finishedPlayerIds: [],
    endedReason: null,
  };
  const nextGame = withHash({
    ...game,
    status: 'round_active',
    currentRoundIndex: roundIndex,
    currentRound: round,
    players: game.players.map((player) =>
      player.playerId === startingPlayerId
        ? { ...player, roundsStarted: [...player.roundsStarted, roundIndex] }
        : player,
    ),
    revision: game.revision + 1,
    eventLog: [
      ...game.eventLog,
      {
        type: 'round_started',
        roundIndex,
        startingPlayerId,
        revision: game.revision + 1,
      },
    ],
  });

  return resolveActivePlayerAvailability(nextGame);
}

export function createRoundDeck(playerIds: PlayerId[], deck: CardInstance[]): RoundDeckState {
  const cardsPerPlayer = getCardsPerPlayer(playerIds.length);
  const dealtCardIdsByPlayer = Object.fromEntries(playerIds.map((playerId) => [playerId, [] as CardId[]]));
  let cursor = 0;

  for (const playerId of playerIds) {
    dealtCardIdsByPlayer[playerId] = deck.slice(cursor, cursor + cardsPerPlayer).map((card) => card.cardId);
    cursor += cardsPerPlayer;
  }

  const initialBoardCardIds = playerIds.length === 5 ? [deck[cursor].cardId] : [];

  return {
    shuffledCardIds: deck.map((card) => card.cardId),
    dealtCardIdsByPlayer,
    initialBoardCardIds,
  };
}

export function createInitialBoard(
  roundDeck: RoundDeckState,
  playerCount: number,
  cardsById: Record<CardId, CardInstance>,
  rules: GameRulesConfig = DEFAULT_RULES,
): BoardState {
  const board = createEmptyBoard(rules);

  if (playerCount === 5 && roundDeck.initialBoardCardIds.length > 0) {
    const card = cardsById[roundDeck.initialBoardCardIds[0]];
    return placeCardOnBoard(board, {
      cardId: card.cardId,
      color: card.color,
      ownerPlayerId: 'initial-board',
      level: 0,
      x: 0,
      playedAtTurn: 0,
    });
  }

  return board;
}

export function createEmptyBoard(rules: GameRulesConfig = DEFAULT_RULES): BoardState {
  return {
    baseWidthLimit: rules.normalBaseWidth,
    maxHeight: rules.normalBaseWidth,
    cardsByCell: {},
    occupiedCellKeys: [],
    baseMinX: null,
    baseMaxX: null,
  };
}

export function getLegalMovesForPlayer(game: GameSessionState, playerId: PlayerId): LegalMove[] {
  const round = game.currentRound;

  if (!round || round.status !== 'active') {
    return [];
  }

  const player = round.players[playerId];

  if (!player || player.status !== 'active') {
    return [];
  }

  const hand = player.handCardIds.map((cardId) => game.cardsById[cardId]);
  return getLegalMoves(round.board, hand, game.rules);
}

export function getLegalMoves(board: BoardState, hand: CardInstance[], rules: GameRulesConfig = DEFAULT_RULES): LegalMove[] {
  return hand.flatMap((card) =>
    getLegalTargetsForColor(board, card.color, rules).map((target) => ({
      cardId: card.cardId,
      color: card.color,
      target,
    })),
  );
}

export function getLegalTargetsForColor(
  board: BoardState,
  color: CardColor,
  rules: GameRulesConfig = DEFAULT_RULES,
): MoveTarget[] {
  const targets: MoveTarget[] = [];

  if (board.occupiedCellKeys.length === 0) {
    return [{ level: 0, x: 0 }];
  }

  const baseCount = getBaseCardCount(board);

  if (baseCount < rules.normalBaseWidth && board.baseMinX !== null && board.baseMaxX !== null) {
    targets.push({ level: 0, x: board.baseMinX - 1 }, { level: 0, x: board.baseMaxX + 1 });
  }

  for (let level = 1; level < board.maxHeight; level += 1) {
    const supportLevel = level - 1;
    const possibleXs = getOccupiedXsAtLevel(board, supportLevel);

    for (const x of possibleXs) {
      const left = getBoardCard(board, supportLevel, x);
      const right = getBoardCard(board, supportLevel, x + 1);

      if (!left || !right || getBoardCard(board, level, x)) {
        continue;
      }

      if (left.color === color || right.color === color) {
        targets.push({ level, x });
      }
    }
  }

  return uniqueTargets(targets).sort(sortTargets);
}

export function playCard(game: GameSessionState, playerId: PlayerId, cardId: CardId, target: MoveTarget): PlayResult {
  const round = game.currentRound;

  if (!round || round.status !== 'active') {
    throw new Error('No active round.');
  }

  if (round.activePlayerId !== playerId) {
    throw new Error('It is not this player turn.');
  }

  const player = round.players[playerId];

  if (!player || player.status !== 'active') {
    throw new Error('Player is not active.');
  }

  if (!player.handCardIds.includes(cardId)) {
    throw new Error('Card is not in player hand.');
  }

  const legalMoves = getLegalMovesForPlayer(game, playerId);
  const isLegal = legalMoves.some((move) => move.cardId === cardId && sameTarget(move.target, target));

  if (!isLegal) {
    throw new Error('Illegal move.');
  }

  const card = game.cardsById[cardId];
  const nextRound: RoundState = {
    ...round,
    turnNumber: round.turnNumber + 1,
    board: placeCardOnBoard(round.board, {
      cardId,
      color: card.color,
      ownerPlayerId: playerId,
      level: target.level,
      x: target.x,
      playedAtTurn: round.turnNumber,
    }),
    players: {
      ...round.players,
      [playerId]: updateRoundPlayerAfterPlay(player, cardId, round.turnNumber),
    },
  };
  const nextRevision = game.revision + 1;
  const event: Extract<GameEvent, { type: 'card_played' }> = {
    type: 'card_played',
    playerId,
    cardId,
    target,
    revision: nextRevision,
  };
  const nextGame = withHash({
    ...game,
    currentRound: nextRound,
    revision: nextRevision,
    eventLog: [...game.eventLog, event],
  });

  return {
    state: advanceAfterAction(nextGame, playerId),
    event,
  };
}

export function resolveCurrentPlayerNoMoves(game: GameSessionState): GameSessionState {
  const round = game.currentRound;
  const activePlayerId = round?.activePlayerId;

  if (!round || !activePlayerId) {
    return game;
  }

  if (getLegalMovesForPlayer(game, activePlayerId).length > 0) {
    return game;
  }

  return blockPlayerAndContinue(game, activePlayerId);
}

export function getFinalStandings(game: GameSessionState): FinalStanding[] {
  const sorted = [...game.players].sort((a, b) => a.totalPenalty - b.totalPenalty || a.seatIndex - b.seatIndex);
  let previousPenalty: number | null = null;
  let currentRank = 0;

  return sorted.map((player, index) => {
    if (previousPenalty === null || player.totalPenalty !== previousPenalty) {
      currentRank = index + 1;
      previousPenalty = player.totalPenalty;
    }

    return {
      playerId: player.playerId,
      displayName: player.displayName,
      totalPenalty: player.totalPenalty,
      rank: currentRank,
    };
  });
}

export function getActivePlayer(game: GameSessionState): GamePlayerState | null {
  const activePlayerId = game.currentRound?.activePlayerId;
  return activePlayerId ? (game.players.find((player) => player.playerId === activePlayerId) ?? null) : null;
}

export function getCurrentRoundPlayer(game: GameSessionState, playerId: PlayerId): RoundPlayerState | null {
  return game.currentRound?.players[playerId] ?? null;
}

export function cellKey(level: number, x: number): CellKey {
  return `${level}:${x}`;
}

export function getBoardCard(board: BoardState, level: number, x: number): BoardCardState | null {
  return board.cardsByCell[cellKey(level, x)] ?? null;
}

export function sameTarget(a: MoveTarget, b: MoveTarget): boolean {
  return a.level === b.level && a.x === b.x;
}

export function buildStateHash(game: Omit<GameSessionState, 'stateHash'>): string {
  const stable = stableStringify({
    gameId: game.gameId,
    status: game.status,
    players: game.players,
    seatingOrder: game.seatingOrder,
    totalRounds: game.totalRounds,
    currentRoundIndex: game.currentRoundIndex,
    currentRound: game.currentRound,
    completedRounds: game.completedRounds,
    randomSeed: game.randomSeed,
    revision: game.revision,
  });
  let hash = 2166136261;

  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function advanceAfterAction(game: GameSessionState, playedByPlayerId: PlayerId): GameSessionState {
  const round = game.currentRound;

  if (!round) {
    return game;
  }

  const player = round.players[playedByPlayerId];

  if (player.status === 'finished') {
    const finishEvent: Extract<GameEvent, { type: 'player_finished' }> = {
      type: 'player_finished',
      playerId: playedByPlayerId,
      revision: game.revision + 1,
    };
    const withFinishEvent = withHash({
      ...game,
      revision: game.revision + 1,
      eventLog: [...game.eventLog, finishEvent],
    });

    return advanceTurnFrom(withFinishEvent, playedByPlayerId);
  }

  return advanceTurnFrom(game, playedByPlayerId);
}

function advanceTurnFrom(game: GameSessionState, previousPlayerId: PlayerId): GameSessionState {
  const round = game.currentRound;

  if (!round) {
    return game;
  }

  if (isRoundOver(round)) {
    return endRound(game);
  }

  const nextPlayerId = findNextActivePlayerId(round, previousPlayerId);

  if (!nextPlayerId) {
    return endRound(game);
  }

  const withNextTurn = withHash({
    ...game,
    currentRound: {
      ...round,
      activePlayerId: nextPlayerId,
    },
  });

  return resolveActivePlayerAvailability(withNextTurn);
}

function resolveActivePlayerAvailability(game: GameSessionState): GameSessionState {
  const round = game.currentRound;
  const activePlayerId = round?.activePlayerId;

  if (!round || !activePlayerId || round.status !== 'active') {
    return game;
  }

  const player = round.players[activePlayerId];

  if (!player || player.status !== 'active') {
    return advanceTurnFrom(game, activePlayerId);
  }

  if (player.handCardIds.length === 0) {
    return markPlayerFinished(game, activePlayerId);
  }

  if (getLegalMovesForPlayer(game, activePlayerId).length === 0) {
    return blockPlayerAndContinue(game, activePlayerId);
  }

  return game;
}

function blockPlayerAndContinue(game: GameSessionState, playerId: PlayerId): GameSessionState {
  const round = game.currentRound;

  if (!round) {
    return game;
  }

  const player = round.players[playerId];
  const nextRevision = game.revision + 1;
  const blockedPlayer: RoundPlayerState = {
    ...player,
    status: 'blocked',
    blockedAtTurn: round.turnNumber,
    remainingCardCount: player.handCardIds.length,
    roundPenaltyDelta: player.handCardIds.length,
  };
  const nextRound: RoundState = {
    ...round,
    players: {
      ...round.players,
      [playerId]: blockedPlayer,
    },
    eliminatedPlayerIds: uniqueStrings([...round.eliminatedPlayerIds, playerId]),
  };
  const nextGame = withHash({
    ...game,
    currentRound: nextRound,
    revision: nextRevision,
    eventLog: [
      ...game.eventLog,
      {
        type: 'player_blocked',
        playerId,
        remainingCards: blockedPlayer.remainingCardCount,
        revision: nextRevision,
      },
    ],
  });

  return advanceTurnFrom(nextGame, playerId);
}

function markPlayerFinished(game: GameSessionState, playerId: PlayerId): GameSessionState {
  const round = game.currentRound;

  if (!round) {
    return game;
  }

  const player = round.players[playerId];
  const nextRevision = game.revision + 1;
  const nextRound: RoundState = {
    ...round,
    players: {
      ...round.players,
      [playerId]: {
        ...player,
        status: 'finished',
        finishedAtTurn: round.turnNumber,
        remainingCardCount: 0,
        receivedFinishBonus: true,
      },
    },
    finishedPlayerIds: uniqueStrings([...round.finishedPlayerIds, playerId]),
  };
  const nextGame = withHash({
    ...game,
    currentRound: nextRound,
    revision: nextRevision,
    eventLog: [
      ...game.eventLog,
      {
        type: 'player_finished',
        playerId,
        revision: nextRevision,
      },
    ],
  });

  return advanceTurnFrom(nextGame, playerId);
}

function endRound(game: GameSessionState): GameSessionState {
  const round = game.currentRound;

  if (!round || round.status === 'ended') {
    return game;
  }

  const endedReason = getRoundEndReason(round);
  const endedRound: RoundState = {
    ...round,
    status: 'ended',
    activePlayerId: null,
    endedReason,
  };
  const summary = buildRoundSummary(endedRound, endedReason);
  const scoredPlayers = applyRoundSummary(game.players, summary, game.rules);
  const nextRevision = game.revision + 1;
  const hasMoreRounds = game.currentRoundIndex + 1 < game.totalRounds;
  const nextGame = withHash({
    ...game,
    status: hasMoreRounds ? 'round_result' : 'game_result',
    currentRound: endedRound,
    completedRounds: [...game.completedRounds, summary],
    players: scoredPlayers,
    revision: nextRevision,
    eventLog: [
      ...game.eventLog,
      {
        type: 'round_ended',
        roundIndex: round.roundIndex,
        endedReason,
        revision: nextRevision,
      },
    ],
  });

  return nextGame;
}

function buildRoundSummary(round: RoundState, endedReason: RoundEndReason): RoundSummary {
  const playerResults: RoundPlayerResult[] = round.playerOrder.map((playerId) => {
    const player = round.players[playerId];
    const remainingCards = player.handCardIds.length;

    return {
      playerId,
      remainingCards,
      penaltyDelta: player.status === 'blocked' ? remainingCards : 0,
      receivedFinishBonus: player.status === 'finished',
      status: player.status,
    };
  });

  return {
    roundId: round.roundId,
    roundIndex: round.roundIndex,
    startingPlayerId: round.startingPlayerId,
    endedReason,
    playerResults,
  };
}

function applyRoundSummary(
  players: GamePlayerState[],
  summary: RoundSummary,
  rules: GameRulesConfig,
): GamePlayerState[] {
  return players.map((player) => {
    const result = summary.playerResults.find((candidate) => candidate.playerId === player.playerId);

    if (!result) {
      return player;
    }

    const withPenalty = player.totalPenalty + result.penaltyDelta;
    const totalPenalty = result.receivedFinishBonus
      ? Math.max(0, withPenalty - rules.finishBonusPenaltyReduction)
      : withPenalty;

    return {
      ...player,
      totalPenalty,
    };
  });
}

function getRoundEndReason(round: RoundState): RoundEndReason {
  const players = Object.values(round.players);

  if (players.every((player) => player.status === 'finished')) {
    return 'all_hands_empty';
  }

  if (players.every((player) => player.status === 'blocked')) {
    return 'all_players_blocked';
  }

  return 'all_players_resolved';
}

function isRoundOver(round: RoundState): boolean {
  return Object.values(round.players).every((player) => player.status !== 'active');
}

function findNextActivePlayerId(round: RoundState, previousPlayerId: PlayerId): PlayerId | null {
  const startIndex = round.playerOrder.indexOf(previousPlayerId);

  for (let offset = 1; offset <= round.playerOrder.length; offset += 1) {
    const playerId = round.playerOrder[(startIndex + offset + round.playerOrder.length) % round.playerOrder.length];

    if (round.players[playerId].status === 'active') {
      return playerId;
    }
  }

  return null;
}

function updateRoundPlayerAfterPlay(player: RoundPlayerState, cardId: CardId, turnNumber: number): RoundPlayerState {
  const handCardIds = player.handCardIds.filter((candidate) => candidate !== cardId);
  const hasFinished = handCardIds.length === 0;

  return {
    ...player,
    status: hasFinished ? 'finished' : player.status,
    handCardIds,
    playedCardIds: [...player.playedCardIds, cardId],
    remainingCardCount: handCardIds.length,
    finishedAtTurn: hasFinished ? turnNumber : player.finishedAtTurn,
    receivedFinishBonus: hasFinished,
  };
}

function placeCardOnBoard(board: BoardState, card: BoardCardState): BoardState {
  const key = cellKey(card.level, card.x);
  const nextCardsByCell = {
    ...board.cardsByCell,
    [key]: card,
  };
  const occupiedCellKeys = uniqueStrings([...board.occupiedCellKeys, key]) as CellKey[];

  return {
    ...board,
    cardsByCell: nextCardsByCell,
    occupiedCellKeys,
    baseMinX: card.level === 0 ? Math.min(board.baseMinX ?? card.x, card.x) : board.baseMinX,
    baseMaxX: card.level === 0 ? Math.max(board.baseMaxX ?? card.x, card.x) : board.baseMaxX,
  };
}

function getCardsPerPlayer(playerCount: number): number {
  const cardsPerPlayer: Record<number, number> = {
    2: 18,
    3: 12,
    4: 9,
    5: 7,
    6: 6,
  };

  const count = cardsPerPlayer[playerCount];

  if (!count) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }

  return count;
}

function getBaseCardCount(board: BoardState): number {
  return board.occupiedCellKeys.filter((key) => board.cardsByCell[key].level === 0).length;
}

function getOccupiedXsAtLevel(board: BoardState, level: number): number[] {
  return board.occupiedCellKeys
    .map((key) => board.cardsByCell[key])
    .filter((card) => card.level === level)
    .map((card) => card.x)
    .sort((a, b) => a - b);
}

function rotatePlayerOrder(playerIds: PlayerId[], startingPlayerId: PlayerId): PlayerId[] {
  const startIndex = playerIds.indexOf(startingPlayerId);

  if (startIndex < 0) {
    return playerIds;
  }

  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function shuffleCards(cards: CardInstance[], seed: string): CardInstance[] {
  const shuffled = [...cards];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function createSeededRandom(seed: string): () => number {
  let state = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 3432918353);
    state = (state << 13) | (state >>> 19);
  }

  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

function uniqueTargets(targets: MoveTarget[]): MoveTarget[] {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = cellKey(target.level, target.x);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortTargets(a: MoveTarget, b: MoveTarget): number {
  return a.level - b.level || a.x - b.x;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function withHash(state: Omit<GameSessionState, 'stateHash'> & { stateHash?: string }): GameSessionState {
  const withoutHash = Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== 'stateHash'),
  ) as Omit<GameSessionState, 'stateHash'>;

  return {
    ...withoutHash,
    stateHash: buildStateHash(withoutHash),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
