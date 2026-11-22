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

## 全ステージ × 全キャラ

アイドルに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs all all idol

ステージに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs all all stage

## 全ステージ × 所持キャラ

アイドルに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs all owned idol

ステージに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs all owned stage

## ステージ1のみ × 全キャラ（※ 1 を 2 や 3 に変えれば他ステージ）

アイドルに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs 1 all idol

ステージに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs 1 all stage

## ステージ1のみ × 所持キャラ

アイドルに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs 1 owned idol

ステージに合わせる：
node --no-warnings --loader ./scripts/extensionless-loader.mjs my-optimizer/auto-optimize.mjs 1 owned stage


## ※ 途中で止めたいときはターミナルで Ctrl + C。
EOF

作成後、エディタで `my-optimizer/MEMO.md` を開いて **`Ctrl + Shift + V`** を押すと、見やすいプレビュー画面で表示されます。

---

### GitHub上にもバックアップしておきたい場合
今のCodespacesが**自分のアカウントにフォーク（Fork）したリポジトリ**なら、以下を実行すると `my-optimizer` フォルダごと（スクリプト・所持リスト・メモ全部）GitHubに保存されます。

git add my-optimizer && git commit -m "add CLI args for stage and owned mode" && git push