# Penguin Party UI 仕様

この文書は、`Penguin Party` の画面仕様を AI 実装者が迷わず実装できる粒度に整理したものです。
ゲームルールは `docs/game-rules.ja.md`、ゲーム状態設計は `docs/game-spec.md`、P2P 通信仕様は `docs/network-spec.md` を参照します。

## 1. 目的

UI の目的は、2〜6人の P2P マルチプレイを次の流れで遊べるようにすることです。

1. Landing page でプレイヤー名を設定して開始する
2. ルーム一覧を見る
3. ルームを作成する、または既存ルームに参加する
4. ゲーム開始まで待機する
5. 手札からカードをドラッグして場に出す
6. 脱落、上がり、ラウンド終了、ゲーム終了を視覚的に理解できる
7. ゲーム終了後に今回の結果と累積ランキングを見る

起動時のデフォルト画面は `landing_page` です。
ローカル検証モードはテスト用の入口として `?mode=local-test` を指定した場合だけ表示します。

## 2. 画面一覧

実装する画面は次の通りです。

```ts
type AppScene =
  | 'landing_page'
  | 'matchmaking_lobby'
  | 'waiting_room'
  | 'game_play'
  | 'round_result'
  | 'game_result';
```

モーダルまたは dialog として次を使います。

```ts
type AppDialog =
  | 'create_room'
  | 'join_password'
  | 'rejoin_error'
  | 'leave_room_confirm'
  | 'connection_error'
  | null;
```

## 3. 共通 UI

### 接続状況インジケーター

すべてのゲームシーンの左上に、常時接続状況を表示します。
対象シーンは `matchmaking_lobby`、`waiting_room`、`game_play`、`round_result`、`game_result` です。

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

`game_play` 中は、他 player の切断を通常 UI に出さないため、`peerCount` / `connectedPeerCount` を player ごとの離脱表示として使ってはいけません。
表示してよいのは、自分自身の signaling / P2P 接続品質、または room 全体の抽象的な通信状態だけです。

実装メモ:

- アイコンは `lucide-react` を導入する場合、`Wifi`, `WifiOff`, `Signal` 系を使う
- アイコンだけに依存せず、`aria-label` でも接続状態を読めるようにする
- 左上に固定表示するが、ゲームのカードや重要 UI を隠さない余白を確保する

## 4. Landing Page

### 目的

起動直後に表示する最初の画面です。
ゲームタイトル、プレイヤー名設定、「Start」ボタンだけを表示し、room 一覧は表示しません。
プレイ中 game へ復帰するため、プレイヤー名入力の下に re-join code 入力欄も表示します。

### レイアウト

```txt
Penguin Party
[Player_a3f91c____________]
[re-join code_____________]

[Start]
```

### プレイヤー名入力

タイトル直下に表示します。
クリックまたは focus するとユーザーが自分で更新できます。

```ts
interface LobbyPlayerNameView {
  displayName: string;
  defaultDisplayName: string;
  isValid: boolean;
}
```

生成ルール:

- 初回表示時に `Player_${random6digitHash}` を生成する
- `random6digitHash` は6文字の英数字または hex 文字列にする
- 例: `Player_92af10`
- ユーザーが変更した名前は、room 作成・room 参加時にそのまま使う
- 可能なら local storage に保存し、次回起動時も同じ名前を表示する

Validation:

- 名前は必須
- 名前は空白だけを禁止
- 名前は最大16文字
- 同時に online の player と同じ名前は使えない
- invalid の場合、`Start` ボタンを disabled にする
- 名前重複が検出された場合、`Start` は失敗し、Landing page にエラーを表示して `matchmaking_lobby` へ遷移しない

### 操作

- `Start`: プレイヤー名が valid なら `matchmaking_lobby` へ遷移する
- re-join code が入力されている場合、`Start` は名前ではなく re-join code による resume を優先する
- re-join code resume が成功した場合、保存済み player name、playerId、手札、手番状態で `game_play` へ遷移する
- re-join code resume が失敗した場合、Landing page にエラーを表示し、入力中の player name は変更しない

### Re-join code 入力

進行中 game から切断された player が、同じ player として復帰するための入力欄です。

