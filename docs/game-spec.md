# Penguin Party ゲーム仕様メモ

この文書は、`Penguin Party` を実装するための状態設計メモです。
目的は「まず何を保持すべきか」を整理することで、UI 実装、ゲームロジック、マルチプレイ同期を分離しやすくすることです。

## 1. 前提と設計方針

### ルール前提

この仕様では、`docs/game-rules.ja.md` を正として設計します。
ルールに関する解釈がこの文書と食い違う場合は、常に `docs/game-rules.ja.md` を優先します。

この仕様では、次の前提で設計します。

- 2〜6人でプレイする
- 5人戦では余り1枚を最初の土台カードとして場に置く
- 2人戦では各18枚を配る
- 土台の上限幅は通常どおり8として扱う
- 手札を出し切ったら累積失点を2点減らす
- プレイヤー人数と同じラウンド数を行う
- 各ラウンドで開始プレイヤーを交代する
- ラウンド終了条件は「全員が出せなくなった」または「全員がカードを出し切った」

以後の状態設計も、この前提に合わせます。

### 設計方針

- ゲームルールの正状態は、UI とは切り離した純粋データとして持つ
- マルチプレイでは現在のゲームホストを authoritative にする
- ローカル Node.js サーバーは room list / room management / signaling のみを担当し、ゲームルールの正状態は持たない
- UI 用の選択状態やアニメーション状態は、ゲーム状態とは別に持つ
- UI では他人の手札を公開しない
- ホスト交代に備えた P2P 複製状態の扱いは `docs/network-spec.md` を優先する
- 小さいゲームなので、差分同期にこだわりすぎず「イベント + スナップショット」で十分

## 2. 状態の大分類

実装で持つ状態は、最低でも次の4層に分けるのが扱いやすいです。

1. `Rules State`
ゲームの正しいルール状態。勝敗判定や合法手判定に使う。

2. `Scene / UI State`
どの画面を表示しているか、何を選択中か、どのアニメーションを流しているか。

3. `Network State`
接続状況、再接続トークン、未送信コマンド、現在ホスト、host epoch、heartbeat、host migration 状態など。

4. `Persistence / Replay State`
セーブ、再接続、観戦、リプレイのためのイベントログやスナップショット。

## 3. ゲーム全体で保持するデータ

ゲーム全体で保持するのは、ラウンドをまたいで残るデータです。

```ts
type GameId = string;
type RoundId = string;
type PlayerId = string;
type CardId = string;

type GameStatus =
  | 'waiting_room'
  | 'starting'
  | 'round_active'
  | 'round_result'
  | 'game_result';

interface GameRulesConfig {
  minPlayers: 2;
  maxPlayers: 6;
  normalBaseWidth: 8;
  colors: CardColor[];
  deckComposition: Record<CardColor, number>;
  finishBonusPenaltyReduction: 2;
}

interface GameSessionState {
  gameId: GameId;
  status: GameStatus;
  createdAt: number;
  updatedAt: number;
  rules: GameRulesConfig;

  players: GamePlayerState[];
  seatingOrder: PlayerId[];

  totalRounds: number;
  currentRoundIndex: number;
  startingPlayerOrder: PlayerId[];

  currentRound: RoundState | null;
  completedRounds: RoundSummary[];

  randomSeed: string;
  revision: number;
}
```

`GameStatus.waiting_room` はゲーム開始前の待機状態です。
signaling server の `RoomMetadata.status` は `docs/network-spec.md` に合わせて `waiting_for_start` / `playing` を使い、UI scene と game session status では `waiting_room` と呼びます。

### `GameSessionState` に含めるべきもの

- プレイヤー一覧
- 席順
- 現在のラウンド番号
- 各ラウンドの開始プレイヤー順
- 累積失点
- 現在ラウンドの状態
- 終了済みラウンドの要約
- 乱数シード
- 同期用の revision

### `GameSessionState` に含めない方がよいもの

- 現在ホバーしているカード
- ドラッグ中座標
- アニメーションの進行率
- WebSocket インスタンス
- Pixi の display object 参照

## 4. ラウンドごとに保持するデータ

ラウンド状態は、そのラウンドが終わったらまとめて `RoundSummary` に圧縮できる形が理想です。

