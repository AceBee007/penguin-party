# Penguin Party 段階的 Goal

この文書は、`Penguin Party` を long-running task で実装するときの段階的な到達目標です。
実装者は、下の順番を守って進めます。

参照する仕様:

- `docs/game-rules.ja.md`
- `docs/game-spec.md`
- `docs/ui-spec.md`
- `docs/network-spec.md`

## Goal 1: ローカルで1人操作の検証モードを遊べる

### 目的

まずはネットワークを実装せず、1つのブラウザ内でゲームルール、盤面、手札操作、ラウンド進行を確認できるようにします。
この段階では P2P、ルーム作成、signaling server、host migration は実装しません。
`docs/game-rules.ja.md` の正式なプレイ人数は2〜6人なので、ここでの「1人」は「1つのブラウザで1人のユーザーが操作するローカル検証モード」を意味します。
ゲーム状態としては最低2人分の player seat を作り、相手席は dummy player または hot-seat 操作で扱います。

### 実装範囲

- React + PixiJS でゲーム画面を表示する
- `docs/game-rules.ja.md` に従ってカード、山札、配札、盤面、合法手を実装する
- 1人操作用のローカル検証モードを用意する
- ルール上は2〜6人の player state として扱い、1人専用ルールは作らない
- 手札を画面下部に表示する
- 盤面にプレイ済みカードをピラミッド状に表示する
- 手札カードをドラッグし、合法位置へ drop できるようにする
- drag 中に合法位置をハイライトする
- 合法手がない場合は脱落表示を出す
- 手札を出し切った場合は上がり表示を出す
- ラウンド終了後、結果と累積失点を表示する

### 実装しないもの

- P2P 通信
- ルーム一覧
- 鍵付き room
- パスワード
- 複数ブラウザ間同期
- host migration
- 6人接続検証

### 完了条件

- `npm run test` が成功する
- `npm run build` が成功する
- `npm run test:e2e` が成功する
- Playwright でアプリを開き、canvas が表示される
- Playwright でカードを1枚 drag/drop し、盤面と手札が更新される
- 合法手判定、カード配置、脱落、上がり、ラウンド終了、スコア計算に unit test がある

### 成果物

- `src/game/` に純粋なゲームルール実装
- `src/ui/` または `src/components/` にローカルゲーム画面
- `tests/e2e/` にローカル1人操作モードの smoke test

## Goal 2: 2人 P2P で1手同期できる

### 目的

次に、2つの独立したブラウザ context を Peer A と Peer B として扱い、P2P で1手だけ同期できる状態を作ります。
この段階では、完全なゲーム完走よりも、room 作成、join、WebRTC DataChannel、host authoritative command flow の成立を優先します。

### 実装範囲

- ローカル Node.js signaling server を追加する
- ルーム作成 API を追加する
- ルーム参加 API を追加する
- WebSocket で offer、answer、ICE candidate を中継する
- Google STUN `stun:stun.l.google.com:19302` を使う
- Peer A を初期 host とする
- Peer B が room に join できる
- Peer A/B 間で WebRTC DataChannel を open できる
- Peer B の `play_card` command を Peer A host に送れる
- Peer A host が command を検証し、`event_committed` を Peer B へ返せる
- Peer A の1手を Peer B へ同期できる
- Peer B の1手を Peer A へ同期できる
- 両 peer の `revision` と `stateHash` が一致する

### 実装しないもの

- Peer C 以降の late join
- 6人 full mesh
- host migration
- reconnect
- 鍵付き room password の完全実装
- フルゲーム完走の P2P 保証

### 完了条件

- `npm run test` が成功する
- `npm run build` が成功する
- `npm run test:e2e` が成功する
- Playwright で Peer A/B を別 browser context として起動できる
- Peer A が room を作成できる
- Peer B が room に参加できる
- DataChannel が open になる
- Peer A の1手が Peer B の画面に反映される
- Peer B の1手が Peer A の画面に反映される
- 両 peer の `revision` と `stateHash` が一致する