```ts
interface RejoinCodeInputView {
  value: string;
  isSubmitting: boolean;
  error:
    | 'invalid_rejoin_code'
    | 'expired_rejoin_code'
    | 'game_already_finished'
    | 'room_closed'
    | null;
}
```

表示ルール:

- player name 入力欄の下に表示する
- placeholder は `re-join code` とする
- 任意入力にする
- re-join code が空欄の場合、通常の player name flow を使う
- re-join code が入力済みの場合、player name の値は resume 判定に使わない
- resume 成功後、UI 上の player name は server が返した以前の display name に置き換える
- re-join code は secret なので、他 player の画面、room list、waiting room、game play には表示しない

## 5. Matchmaking Lobby

### 目的

プレイヤーがルームを作成するか、既存ルームを選んで参加できる画面です。

### レイアウト

matchmaking lobby は、現在 open しているすべての room を一覧表示します。
room は `waiting_for_start` または `playing` のものだけを表示します。
誰もいなくなった room は signaling server が自動削除し、room list には表示しません。
viewport の最下部には、常に floating の大きな「新しいゲームルームを作成」ボタンを表示します。
ボタンは画面幅に応じて中央寄せまたは横幅いっぱいに近い形で表示し、ルーム一覧のスクロールに追従せず viewport に固定します。

左側のルーム一覧は、ルーム数が多い場合に下方向へスクロールできるようにします。
一覧の scroll container は、viewport 下部の floating button と重ならない bottom padding を持ちます。

```txt
[接続状況]

┌ Open rooms ───────────────┐
│ 部屋名 A            2/6   │  Lobby
│ 🔒 部屋名 B         4/6   │  Playing
│ 部屋名 C            1/6   │  Lobby
│ ... scroll ...            │
└───────────────────────────┘

                         [新しいゲームルームを作成]
```

推奨レイアウト:

```txt
desktop
--------------------------------
| room list                       |
| scroll                          |
--------------------------------
[floating create room button]

mobile
--------------------------------
room list
--------------------------------
[floating create room button]
```

### ルームリスト項目

各ルーム行に表示するもの:

- ルーム名
- 現在参加人数 / 最大人数
- パスワード付き room の場合は鍵アイコン
- 現在のゲーム状況
- 参加可能かどうか
- 必要に応じて観戦として入ることがわかる badge

```ts
interface RoomListItemView {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  currentPlayerCount: number;
  currentSpectatorCount: number;
  maxPlayers: 6;
  status: 'waiting_for_start' | 'playing';
  canJoin: boolean;
  joinRole: 'player' | 'spectator' | null;
}
```

表示ルール:

- パスワードなし room は鍵アイコンなし
- パスワード付き room はルーム名の左、または右端に鍵アイコンを表示する
- 鍵アイコンには「パスワードあり」の意味が伝わる `aria-label` を付ける
- `status === 'waiting_for_start'` は「開始待ち」と表示する
- `status === 'playing'` は「プレイ中」と表示する
- `canJoin === false` のルームは disabled 表示にする
- `status === 'playing'` のルームは観戦者として参加できる
- `status === 'playing'` のルームには「観戦」または spectator badge を表示する
- `currentPlayerCount >= maxPlayers` のルームは満員表示にする
- `status === 'waiting_for_start'` かつ `currentPlayerCount >= maxPlayers` のルームは player として参加できない
- 満員でも `status === 'playing'` の場合は spectator として参加可能にしてよい
- `closed` status は持たない。参加者が0人になった room は自動削除され、一覧から消える

### 操作

#### 「新しいゲームルームを作成」ボタン

viewport 最下部に floating 表示します。
クリックすると `create_room` dialog を表示します。

#### 既存ルームクリック

ルーム名またはルーム行をクリックすると、参加フローを開始します。
このとき、タイトル下のプレイヤー名入力欄にある名前を参加名として使用します。

参加フロー:

1. パスワードなし room の場合は、そのまま参加処理を実行する
2. パスワード付き room の場合だけ `join_password` dialog を表示する
3. パスワードが正しければ次の画面へ遷移する
4. パスワードが不正なら dialog 内にエラーを表示し、matchmaking lobby に留まる

遷移先:

- `status === 'waiting_for_start'`: player として `waiting_room` へ遷移する
- `status === 'playing'`: spectator として `game_play` へ遷移する

## 6. Create Room Dialog

### 目的

