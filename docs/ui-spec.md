# Penguin Party UI 仕様

この文書は、`Penguin Party` の画面仕様を AI 実装者が迷わず実装できる粒度に整理したものです。
ゲームルールは `docs/game-rules.ja.md`、ゲーム状態設計は `docs/game-spec.md`、P2P 通信仕様は `docs/network-spec.md` を参照します。

## 1. 目的

UI の目的は、2〜6人の P2P マルチプレイを次の流れで遊べるようにすることです。

1. ルーム一覧を見る
2. ルームを作成する、または既存ルームに参加する
3. ゲーム開始まで待機する
4. 手札からカードをドラッグして場に出す
5. 脱落、上がり、ラウンド終了、ゲーム終了を視覚的に理解できる
6. ゲーム終了後に今回の結果と累積ランキングを見る

起動時のデフォルト画面は P2P マルチプレイです。
ローカル検証モードはテスト用の入口として `?mode=local-test` を指定した場合だけ表示します。

## 2. 画面一覧

実装する画面は次の通りです。

```ts
type AppScene =
  | 'matchmaking_lobby'
  | 'create_room'
  | 'waiting_room'
  | 'game_play'
  | 'round_result'
  | 'game_result';
```

モーダルまたは dialog として次を使います。

```ts
type AppDialog =
  | 'join_name'
  | 'join_password'
  | 'leave_room_confirm'
  | 'connection_error'
  | null;
```

## 3. 共通 UI

### 接続状況インジケーター

すべてのゲームシーンの左上に、常時接続状況を表示します。
対象シーンは `matchmaking_lobby`、`create_room`、`waiting_room`、`game_play`、`game_result` です。

表示内容:

- Wi-Fi 形状のアイコン
- 接続状態を示す色
- 必要に応じて短い状態テキスト

色の方針:

- 良好: 緑
- 不安定: 黄〜赤の中間色
- 切断: 赤
- 再接続中: 緑から赤へ向かうグラデーションまたはアニメーション

```ts
type ConnectionQuality = 'good' | 'unstable' | 'reconnecting' | 'disconnected';

interface ConnectionIndicatorView {
  quality: ConnectionQuality;
  label: string;
  peerCount: number;
  connectedPeerCount: number;
}
```

実装メモ:

- アイコンは `lucide-react` を導入する場合、`Wifi`, `WifiOff`, `Signal` 系を使う
- アイコンだけに依存せず、`aria-label` でも接続状態を読めるようにする
- 左上に固定表示するが、ゲームのカードや重要 UI を隠さない余白を確保する

## 4. Matchmaking Lobby

### 目的

プレイヤーがルームを作成するか、既存ルームを選んで参加できる画面です。

### レイアウト

画面上部に「ルームを作成」ボタンを表示します。
その下に、既存ルームをリスト形式で表示します。

```txt
[接続状況]

[ルームを作成]

ルーム一覧
--------------------------------
部屋名 A                 2/6
🔒 部屋名 B              4/6
部屋名 C                 1/6
--------------------------------
```

### ルームリスト項目

各ルーム行に表示するもの:

- ルーム名
- 現在参加人数 / 最大人数
- private room の場合は鍵アイコン
- room status

```ts
interface RoomListItemView {
  roomId: string;
  roomName: string;
  visibility: 'public' | 'private';
  currentPlayerCount: number;
  currentSpectatorCount: number;
  maxPlayers: 6;
  status: 'lobby' | 'playing' | 'closed';
  canJoin: boolean;
  joinRole: 'player' | 'spectator' | null;
}
```

表示ルール:

- public room は鍵アイコンなし
- private room はルーム名の左、または右端に鍵アイコンを表示する
- `canJoin === false` のルームは disabled 表示にする
- `status === 'playing'` のルームは観戦者として参加できる
- `status === 'playing'` のルームには「観戦」または spectator badge を表示する
- `currentPlayerCount >= maxPlayers` のルームは満員表示にする
- `status === 'lobby'` かつ `currentPlayerCount >= maxPlayers` のルームは player として参加できない
- 満員でも `status === 'playing'` の場合は spectator として参加可能にしてよい

### 操作

#### 「ルームを作成」ボタン

クリックすると `create_room` 画面へ遷移します。

#### 既存ルームクリック

ルーム名またはルーム行をクリックすると、参加フローを開始します。

参加フロー:

1. `join_name` dialog を表示する
2. プレイヤー名を入力する
3. 「確定」ボタンを押す
4. private room の場合だけ `join_password` dialog を表示する
5. パスワードが正しければ次の画面へ遷移する
6. public room の場合は名前確定後に次の画面へ遷移する