### 成果物

- `server/` にローカル signaling server
- `src/network/` に P2P 接続、DataChannel protocol、host authority の最小実装
- `tests/e2e/` に2人P2P同期 test

## Goal 3: 6人 P2P でも動くように直して検証する

### 目的

最後に、最大6人の player による P2P multiplayer を想定して、full mesh、Peer C 以降の参加、同期 fan-out、host 切断時の継続を検証します。
player 上限は6人ですが、ゲーム中の途中参加は spectator として許容します。

### 実装範囲

- Peer A〜Peer F まで最大6人が同じ room に参加できる
- 6人 full mesh 接続を作れる
- Peer C 以降の late join を実装する
- 新規参加 peer が current host から snapshot を受け取り、現在の盤面に追いつける
- 6人全員に一意な `PlayerId` と席順を割り当てる
- 各 player peer が最低1手を実行できる
- 各手が全 player peer に同期され、spectator には公開状態として同期される
- player peer 間で `revision` と完全 snapshot の `stateHash` が一致する
- spectator は host が送った spectator snapshot の `revision` と公開状態 hash に追いつく
- `waiting_for_start` 中の7人目の player 参加を `room_full` として拒否する
- playing 中の7人目以降の参加は spectator として許可する
- spectator は `playerId: null` とし、手札、山札順、配札順、非公開乱数 seed を受け取らない
- spectator は各 player のカード所持数と場のピラミッドだけをリアルタイムに見られる
- 鍵付き room も一覧に表示し、player/spectator のどちらの参加でもパスワードを必須にする
- host heartbeat を実装する
- host 切断時に deterministic random election で次 host を選べる
- 新 host が game logic を継続できる

### 検証対象

- Peer A: 初期 host
- Peer B: 最初の参加者
- Peer C: late join と3人同期確認
- Peer D/E/F: 6人 full room 確認
- 7人目 player: `waiting_for_start` 中の room full rejection 確認
- 7人目以降 spectator: playing 中の観戦参加と redacted snapshot 確認

### 完了条件

- `npm run test` が成功する
- `npm run build` が成功する
- `npm run test:e2e` が成功する
- Playwright で Peer A〜F を独立 browser context として起動できる
- 6人全員が同じ room に参加できる
- 6人全員が一意な player identity を持つ
- 6人全員の画面で player list と手札数表示が一致する
- 6人全員が最低1回、代表的な gameplay action を実行できる
- すべての action 後に全 player peer の `revision` と完全 snapshot の `stateHash` が一致する
- spectator は同じ `revision` の公開状態を表示し、spectator snapshot hash が host と一致する
- `waiting_for_start` 中の7人目 player join が拒否される
- playing 中の7人目以降の join が spectator として成功する
- spectator は `playerId: null` で、host election と quorum に含まれない
- spectator の local state に `privateStateByPlayerId`, `hostOnlyStateReplica`, 山札順、各 player の手札 cardId が存在しない
- host を閉じた後、残り peer が同じ next host を選ぶ
- new host の1手が他 peer に同期される
- console error と failed network request がない

### 成果物

- 6人対応済みの `src/network/peerMesh.ts`
- host migration 対応済みの `src/network/hostElection.ts`
- 6人 P2P e2e test
- spectator join e2e test
- 鍵付き room password e2e test
- host disconnect e2e test

## 実装順序の原則

- Goal 1 が完了するまで P2P を実装しない
- Goal 2 が完了するまで6人 full mesh と host migration を実装しない
- 各 Goal の最後に `npm run test`, `npm run build`, `npm run test:e2e` を実行する
- 失敗したテストを残したまま次の Goal に進まない
- ルールに迷った場合は `docs/game-rules.ja.md` を正とする
- 通信と multiplayer state に迷った場合は `docs/network-spec.md` を正とする
- UI 表示に迷った場合は `docs/ui-spec.md` を正とする
- マルチプレイ通信は current host authoritative を正とする
- ローカル Node.js server は room list / room management / signaling のみを担当する