ホストが新しいルームを作成する dialog です。
matchmaking lobby から離脱せず、floating button から開きます。

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
ルームを作成

ルーム名
[________________]

パスワード
[________________]
パスワードを入力すると、このルームは鍵付きルームになります。

[作成] [戻る]
```

dialog 表示中は背景を inert にし、focus は dialog 内に閉じ込めます。
作成が成功したら dialog を閉じ、host として `waiting_room` へ遷移します。

### 鍵付き room 判定

パスワード欄に1文字以上入力された場合、その room は鍵付き room として作成します。
鍵付き room も room list には表示します。
room の存在を隠すための `private` / `public` 区分は持たず、必要なのは `hasPassword` だけです。

```ts
const hasPassword = password.trim().length > 0;
```

### ヒントメッセージ

パスワード欄の下に、常に次のヒントを表示します。

```txt
パスワードを入力すると、このルームは鍵付きルームになります。
```

パスワードが入力済みの場合は、より明確に次の表示へ切り替えてもよいです。

```txt
このルームは鍵付きルームとして作成されます。
```

### Validation

- ルーム名は必須
- ルーム名は空白だけを禁止
- ルーム名は最大32文字
- パスワードは任意
- パスワードは最大20文字
- パスワードが入力されている場合、鍵付き room として扱う

入力仕様:

- ルーム名の `maxlength` は32
- パスワードの `maxlength` は20
- パスワードの表示/非表示 toggle は MVP では任意

## 7. Player Name Input

### 目的

landing page で自分のプレイヤー名を確認・編集できる入力欄です。
room 作成時、room 参加時、waiting room 表示名に同じ値を使います。

### 表示タイミング

landing page のタイトル直下に常時表示します。

### レイアウト

```txt
Penguin Party
[Player_a3f91c____________]
```

### 操作

- 入力欄をクリックまたは focus すると編集できる
- blur または Enter で現在値を保存する
- Escape では編集前の値へ戻してよい
- 空欄や invalid な名前のまま `matchmaking_lobby` へ進めない

Validation:

- 名前は必須
- 名前は空白だけを禁止
- 名前は最大16文字
- 同時に online の player と同じ名前は使えない
- invalid の場合は入力欄の近くに短いエラーを表示する
- invalid の場合、`Start` ボタンを disabled にする
- 名前重複エラーの場合、`matchmaking_lobby` へ遷移せず、Landing page に留まる

```ts
type PlayerNameError =
  | 'required'
  | 'too_long'
  | 'duplicate_online_name'
  | null;
```

名前重複の最終判定は server 側で行います。
client 側の事前チェックが成功しても、server が `duplicate_online_name` を返した場合は Landing page に戻してエラーを表示します。
re-join code で復帰する場合は、入力中の player name を使わず、server が返した既存 display name を採用します。

## 8. Join Password Dialog

### 目的

鍵付きルームに参加するため、パスワード入力を要求する dialog です。

### 表示タイミング

matchmaking lobby で鍵アイコン付き room をクリックした直後に表示します。
パスワードなし room では表示せず、そのまま参加処理を実行します。

### レイアウト

```txt
パスワードが必要です

このルームは鍵付きルームです。

パスワード
[________________]