遷移先:

- `status === 'lobby'`: player として `waiting_room` へ遷移する
- `status === 'playing'`: spectator として `game_play` へ遷移する

## 5. Create Room

### 目的

ホストが新しいルームを作成する画面です。

### 入力項目

- ルーム名
- パスワード

```ts
interface CreateRoomFormState {
  roomName: string;
  password: string;
}
```

### レイアウト

```txt
[接続状況]

ルームを作成

ルーム名
[________________]

パスワード
[________________]
パスワードを入力すると、このルームはプライベートルームになります。

[作成] [戻る]
```

### private room 判定

パスワード欄に1文字以上入力された場合、そのルームは private room として作成します。

```ts
const visibility = password.trim().length > 0 ? 'private' : 'public';
```

### ヒントメッセージ

パスワード欄の下に、常に次のヒントを表示します。

```txt
パスワードを入力すると、このルームはプライベートルームになります。
```

パスワードが入力済みの場合は、より明確に次の表示へ切り替えてもよいです。

```txt
このルームはプライベートルームとして作成されます。
```

### Validation

- ルーム名は必須
- ルーム名は空白だけを禁止
- ルーム名は最大32文字
- パスワードは任意
- パスワードは最大20文字
- パスワードが入力されている場合、private room として扱う

入力仕様:

- ルーム名の `maxlength` は32
- パスワードの `maxlength` は20
- パスワードの表示/非表示 toggle は MVP では任意

## 6. Join Name Dialog

### 目的

既存ルームへ参加する前に、参加者の表示名を入力させる dialog です。

### 表示タイミング

matchmaking lobby で既存ルームをクリックした直後に表示します。

### レイアウト

```txt
参加名を入力

このルームで表示する名前を入力してください。

名前
[________________]

[キャンセル] [確定]
```

### 操作

- `キャンセル`: dialog を閉じ、lobby に戻る
- `確定`: 名前を保存し、次の step へ進む

次の step:

- public room: room status に応じて `waiting_room` または spectator の `game_play` へ遷移
- private room: `join_password` dialog を表示

Validation:

- 名前は必須
- 名前は空白だけを禁止
- 名前は最大16文字
- `確定` ボタンは名前が valid になるまで disabled

## 7. Join Password Dialog

### 目的

鍵付きルームに参加するため、パスワード入力を要求する dialog です。

### 表示タイミング

`join_name` dialog で名前を確定した後、対象ルームが private room の場合に表示します。

### レイアウト

```txt
パスワードが必要です

このルームはプライベートルームです。

パスワード
[________________]

[戻る] [参加]
```

### 操作

- `戻る`: `join_name` dialog に戻る
- `参加`: パスワードを検証し、成功したら room status に応じて `waiting_room` または spectator の `game_play` へ遷移

Validation:

- パスワードは必須
- パスワードは最大20文字
- パスワード未入力では `参加` ボタンを disabled
- パスワードエラー時は dialog 内にエラーを表示し、dialog は閉じない

```ts
type JoinPasswordError = 'required' | 'invalid_password' | 'room_closed' | 'room_full' | null;
```

## 8. Waiting Room

### 目的

ゲーム開始前に、現在参加しているプレイヤーを確認する画面です。

### レイアウト

画面を現在参加人数分で垂直方向に分割し、各領域にプレイヤー名を表示します。
たとえば3人参加中なら、画面は上から3つの横帯に分かれます。

```txt
[接続状況]                         [ルームを退出]

--------------------------------
Player A
--------------------------------
Player B
--------------------------------
Player C
--------------------------------

                              [ゲーム開始]  // host only
```

### 表示ルール

- 参加人数に応じて、画面を縦方向に等分する
- 各プレイヤー領域に表示名を中央寄せで表示する
- host には host badge を表示してもよい
- 接続が切れているプレイヤーは薄く表示する
- 右上に「ルームを退出」を表示する
- host の画面にだけ、右下に「ゲーム開始」ボタンを表示する
- non-host の画面には「ゲーム開始」ボタンを表示しない

```ts
interface WaitingRoomView {
  roomId: string;
  roomName: string;
  localPlayerId: string;
  hostPlayerId: string;
  players: WaitingRoomPlayerView[];
}

interface WaitingRoomPlayerView {
  playerId: string;
  displayName: string;
  isHost: boolean;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
}
```

### 操作

#### ルームを退出

クリックすると、確認 dialog を表示してから lobby へ戻ります。

#### ゲーム開始

host のみ操作可能です。
クリックするとゲーム開始 command を送信し、成功したら `game_play` へ遷移します。