```ts
type RoundStatus = 'dealing' | 'active' | 'ended';

type RoundEndReason =
  | 'all_players_blocked'
  | 'all_hands_empty'
  | 'all_players_resolved'
  | 'forced_end';

interface RoundState {
  roundId: RoundId;
  roundIndex: number;
  status: RoundStatus;

  startingPlayerId: PlayerId;
  activePlayerId: PlayerId | null;
  turnNumber: number;

  deck: RoundDeckState;
  board: BoardState;
  players: Record<PlayerId, RoundPlayerState>;

  eliminatedPlayerIds: PlayerId[];
  finishedPlayerIds: PlayerId[];

  winnerCandidateIds: PlayerId[];
  endedReason: RoundEndReason | null;
}

interface RoundDeckState {
  shuffledCardIds: CardId[];
  dealtCardIdsByPlayer: Record<PlayerId, CardId[]>;
  initialBoardCardIds: CardId[];
}
```

### ラウンドで必要なこと

- 誰の手番か
- 何ターン目か
- 誰が脱落したか
- 誰が出し切ったか
- どのカードが誰に配られたか
- 5人戦で最初に場へ出たカード
- ラウンド終了理由
- `blocked` と `finished` が混在していても、全員が終端状態になったか

## 5. プレイヤーごとに保持するデータ

プレイヤー状態は、ゲーム全体で持つものと、ラウンド中だけ持つものを分けるのが安全です。

```ts
type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
type RoundPlayerStatus = 'active' | 'blocked' | 'finished';

interface GamePlayerState {
  playerId: PlayerId;
  seatIndex: number;
  displayName: string;
  avatarKey?: string;
  isHost: boolean;
  isLocal: boolean;

  connectionStatus: ConnectionStatus;
  ready: boolean;

  totalPenalty: number;
  roundsStarted: number[];
}

interface RoundPlayerState {
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
```

プレイヤーには、表示名、席順、接続状態、累積失点、手札、そのラウンドで出したカード、脱落状態、出し切り状態、そのラウンドで増減した失点を保持させます。
合法手一覧やボード座標キャッシュは毎回計算できるため、保存せず derived data として扱います。

## 6. カードデータ

カードは色しか情報を持たないように見えますが、同色カードが複数あるので `CardId` はユニークであるべきです。

```ts
type CardColor = 'green' | 'yellow' | 'red' | 'purple' | 'blue';

interface CardInstance {
  cardId: CardId;
  color: CardColor;
  serial: number;
}
```

`serial` は `green-1` のような区別用です。
これがあると、配札ログ・リプレイ・ネットワーク同期で扱いやすくなります。

## 7. 場のデータ構造

場は「2次元配列」より「座標付きの疎なマップ」で持つのがよいです。

理由:

- 土台が左にも右にも伸びる
- 上段のカード位置が、後から土台が伸びても壊れない
- 描画位置は後から計算できる

推奨する座標系:

- 土台を `level = 0` とする
- 横方向の位置を `x` とする
- 上段カードは `level > 0`
- `level = n, x = k` のカードは、下の `level = n - 1` の `x = k` と `x = k + 1` に支えられる

つまり、上段カードの座標は「下の2枚の左側の座標」に揃える形です。

```ts
type CellKey = `${number}:${number}`;

interface BoardCardState {
  cardId: CardId;
  color: CardColor;
  ownerPlayerId: PlayerId;
  level: number;
  x: number;
  playedAtTurn: number;
}

interface BoardState {
  baseWidthLimit: number;
  maxHeight: number;

  cardsByCell: Record<CellKey, BoardCardState>;
  occupiedCellKeys: CellKey[];

  baseMinX: number | null;
  baseMaxX: number | null;
}
```

この構造なら、最初のカードを `level: 0, x: 0` に置き、左端追加は `x = baseMinX - 1`、右端追加は `x = baseMaxX + 1`、上段配置は `level + 1, x` として扱えます。

## 8. 手番と合法手のデータ

合法手は状態として保存するより、関数で導出する方が安全です。

```ts
interface MoveTarget {
  level: number;
  x: number;
}

interface PlayMove {
  type: 'play_card';
  playerId: PlayerId;
  cardId: CardId;
  target: MoveTarget;
}

interface LegalMove {
  cardId: CardId;
  color: CardColor;
  target: MoveTarget;
}
```

