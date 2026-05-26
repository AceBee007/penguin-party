# Bug solution: 手札 drag/drop の重複表示とピラミッド配置

## 発見したバグ

- 手札を少しだけドラッグして手を離すと、ドラッグしたカードが手札に戻らず、元の手札位置にも同じカードが描画される。結果として同じカードが2枚あるように見える。
- 手札カードをボードへドラッグして、ヒントで提示された合法位置以外で手を離すと、カードがそのドラッグ位置に残ってしまう。本来は自動で手札に戻るべき。
- 上段のカードが、支えになる下段2枚の中央ではなく、左側のカード寄りに表示されている。

## 原因

- PixiJS の drag 中、カードの `Container` は `handLayer` から `dragLayer` に移動される。invalid drop 時に手札は再描画されていたが、`dragLayer` に残った古い `Container` を取り除いていなかったため、同じ `cardId` のカードが視覚上だけ二重に見えていた。
- ゲーム状態は `cardId` を中心に管理しているが、`playCard` の直前に「そのカードが手札に1枚だけ存在する」「盤面や played list に存在しない」という不変条件を明示的に検査していなかった。
- ルール上の上段座標 `{ level: 1, x: 0 }` は、下段 `{ level: 0, x: 0 }` と `{ level: 0, x: 1 }` の上に置く位置を表す。描画側でこの `x` をそのまま使っていたため、上段カードが左寄りになっていた。

## 修正方針

- drop 完了時、合法・非合法に関係なく、drag 中の `Container` を `dragLayer` から明示的に削除する。
- drag 中でない再描画では `dragLayer` を空にし、古い drag 表示が残らないようにする。
- invalid drop の場合は、drag 表示を消した後に手札を再描画し、カードを元の手札位置へ戻す。
- `playCard` の commit 前にカード所有の不変条件を検査する。
  - target cell が空であること
  - card がすでに盤面に存在しないこと
  - card がすでに `playedCardIds` に存在しないこと
  - card が active player の手札にちょうど1枚だけ存在し、他 player の手札には存在しないこと
- 盤面描画では `visualX = x + level * 0.5` を使い、上段カードを支え2枚の中央に描画する。

## 検証

- unit test で、手札内の同一 `cardId` 重複、盤面上にあるカードの再プレイ、上段カードの視覚座標を検査する。
- local e2e で、短い invalid drag を実行し、以下を確認する。
  - board count が変わらない
  - active player が変わらない
  - revision が変わらない
  - readout が手札へ戻った状態を示す
  - `dragLayerChildren` が `0` になる
  - hand の描画枚数が手札枚数と一致する
- local e2e と Playwright QA で、valid drag/drop 後に board、hand、revision、active player が正常に更新されることを確認する。
- Playwright QA で、上段カードの center x が支え2枚の center x 平均と一致することを確認する。