Validation:

- 最低2人以上でないと `ゲーム開始` は disabled
- 最大6人まで参加可能
- host 以外はゲーム開始できない

## 9. Game Play

### 目的

プレイヤーが手札からカードをドラッグし、場の合法位置へドロップしてゲームを進行する画面です。
ゲーム中に途中参加したユーザーは spectator としてこの画面に入り、現在の盤面を観戦します。

### 基本レイアウト

```txt
[接続状況]

他プレイヤー手札数エリア

        プレイ済みカード / ピラミッド

他プレイヤー手札数エリア        他プレイヤー手札数エリア

        ローカルプレイヤー手札
```

### 画面領域

画面は大きく次の領域に分けます。

1. 接続状況インジケーター
2. プレイ済みカード領域
3. ローカルプレイヤー手札領域
4. 他プレイヤー手札数表示領域
5. 現在手番、ラウンド、スコアなどの補助情報

### Spectator 表示

ゲーム中に途中参加した spectator は、現在の盤面と各プレイヤーの公開状態だけをリアルタイムに閲覧できます。

表示ルール:

- spectator 画面の右上に「退出」ボタンを表示する
- spectator は場に出されたピラミッドを見られる
- spectator は各プレイヤーのカード所持数だけをリアルタイムに見られる
- spectator は各プレイヤーが実際に持っているカードの色、カードID、カード内容を見られない
- spectator の local state には、各プレイヤーの手札、山札順、配札順、非公開乱数 seed を持たせない
- spectator にはローカル手札を表示しない
- spectator には「観戦中」badge を表示する
- spectator は `play_card` などの gameplay action を実行できない
- spectator は player の席順、得点、残り手札数、場に出されたカード、ラウンド状況を閲覧できる
- spectator は host election の候補にならない
- 次のゲームを同じ room で始める場合、host が許可すれば spectator を player として参加させてもよい

観戦者に表示してよい情報:

- 場に出されたピラミッドのカード色と配置
- 各プレイヤーの表示名
- 各プレイヤーの残りカード枚数
- 各プレイヤーの脱落または上がり状態
- 現在ラウンド、現在手番、スコア、接続状態

観戦者に表示してはいけない情報:

- 各プレイヤーの手札のカード色
- 各プレイヤーの手札の `cardId`
- 山札順、配札順、非公開乱数 seed

操作:

- `退出`: spectator として room から退出し、matchmaking lobby へ戻る

## 10. プレイ済みカード領域

### 表示内容

画面上部から中央にかけて、すでに場に出されたカードをピラミッド状に表示します。

表示ルール:

- 1段目は最大8枚
- 上段は下段の隣り合う2枚の上に配置する
- 既存カードは常に色を表示する
- 空きスロットは通常時は控えめに表示する

```ts
interface BoardSlotView {
  row: number;
  col: number;
  cardId: string | null;
  color: CardColor | null;
  isLegalDropTarget: boolean;
  isHovered: boolean;
}
```

## 11. 手札領域

### ローカルプレイヤーの手札

ローカルプレイヤーの手札は画面の一番下に横並びで表示します。

表示ルール:

- カードの色を表示する
- ドラッグ可能なカードは pointer cursor にする
- 現在の手番でない場合、カードをドラッグできない
- プレイ不可能なカードは通常より少し暗くしてもよい
- モバイルでは横スクロールまたは縮小表示を許可する

### Drag 中の合法位置ヒント

ユーザーがプレイ可能なカードをドラッグしていて、まだドロップしていない間だけ、配置可能な位置をゆるく明暗で表示します。

表示ルール:

- 合法位置は少し明るくする
- 非合法位置は少し暗くする、または通常表示のままにする
- hover 中の合法位置はさらに強調する
- 強調はカードや盤面を読みにくくしない
- ドラッグ終了後は合法位置ヒントを消す

```ts
interface DragPreviewState {
  draggingCardId: string | null;
  legalDropTargets: MoveTarget[];
  hoveredDropTarget: MoveTarget | null;
}
```

### Drop 成功

合法位置にカードを drop した場合:

1. ローカル UI では一時的にカードを置いたように見せてもよい
2. 実際の確定は host からの `event_committed` を待つ
3. command rejected の場合は、カードを手札へ戻し、短いエラー表示を出す

### Drop 失敗

非合法位置または盤面外に drop した場合:

- カードを手札へ戻す
- 盤面状態を変更しない
- 必要なら軽い shake animation で失敗を示す

## 12. 他プレイヤー手札数表示

### 目的