合法手判定には、現在の `BoardState`、プレイヤーの `handCardIds`、`CardId -> CardInstance` の辞書、現在のルール設定が必要です。
返り値には、置けるカード一覧、各カードごとの置ける場所一覧、盤面側から見た合法ターゲット一覧、まったく置けないかどうかを含めると便利です。

## 9. 画面ごとの状態設計

ゲームの画面状態は、ルール状態から分けて持ちます。

```ts
type SceneKind =
  | 'landing_page'
  | 'matchmaking_lobby'
  | 'waiting_room'
  | 'game_play'
  | 'round_result'
  | 'game_result';

interface AppSceneState {
  scene: SceneKind;
  modal: ModalState | null;
}

type ModalState =
  | { kind: 'create_room' }
  | { kind: 'join_password'; roomId: string }
  | { kind: 'leave_room_confirm' }
  | { kind: 'connection_error'; message: string }
  | null;

interface MatchSceneUiState {
  selectedCardId: CardId | null;
  highlightedTargets: MoveTarget[];
  hoveredTarget: MoveTarget | null;

  draggingCardId: CardId | null;
  draggedScreenPosition: { x: number; y: number } | null;

  showPenaltyPreview: boolean;
  showRoundObjectiveBanner: boolean;
  lastResolvedActionId: string | null;
}
```

UI 状態には、選択中カード、ハイライト中の置き場所、モーダル表示状態、チュートリアル進行、アニメーション再生キュー、ネットワークエラー表示を置きます。
累積失点、誰の手番か、盤面の実際のカード配置、プレイヤー脱落状態はルール状態から読むべきです。

## 10. マルチプレイで送受信するデータ

基本方針:

- 非ホスト peer は「意図」を current host に送る
- current host は「検証済み結果」を全 peer に broadcast する
- host 自身の入力も同じ command validation path に通す
- ローカル Node.js サーバーは signaling / room list 専用で、ゲームコマンドを検証しない
- UI では他プレイヤーの手札を見せず、`remainingCardCount` だけを表示する
- ホスト交代に必要な完全複製状態の扱いは `docs/network-spec.md` を優先する
- 小規模ゲームなので、アクション確定後にイベントとスナップショットを送る方式で十分

```ts
type PeerCommand =
  | {
      type: 'join_waiting_room';
      gameId: GameId;
      displayName: string;
      reconnectToken?: string;
    }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_game' }
  | {
      type: 'play_card';
      actionId: string;
      cardId: CardId;
      target: MoveTarget;
    }
  | { type: 'request_rematch' }
  | { type: 'leave_game' }
  | { type: 'ping'; clientTime: number };

type HostMessage =
  | { type: 'snapshot'; state: ClientGameView }
  | { type: 'command_rejected'; actionId?: string; reason: string }
  | { type: 'player_presence_changed'; playerId: PlayerId; status: ConnectionStatus }
  | { type: 'round_started'; roundIndex: number }
  | { type: 'action_resolved'; action: ResolvedAction; state: ClientGameView }
  | { type: 'round_ended'; summary: RoundSummary; state: ClientGameView }
  | { type: 'game_ended'; result: GameResultView };

interface ClientGameView {
  publicState: PublicGameView;
  privateState: PrivatePlayerView | null;
  localRole: 'host' | 'player' | 'spectator';
}

interface PublicGameView {
  gameId: GameId;
  status: GameStatus;
  currentRoundIndex: number;
  board: BoardState;
  activePlayerId: PlayerId | null;
  players: PublicPlayerView[];
}

interface PublicPlayerView {
  playerId: PlayerId;
  displayName: string;
  seatIndex: number;
  totalPenalty: number;
  remainingCardCount: number;
  status: RoundPlayerStatus | 'waiting_room';
}

interface PrivatePlayerView {
  selfPlayerId: PlayerId;
  hand: CardInstance[];
  legalMoves?: LegalMove[];
  reconnectToken?: string;
}
```