[戻る] [参加]
```

### 操作

- `戻る`: dialog を閉じ、matchmaking lobby に戻る
- `参加`: パスワードを検証し、成功したら room status に応じて `waiting_room` または spectator の `game_play` へ遷移

Validation:

- パスワードは必須
- パスワードは最大20文字
- パスワード未入力では `参加` ボタンを disabled
- パスワードエラー時は dialog 内にエラーを表示し、dialog は閉じない
- `room_closed` は、パスワード入力中に対象 room の参加者が0人になって自動削除された場合などに表示する

```ts
type JoinPasswordError = 'password_required' | 'invalid_password' | 'room_closed' | 'room_full' | null;
```

## 9. Waiting Room

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

クリックすると、確認 dialog を表示してから matchmaking lobby へ戻ります。

#### ゲーム開始

host のみ操作可能です。
クリックするとゲーム開始 command を送信し、成功したら `game_play` へ遷移します。

Validation:

- 最低2人以上でないと `ゲーム開始` は disabled
- 最大6人まで参加可能
- host 以外はゲーム開始できない

### 参加・退出時の再計算

`waiting_room` 中は、参加中 player の集合がゲーム開始時の正になります。
任意の player が参加・退出した時点で、UI は server / current host から更新された room snapshot を受け取り、表示を再構成します。

更新対象:

- player list
- host badge
- player count
- start button の enabled / disabled
- player の表示順
- local player の `playerId` / role / host 権限

host が `waiting_room` 中に退出した場合、残存 player のうち新 host になった player だけに「ゲーム開始」ボタンを表示します。
離脱済み player は waiting room の表示、player count、ゲーム開始時の配札対象に残してはいけません。
新 host がゲーム開始した場合、残存 player 全員が手札を持ち、自分の手番でプレイできる必要があります。

## 10. Game Play

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

### 小画面用 compact scoreboard

`game_play` 中に viewport 幅または高さが小さい場合、通常の scoreboard は大きすぎるため、約20px高の compact section に縮小します。
この compact section には player 数ぶんの小さい四角を横並びで表示し、各四角が1人の player を表します。

表示ルール:

- compact scoreboard は `game_play` 中の小画面でのみ通常 scoreboard の代わりに表示する
- 四角は player 数と同じ数だけ表示し、spectator は含めない
- local player の四角だけ player name を表示する
- local player の文字は bold の黒文字にする
- local player 以外の四角は player name を表示せず、白い四角として表示する
- active player の四角だけ、2秒周期の青系グラデーション明暗アニメーションを行う
- active player の明暗変化は、0秒で白、1秒で青、2秒で白に戻り、同じ周期を繰り返す
- compact scoreboard の一番右に、展開を意味する矢印または三角アイコンを表示する
- 展開アイコンには `aria-expanded` を付ける

展開時:

- 展開アイコンをクリックすると、overlay の expanded scoreboard を表示する
- overlay には room name、player name 一覧、現在の score、現在 active player を示す明暗変化のヒントを表示する
- overlay 内の player 行でも active player は同じ青系の明暗アニメーションで示す
- 同じ展開アイコンまたは overlay 内の閉じるアイコンをもう一度クリックすると、expanded scoreboard を閉じる

```ts
interface CompactScoreboardPlayerView {
  playerId: string;
  displayName: string;
  isLocal: boolean;
  isActive: boolean;
  totalPenalty: number;
  remainingCardCount: number;
}
```

### Game play 中の退出

`game_play` 中に `Leave` を押した場合、すぐに退出せず確認 dialog を表示します。

確認 dialog:

- title は game から退出することがわかる文言にする
- primary action は退出確定
- secondary action はキャンセル
- キャンセルした場合は dialog を閉じ、game play に留まる
- 退出を確定した場合は現在の game room から退出し、Landing page ではなく `matchmaking_lobby` へ戻る
- `matchmaking_lobby` へ戻った後は player name reservation を更新し、room list を再取得する

### Spectator 表示

ゲーム中に途中参加した spectator は、現在の盤面と各プレイヤーの公開状態だけをリアルタイムに閲覧できます。

表示ルール:

- spectator 画面の右上に「退出」ボタンを表示する
- spectator は場に出されたピラミッドを見られる
- spectator は各プレイヤーのカード所持数だけをリアルタイムに見られる
- spectator は各プレイヤーが実際に持っているカードの色、カードID、カード内容を見られない
- spectator の local state には、各プレイヤーの手札、山札順、配札順、非公開乱数 seed を持たせない
- spectator にはローカル手札を表示しない
- spectator の play-area には `No cards` などの手札なし表示や手札用の黄色い領域を表示しない
- spectator には「観戦中」badge を表示する
- spectator は `play_card` などの gameplay action を実行できない
- spectator は player の席順、得点、残り手札数、場に出されたカード、ラウンド状況を閲覧できる
- spectator は host election の候補にならない
- 次のゲームを同じ room で始める場合、host が許可すれば spectator を player として参加させてもよい

spectator board 最大化:

- spectator の `game_play` では、play-area の stage の下に最大化を意味する icon button を表示する
- 最大化 icon button は text label を表示せず、`aria-label` で操作名を提供する
- 最大化 icon button をクリックすると、board 表示を viewport 幅 100% / 高さ 100% の overlay に切り替える
- overlay では手札領域、手札なし表示、player の入力 hint を表示しない
- overlay には元の表示へ戻るための icon button を表示する
- overlay 表示中に `Escape` を押した場合も元の表示へ戻る

最大化 overlay の board 比率:

- board は常に「完璧なピラミッド」を基準に固定比率で表示する
- 完璧なピラミッドは、1段目が8枚、最上段が1枚の8段構成とする
- card aspect ratio、横 gap、段間隔は通常 board と同じ比率を使う
- scale は、完璧なピラミッドの横幅が viewport width の 95% 以下、かつ縦幅が viewport height の 95% 以下になるように計算する
- width 条件と height 条件のうち、より厳しい条件に合わせて scale を決定する
- 余った方向には上下または左右の余白があってよい
- 例: viewport height の95%が950px、viewport width の95%が200pxの場合、width 条件のほうが厳しいため、ピラミッド幅を200pxに合わせる

観戦者に表示してよい情報:

- 場に出されたピラミッドのカード色と配置
- 各プレイヤーの表示名
- 各プレイヤーの残りカード枚数
- 各プレイヤーの脱落または上がり状態
- 現在ラウンド、現在手番、スコア

観戦者に表示してはいけない情報:

- 各プレイヤーの手札のカード色
- 各プレイヤーの手札の `cardId`
- 山札順、配札順、非公開乱数 seed

操作:

- `退出`: spectator として room から退出し、matchmaking lobby へ戻る

### Game play 中の切断表示と host 代行

`game_play` 中に player の connection が切断された場合でも、他の online player と spectator の通常画面には、その player の切断状態を表示しません。
他の user からは、その player が通常どおり game に残っているように見せます。

表示ルール:

- 切断 player を gray out しない
- 切断 badge、reconnecting badge、offline label を他 user に表示しない
- 他 player の残り手札数、得点、手番表示は通常どおり表示する
- host が代行 play したことを示す文言や icon を表示しない
- 自分自身が切断・再接続中の場合だけ、自分の画面に reconnecting / resumed status を表示してよい

host 代行の UI 挙動:

- 切断 player の手番では、通常の手番待ち表示を続ける
- host が 5秒 + 0〜3秒の待機後に代行 action を commit したら、通常の player action と同じ animation / message で反映する
- 合法手がない場合も、通常の no-move resolve と同じ表示にする
- 代行実行であることは debug overlay や開発ログに限定し、通常 UI には出さない

re-join 成功時:

- re-join した player の画面は、以前の display name、playerId、hand、現在の turn / board / score を復元して表示する
- 他 player の画面では、特別な「復帰しました」通知を必須にしない
- 復帰 player が active player なら、host 代行 timer をキャンセルし、通常入力を受け付ける

## 11. プレイ済みカード領域

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

## 12. 手札領域

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

## 13. 他プレイヤー手札数表示

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

## 14. 脱落表示

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

## 15. 上がり表示

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

## 16. Round Result / Game Result

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

## 17. 主要ユーザーフロー

### Landing page から room list へ

1. 起動時に `landing_page` を表示する
2. プレイヤー名を確認または編集する
3. `Start` を押す
4. server が online player name の重複を検証する
5. 重複がなければ `matchmaking_lobby` へ遷移し、現在 open している room list を表示する
6. 重複があれば Landing page に留まり、名前重複エラーを表示する

### Re-join code で resume

1. 起動時に `landing_page` を表示する
2. re-join code 入力欄に code を入力する
3. `Start` を押す
4. server が re-join code の存在、有効期限、対象 game の復帰可否を検証する
5. 成功したら、入力中の player name を無視し、以前の display name / playerId / hand で `game_play` へ遷移する
6. 失敗したら Landing page に留まり、re-join code エラーを表示する

### 鍵なし room 作成

1. matchmaking lobby で floating の「新しいゲームルームを作成」を押す
2. `create_room` dialog でルーム名だけ入力する
3. 「作成」を押す
4. waiting room へ遷移する
5. host として「ゲーム開始」ボタンが表示される

### 鍵付き room 作成

1. matchmaking lobby で floating の「新しいゲームルームを作成」を押す
2. `create_room` dialog でルーム名を入力する
3. パスワード欄に入力する
4. 鍵付き room のヒントが表示される
5. 「作成」を押す
6. waiting room へ遷移する

### 鍵なし room 参加

1. landing page で設定したプレイヤー名が valid であることを確認する
2. matchmaking lobby で `status === 'waiting_for_start'` のパスワードなし room をクリックする
3. そのまま参加処理を実行する
4. player として waiting room へ遷移する

### 鍵付き room 参加

1. landing page で設定したプレイヤー名が valid であることを確認する
2. matchmaking lobby で `status === 'waiting_for_start'` の鍵アイコン付き room をクリックする
3. `join_password` dialog が表示される
4. パスワードを入力する
5. 「参加」を押す
6. 成功したら player として waiting room へ遷移する

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

### Waiting room 中の host 退出

1. Player 1 が host として room を作成する
2. Player 2 と Player 3 が参加する
3. Player 1 がゲーム開始前に退出する
4. Player 2 が新 host に昇格する
5. waiting room は Player 2 / Player 3 の2人だけで再描画される
6. Player 2 の画面だけに「ゲーム開始」ボタンを表示する
7. Player 2 がゲーム開始する
8. Player 2 と Player 3 の両方に手札が配られ、どちらも自分の手番でプレイできる

### Game play 中の player 切断

1. game play 中に任意の player が connection 切断または room 退出する
2. 他の online player 画面では、その player は通常どおり残っているように表示する
3. 切断 player の手番になったら、host は 5秒 + 0〜3秒の待機を開始する
4. 待機中に re-join した場合、その player の通常入力へ戻る
5. 待機後も切断中なら、host が切断 player の手札から合法手を選んで commit する
6. 合法手がない場合は通常の no-move resolve として commit する
7. 他 player 画面には通常 action として反映し、host 代行であることを表示しない

### ゲーム中の途中参加

1. matchmaking lobby で `status === 'playing'` の room をクリックする
2. パスワードなし room の場合はそのまま参加処理を実行する
3. パスワード付き room の場合は `join_password` dialog でパスワードを入力する
4. spectator として `game_play` へ遷移する
5. current host から snapshot を受け取り、現在の盤面を表示する
6. spectator は場に出されたピラミッドと各 player のカード所持数だけをリアルタイムに見られる
7. spectator は各 player が実際に持っているカードの色を見られない
8. spectator は手札を持たず、着手できない
9. spectator 画面の右上に「退出」ボタンを表示する
10. 以後の player action は spectator の画面にも同期される

## 18. 実装コンポーネント案

React 実装では、次のコンポーネント分割を推奨します。

```txt
src/ui/
  AppShell.tsx
  ConnectionIndicator.tsx
  LandingPage.tsx
  MatchmakingLobby.tsx
  PlayerNameField.tsx
  RoomList.tsx
  RoomListItem.tsx
  CreateRoomDialog.tsx
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