他プレイヤーの残り手札枚数だけを見せ、カード色やカード内容は隠します。

### 表示位置

他プレイヤーの手札数は、画面の四周にカード裏として表示します。

配置方針:

- 2人: 相手を上辺に表示
- 3人: 上辺と左右どちらかに分散
- 4人: 上辺、左辺、右辺に分散
- 5〜6人: 上辺、左辺、右辺に複数グループとして分散
- 下辺はローカルプレイヤーの手札を優先する

### 表示ルール

- 他プレイヤーのカードは裏面だけを表示する
- 色はわからないようにする
- 枚数はカード裏の枚数で表現する
- 必要に応じて数字でも枚数を補足する
- プレイヤー名を近くに表示する
- 接続切断中のプレイヤーは、手札数エリアも薄く表示する

```ts
interface OpponentHandView {
  playerId: string;
  displayName: string;
  remainingCardCount: number;
  edge: 'top' | 'left' | 'right';
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  roundStatus: 'active' | 'blocked' | 'finished';
}
```

## 13. 脱落表示

### 条件

プレイヤーがそのラウンドで出せるカードを持たず、脱落状態になった場合に表示します。

### ローカルプレイヤーが脱落した場合

手札エリア全体を、脱落した時点のゲーム状態のままグレーアウトします。
その上に大きく「脱落」と表示します。

表示ルール:

- 手札のカード配置は維持する
- 手札エリア全体に半透明のグレー overlay をかける
- overlay の中央に「脱落」と表示する
- 脱落後はカードをドラッグできない
- 失点が確定した場合、手札枚数ぶんの失点を補助表示してもよい

### 他プレイヤーが脱落した場合

他プレイヤーの手札数エリアをグレーアウトし、「脱落」badge を表示します。

## 14. 上がり表示

### 条件

プレイヤーがすべてのカードを出し切った場合に表示します。

### ローカルプレイヤーが上がった場合

手札領域に、わかりやすく「上がり」と表示します。

表示ルール:

- 手札が0枚であることがわかる空状態を表示する
- 空の手札領域の中央または上部に「上がり」と表示する
- カード操作はできない
- 出し切りボーナスが適用される場合、ラウンド結果で明確に表示する

### 他プレイヤーが上がった場合

他プレイヤーの手札数エリアに「上がり」badge を表示します。

## 15. Round Result / Game Result

### 目的

各ラウンド終了後に、直前ラウンドの結果と累積集計をランキング形式で表示します。
最終ラウンド終了後は、同じ結果画面を final game result として扱います。

結果画面は毎ラウンド表示します。

### 表示内容

表示するもの:

- 順位
- プレイヤー名
- 直前ラウンドの失点増減
- 累積失点
- 勝者表示
- 現在ラウンド番号 / 総ラウンド数
- 次に進むための primary action

```ts
type ResultScreenKind = 'round_result' | 'game_result';

interface ResultViewModel {
  kind: ResultScreenKind;
  roundIndex: number;
  totalRounds: number;
  isFinalRound: boolean;
  winnerPlayerIds: string[];
  standings: FinalStandingView[];
}

interface FinalStandingView {
  rank: number;
  playerId: string;
  displayName: string;
  roundPenaltyDelta: number;
  totalPenalty: number;
  isWinner: boolean;
}
```

ランキングルール:

- 失点が少ない順に並べる
- 同点の場合は同順位として表示する
- final game result の winner は最も失点が少ないプレイヤー
- round result では暫定順位として表示する

### レイアウト

```txt
[接続状況]

ラウンド結果  2 / 4

1位  Player A   今回 -2   合計 3
2位  Player C   今回 +1   合計 5
3位  Player B   今回 +4   合計 8

[次のラウンド]
```

最終ラウンドの場合:

```txt
[接続状況]

ゲーム結果  4 / 4

1位  Player A   今回 -2   合計 3
2位  Player C   今回 +1   合計 5
3位  Player B   今回 +4   合計 8

[もう一度遊ぶ]
```

操作ルール:

- 最終ラウンドではない場合、primary action は「次のラウンド」
- 最終ラウンドの場合、primary action は「もう一度遊ぶ」
- 「次のラウンド」は次ラウンドの準備を開始し、`game_play` へ戻る
- 「もう一度遊ぶ」は同じ room で新しいゲームを作り直し、`waiting_room` または新ゲームの準備画面へ戻る
- host authoritative なので、primary action の確定は host の command として扱う

## 16. 主要ユーザーフロー

### Public room 作成

1. lobby で「ルームを作成」を押す
2. create room でルーム名だけ入力する
3. 「作成」を押す
4. waiting room へ遷移する
5. host として「ゲーム開始」ボタンが表示される

