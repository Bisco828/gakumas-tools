cat << 'EOF' > my-optimizer/MEMO.md
# 学マス コンテスト自動最適化 毎シーズン手順

## 1. 本家の最新データを取り込む（新ステージ・新キャラ反映）
```bash
git pull && pnpm install