## 19. アクセシビリティ

- dialog は focus trap を持つ
- dialog を閉じたら元の操作対象へ focus を戻す
- 「確定」「参加」「作成」「ゲーム開始」は keyboard で操作可能にする
- 接続状態は色だけでなく `aria-label` またはテキストでも伝える
- 鍵アイコンはパスワード付き room を示す `aria-label` を持つ
- カード drag は将来的に keyboard 操作も検討する

## 20. 確定事項と残りの要確認

### 確定事項

- room は `waiting_for_start` と `playing` の2状態だけを持つ
- 参加者が0人になった room は自動削除され、room list には表示しない
- 鍵付き room も matchmaking lobby の room list に表示する
- 鍵付き room は鍵アイコン付きで表示する
- player は最大6人
- `waiting_for_start` 中の7人目 player join は拒否する
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
- online player name は同時重複不可
- re-join code は player 参加時に server が自動生成し、有効期限は3時間
- re-join code で resume する場合、入力中の player name は無視し、以前の display name を使う
- `waiting_room` 中の参加・退出では player list / host / seating / start 可否を再計算する
- game play 中の他 player 切断は通常 UI には表示しない
- game play 中に切断 player の手番が来た場合、host は 5秒 + 0〜3秒後に通常 action として代行 commit する

### 追加で決めたいこと

未決定項目:

- モバイルで他プレイヤー手札数を四周にどう詰めるか
- カード drag の keyboard 代替操作を MVP に含めるか
- spectator を次ゲームで player に昇格させる UI を MVP に含めるか