### Private room 作成

1. lobby で「ルームを作成」を押す
2. create room でルーム名を入力する
3. パスワード欄に入力する
4. private room のヒントが表示される
5. 「作成」を押す
6. waiting room へ遷移する

### Public room 参加

1. lobby で `status === 'lobby'` の public room をクリックする
2. `join_name` dialog で名前を入力する
3. 「確定」を押す
4. player として waiting room へ遷移する

### Private room 参加

1. lobby で `status === 'lobby'` の鍵アイコン付き room をクリックする
2. `join_name` dialog で名前を入力する
3. 「確定」を押す
4. `join_password` dialog が表示される
5. パスワードを入力する
6. 「参加」を押す
7. 成功したら player として waiting room へ遷移する

### ゲームプレイ

1. host が waiting room で「ゲーム開始」を押す
2. 全プレイヤーが `game_play` へ遷移する
3. ローカルプレイヤーの手札が画面下部に表示される
4. プレイヤーがカードをドラッグする
5. 合法位置が明暗で表示される
6. 合法位置に drop する
7. host から確定イベントが届く
8. 盤面と手札が更新される
9. 脱落または上がりの場合、該当表示を出す
10. ラウンド終了後、毎回 `round_result` へ遷移する
11. 最終ラウンドではない場合、「次のラウンド」で `game_play` へ戻る
12. 最終ラウンドの場合、`game_result` として表示し、「もう一度遊ぶ」を表示する

### ゲーム中の途中参加

1. lobby で `status === 'playing'` の room をクリックする
2. `join_name` dialog で名前を入力する
3. private room の場合は `join_password` dialog でパスワードを入力する
4. spectator として `game_play` へ遷移する
5. current host から snapshot を受け取り、現在の盤面を表示する
6. spectator は場に出されたピラミッドと各 player のカード所持数だけをリアルタイムに見られる
7. spectator は各 player が実際に持っているカードの色を見られない
8. spectator は手札を持たず、着手できない
9. spectator 画面の右上に「退出」ボタンを表示する
10. 以後の player action は spectator の画面にも同期される

## 17. 実装コンポーネント案

React 実装では、次のコンポーネント分割を推奨します。

```txt
src/ui/
  AppShell.tsx
  ConnectionIndicator.tsx
  MatchmakingLobby.tsx
  RoomList.tsx
  RoomListItem.tsx
  CreateRoomScreen.tsx
  JoinNameDialog.tsx
  JoinPasswordDialog.tsx
  WaitingRoomScreen.tsx
  WaitingPlayerStrip.tsx
  GamePlayScreen.tsx
  BoardView.tsx
  LocalHandView.tsx
  OpponentHandRail.tsx
  PlayerStatusOverlay.tsx
  ResultScreen.tsx
  GameResultScreen.tsx
```

PixiJS で盤面とカードを描画する場合も、画面遷移、dialog、接続表示、結果表示は React 側で管理します。
PixiJS 側は `BoardView` と `LocalHandView` の描画・ドラッグ操作に集中させます。

## 18. アクセシビリティ

- dialog は focus trap を持つ
- dialog を閉じたら元の操作対象へ focus を戻す
- 「確定」「参加」「作成」「ゲーム開始」は keyboard で操作可能にする
- 接続状態は色だけでなく `aria-label` またはテキストでも伝える
- 鍵アイコンは private room を示す `aria-label` を持つ
- カード drag は将来的に keyboard 操作も検討する

## 19. 確定事項と残りの要確認

### 確定事項

- private room は lobby の room list に表示する
- private room は鍵アイコン付きで表示する
- player は最大6人
- lobby 中の7人目 player join は拒否する
- playing 中の7人目以降の join は spectator として許可する
- ルーム名は最大32文字
- プレイヤー名は最大16文字
- パスワードは最大20文字
- ラウンドごとに結果画面を毎回表示する
- ラウンド結果画面には「次のラウンド」を表示する
- 最終ラウンドの結果画面には「もう一度遊ぶ」を表示する
- ゲーム中の途中参加は spectator として許可する
- spectator は場のピラミッドと各プレイヤーのカード所持数だけを見られる
- spectator は各プレイヤーの手札の色やカード内容を見られない
- spectator 画面の右上には「退出」ボタンを表示する

### 追加で決めたいこと

未決定項目:

- モバイルで他プレイヤー手札数を四周にどう詰めるか
- カード drag の keyboard 代替操作を MVP に含めるか
- spectator を次ゲームで player に昇格させる UI を MVP に含めるか