UI 表示用の `ClientGameView` に含めるべきでないものは、他プレイヤーの `handCardIds`、他プレイヤーのカード色一覧、乱数シード全体、検証前の仮置き結果です。
spectator の `privateState` は `null` とし、手札、山札順、配札順、非公開乱数 seed を含めません。
ただし、ホスト切断後にゲームを継続するための P2P 複製状態では、`docs/network-spec.md` に従って完全なゲーム情報を player peer が保持する場合があります。
その場合でも、UI はローカルプレイヤー以外の手札を表示してはいけません。

## 11. ホスト権威 peer が持っておくと便利なもの

通常 UI には見せないが、current host の command validation と host migration のために持っていた方がよいデータです。

```ts
interface HostAuthorityState {
  hostPeerId: string;
  hostEpoch: number;
  reconnectSecrets: Record<PlayerId, string>;
  lastCommandIdsByPlayer: Record<PlayerId, string | null>;
  eventLog: GameEvent[];
  lastCommittedRevision: number;
  lastCommittedStateHash: string;
}
```

`eventLog` があると、リプレイ、バグ調査、再接続時の差分配信、host migration、将来の観戦機能に流用できます。

## 12. まとめ用データ

ラウンド終了やゲーム終了では、画面表示用の集約データがあると便利です。

```ts
interface RoundSummary {
  roundId: RoundId;
  roundIndex: number;
  startingPlayerId: PlayerId;
  endedReason: RoundEndReason;
  playerResults: RoundPlayerResult[];
}

interface RoundPlayerResult {
  playerId: PlayerId;
  remainingCards: number;
  penaltyDelta: number;
  receivedFinishBonus: boolean;
  status: RoundPlayerStatus;
}

interface GameResultView {
  winnerPlayerIds: PlayerId[];
  finalStandings: FinalStanding[];
}

interface FinalStanding {
  playerId: PlayerId;
  totalPenalty: number;
}
```

## 13. 最低限必要な純粋関数

ルール実装は、以下の純粋関数を先に作ると安定します。

```ts
function createDeck(config: GameRulesConfig): CardInstance[];
function createRoundDeck(playerIds: PlayerId[], deck: CardInstance[]): RoundDeckState;
function createInitialBoard(roundDeck: RoundDeckState, playerCount: number): BoardState;
function getLegalMoves(
  board: BoardState,
  hand: CardInstance[],
  rules: GameRulesConfig,
): LegalMove[];
function applyPlayMove(
  round: RoundState,
  move: PlayMove,
  cardsById: Record<CardId, CardInstance>,
): RoundState;
function autoResolveBlockedPlayer(round: RoundState): RoundState;
function isRoundOver(round: RoundState): boolean;
function buildRoundSummary(game: GameSessionState, round: RoundState): RoundSummary;
function applyRoundSummary(game: GameSessionState, summary: RoundSummary): GameSessionState;
```

このゲームは盤面が小さいので、最適化よりも「常に再計算できる純粋関数」を優先してよいです。

## 14. まずはここまで作ればよい最小構成

最初の実装では、以下だけあれば十分です。

1. `GameSessionState`
2. `RoundState`
3. `GamePlayerState`
4. `RoundPlayerState`
5. `CardInstance`
6. `BoardState`
7. `MoveTarget`
8. `PlayMove`
9. `RoundSummary`
10. `ClientGameView`

これで、ローカル対戦、CPU なしの手動検証、Pixi での盤面描画、将来のオンライン対戦まで見据えた構造になります。

## 15. 実装上のおすすめ

- 盤面は `Record<CellKey, BoardCardState>` で持つ
- UI は `selectedCardId` と `highlightedTargets` を分離する
- 他人の手札は `remainingCardCount` だけ見せる
- current host は `play_card` command を受け取って合法性を検証する
- ローカル Node.js サーバーは `play_card` を検証せず、room list / room management / signaling のみに使う
- ラウンド終了後は `RoundSummary` に圧縮し、現在ラウンドの詳細は破棄可能にする
- 乱数は `randomSeed` を持ち、配札を再現できるようにする

## 16. 次の一歩

この仕様から次に起こすなら、順番は次がよいです。

1. `src/game/types.ts` に型を定義する
2. `src/game/rules.ts` に合法手判定と着手適用を書く
3. `src/game/selectors.ts` に UI 用の導出関数を書く
4. `src/game/mock.ts` にローカル検証用のダミー状態を用意する
5. そのあとで Pixi の盤面描画をつなぐ
