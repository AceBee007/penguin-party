# Bug solution: 小さい viewport で高いピラミッドが見切れる

## 発見したバグ

- ピラミッドを積み上げると、window / viewport が小さい場合にピラミッドの高さが表示領域を超える。
- 上段のカードや合法手のヒントが画面外に出ると、プレイヤがピラミッド全体を確認できず、それ以上プレイを続けにくくなる。

## 原因

- 盤面カードのサイズは主に横幅から決まっており、現在のピラミッド高さや次に置ける合法手の最大 `level` を考慮していなかった。
- `baseY` は `height * 0.55` 付近に固定され、ピラミッドが高くなったときに上方向へ伸びるカード列を viewport 内へ収める再計算がなかった。
- 手札領域も盤面の下側に必要なので、盤面だけでなく「最上段カードから手札下端まで」の縦方向全体を見て縮小する必要があった。

## 修正方針

- 盤面 geometry を `createBoardGeometry` に切り出し、カード描画に必要な縦方向の高さを計算する。
- 現在の盤面カードと合法手の両方から最大 `level` を求める。
- `maxLevel` が高く、最上段カードから手札下端までが viewport に収まらない場合、カード幅・カード高さ・段間隔を同じ比率で縮小する。
- 縮小後の `baseY` は、以下が viewport 内に収まる範囲へ clamp する。
  - 最上段カードの上端
  - 手札カードの下端
- 狭い画面では CSS の play area 最小高も viewport 比率に合わせ、canvas 自体が過剰に縦長になって viewport 外へ押し出されないようにする。
- 横方向の配置は既存の `visualX = x + level * 0.5` を維持し、上段カードは支え2枚の中央に置く。

## 検証

- unit test で、短い viewport かつ高い `maxLevel` のときに `scale < 1` になり、`boardTopY` と `handBottomY` が viewport 内に収まることを確認する。
- Playwright で小さい viewport を開き、高い段の合法手が出るまでプレイしても、盤面の上端と手札下端が表示領域内に残ることを確認する。
- 既存の local / multiplayer e2e が引き続き通ることを確認する。

# Bug solution: 複数プレイヤー参加後の host 離脱と再参加設計

## 発見したバグ

- Player 1 が room を作成して host になり、Player 2 と Player 3 が `waiting_room` に参加する。
- この状態で Player 1 が room を離れると、Player 2 が host に昇格し、Player 2 と Player 3 だけが room に残る。
- その後 Player 2 がゲーム開始すると、Player 2 がプレイ不可になったり、Player 3 に手札がない状態でゲームが開始されることがある。
- 原因は、`waiting_room` 中の参加・退出・host 昇格後に、player list、seat order、host identity、playerId 割り当て、開始用 snapshot が再計算されないことです。

## 改善要件

- `waiting_room` 中は、任意の player が参加・退出するたびに開始前ゲーム状態を再計算する。
- 再計算対象は、少なくとも次の項目です。
  - 現在の player 一覧
  - `hostPlayerId` / `hostPeerId`
  - `playerId` と seat index の割り当て
  - `seatingOrder`
  - `startingPlayerOrder`
  - `ready` / start button の有効状態
- 離脱済み player は、ゲーム開始時の player list と配札対象に含めない。
- host が離脱した場合、新 host は残存 player だけで開始用 snapshot を作成する。
- ゲーム開始後、各 online player は自分の `playerId` に対応した手札と合法手を必ず受け取る。
- 離脱した player の古い `playerId`、seat、hand が残存 player の開始 snapshot に混入してはいけない。

## ゲーム進行中の player 切断

- `game_play` 中に任意の player が connection 切断または room 退出しても、他の online player の通常 UI にはその切断を表示しない。
- 他の online player からは、その player が通常どおりゲームに残っているように見える。
- current host は切断 player の手番が来たとき、5秒 + 0〜3秒のランダム jitter を待つ。
- 待機後、切断 player の手札に合法手がある場合、host はその中からランダムに1枚と合法ターゲットを選び、切断 player 本人の action と同じ形で `event_committed` する。
- 合法手がない場合、host は通常の「出せない」処理と同じ結果を commit する。
- 他の online player には結果だけを通知し、host が代行した事実は UI に出さない。
- host 自身が切断した場合は、先に host election / host migration を完了し、新 host が同じ代行処理を引き継ぐ。

## 名前重複制限

- 同時に online の player display name は重複を許可しない。
- Landing page の `Start` 時点で名前を検証し、同名の online player がいる場合は `matchmaking_lobby` へ入れない。
- room 作成・room 参加時にも同じ重複検証を行い、race condition で重複が発生しないよう server 側で最終判定する。
- re-join code で復帰する場合は、新規入力された名前を無視し、元の player に保存された display name を再利用する。

## Re-join code

- player がゲームに参加した時点で、server はランダムな re-join code を自動生成する。
- re-join code の有効期限は生成から3時間。
- re-join code は player identity に紐づき、room / game が進行中の場合に同じ player として復帰するために使う。
- Landing page には player name の下に re-join code 入力欄を表示する。
- re-join code が有効で、進行中 game の player と一致した場合、入力された player name は無視し、以前の display name と playerId で game に resume する。
- 期限切れ、存在しない、または終了済み game の re-join code は拒否し、Landing page にエラーを表示する。

## 検証

- 3人 waiting room で host が離脱した後、新 host が残り2人だけでゲーム開始できることを確認する。
- host 離脱後に開始した game で、残存全 player が手札を持ち、自分の手番で合法手をプレイできることを確認する。
- `game_play` 中に active player が切断した場合、host が 5〜8 秒後に代行 play / no-move resolve を commit し、他 player の画面では通常 action と区別できないことを確認する。
- 同じ display name では `matchmaking_lobby` へ入れないこと、race condition でも room 内に同名 player が2人作られないことを確認する。
- re-join code で復帰した player が、以前の display name、playerId、手札、手番状態を引き継げることを確認する。
