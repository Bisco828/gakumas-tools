cat << 'EOF' > my-optimizer/MEMO.md
# 学マス コンテスト自動最適化 毎シーズン手順

## 1. 本家の最新データを取り込む（新ステージ・新キャラ反映）
git pull upstream master && pnpm install

## 2. 今期の3ステージのIDを調べる
tail -n 10 packages/gakumas-data/csv/stages.csv

## 3. 新しく引いたSSRがいれば owned.json に足す
node --no-warnings --loader ./scripts/extensionless-loader.mjs -e 'import { PIdols, Idols } from "gakumas-data"; const map = new Map(Idols.getAll().map(i => [i.id, i.name])); PIdols.getAll().filter(p => p.rarity === "SSR" && p.title && !map.get(p.idolId)?.includes("亜紗里")).slice(-10).forEach(p => console.log(`"${map.get(p.idolId)}【${p.title}】"`));'

## 出てきた行を my-optimizer/owned.json に追加して保存（Ctrl + S）。
## ※ 一番最後の行の後ろだけカンマ , を付けないこと。

## 4. my-optimizer/auto-config.json を書き換えて保存
"stageIds": ステップ2で調べた今期の3つのIDを入れる
"targetStage": 全部回すなら "all"、特定ステージだけなら 1 / 2 / 3
"onlyOwned": 所持キャラのみ（5人）なら true、全SSR理論値（8人）なら false
"params": [Vo, Da, Vi, 体力]

## 5. 自動最適化を実行する
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs

## my-optimizer/auto-config.json の "targetStage" を数字に変えて保存（Ctrl + S）するだけです。

ステージ1だけ回す場合："targetStage": 1,
ステージ2だけ回す場合："targetStage": 2,
ステージ3だけ回す場合："targetStage": 3,

※ 数字に ""（ダブルクォーテーション）は付けなくてOKです。全部まとめて回すときは "all" に戻します。

## ※ 途中で止めたいときはターミナルで Ctrl + C。
EOF

作成後、エディタで `my-optimizer/MEMO.md` を開いて **`Ctrl + Shift + V`** を押すと、見やすいプレビュー画面で表示されます。

---

### GitHub上にもバックアップしておきたい場合
今のCodespacesが**自分のアカウントにフォーク（Fork）したリポジトリ**なら、以下を実行すると `my-optimizer` フォルダごと（スクリプト・所持リスト・メモ全部）GitHubに保存されます。

```bash
git add my-optimizer && git commit -m "add my-optimizer" && git push