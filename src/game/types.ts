export const CARD_COLORS = ['green', 'yellow', 'red', 'purple', 'blue'] as const;

export type CardColor = (typeof CARD_COLORS)[number];
export type GameStatus = 'round_active' | 'round_result' | 'game_result';
export type RoundStatus = 'active' | 'ended';
export type RoundEndReason = 'all_players_blocked' | 'all_hands_empty' | 'all_players_resolved';
export type RoundPlayerStatus = 'active' | 'blocked' | 'finished';
export type PlayerId = string;
export type CardId = string;
export type CellKey = `${number}:${number}`;

export interface GameRulesConfig {
  minPlayers: 2;
  maxPlayers: 6;
  normalBaseWidth: 8;
  colors: CardColor[];
  deckComposition: Record<CardColor, number>;
  finishBonusPenaltyReduction: 2;
}

export interface CardInstance {
  cardId: CardId;
  color: CardColor;
  serial: number;
}

export interface GamePlayerState {
  playerId: PlayerId;
  seatIndex: number;
  displayName: string;
  isHost: boolean;
  isLocal: boolean;
  totalPenalty: number;
  roundsStarted: number[];
}

export interface RoundPlayerState {
  playerId: PlayerId;
  status: RoundPlayerStatus;
  handCardIds: CardId[];
  playedCardIds: CardId[];
  remainingCardCount: number;
  blockedAtTurn: number | null;
  finishedAtTurn: number | null;
  roundPenaltyDelta: number;
  receivedFinishBonus: boolean;
}

export interface BoardCardState {
  cardId: CardId;
  color: CardColor;
  ownerPlayerId: PlayerId;
  level: number;
  x: number;
  playedAtTurn: number;
}

export interface BoardState {
  baseWidthLimit: number;
  maxHeight: number;
  cardsByCell: Record<CellKey, BoardCardState>;
  occupiedCellKeys: CellKey[];
  baseMinX: number | null;
  baseMaxX: number | null;
}

export interface MoveTarget {
  level: number;
  x: number;
}

export interface PlayMove {
  type: 'play_card';
  playerId: PlayerId;
  cardId: CardId;
  target: MoveTarget;
}

export interface LegalMove {
  cardId: CardId;
  color: CardColor;
  target: MoveTarget;
}

export interface RoundDeckState {
  shuffledCardIds: CardId[];
  dealtCardIdsByPlayer: Record<PlayerId, CardId[]>;
  initialBoardCardIds: CardId[];
}

export interface RoundState {
  roundId: string;
  roundIndex: number;
  status: RoundStatus;
  startingPlayerId: PlayerId;
  activePlayerId: PlayerId | null;
  playerOrder: PlayerId[];
  turnNumber: number;
  deck: RoundDeckState;
  board: BoardState;
  players: Record<PlayerId, RoundPlayerState>;
  eliminatedPlayerIds: PlayerId[];
  finishedPlayerIds: PlayerId[];
  endedReason: RoundEndReason | null;
}

export interface RoundPlayerResult {
  playerId: PlayerId;
  remainingCards: number;
  penaltyDelta: number;
  receivedFinishBonus: boolean;
  status: RoundPlayerStatus;
}

export interface RoundSummary {
  roundId: string;
  roundIndex: number;
  startingPlayerId: PlayerId;
  endedReason: RoundEndReason;
  playerResults: RoundPlayerResult[];
}

export interface GameSessionState {
  gameId: string;
  status: GameStatus;
  rules: GameRulesConfig;
  players: GamePlayerState[];
  seatingOrder: PlayerId[];
  totalRounds: number;
  currentRoundIndex: number;
  startingPlayerOrder: PlayerId[];
  currentRound: RoundState | null;
  completedRounds: RoundSummary[];
  cardsById: Record<CardId, CardInstance>;
  randomSeed: string;
  revision: number;
  stateHash: string;
  eventLog: GameEvent[];
}

export type GameEvent =
  | {
      type: 'round_started';
      roundIndex: number;
      startingPlayerId: PlayerId;
      revision: number;
    }
  | {
      type: 'card_played';
      playerId: PlayerId;
      cardId: CardId;
      target: MoveTarget;
      revision: number;
    }
  | {
      type: 'player_blocked';
      playerId: PlayerId;
      remainingCards: number;
      revision: number;
    }
  | {
      type: 'player_finished';
      playerId: PlayerId;
      revision: number;
    }
  | {
      type: 'round_ended';
      roundIndex: number;
      endedReason: RoundEndReason;
      revision: number;
    };

export interface FinalStanding {
  playerId: PlayerId;
  displayName: string;
  totalPenalty: number;
  rank: number;
}
