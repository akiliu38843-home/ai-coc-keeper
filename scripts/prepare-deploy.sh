#!/usr/bin/env bash
# 把 dist 打成可直接拖到 Vercel / Netlify 的 tar.gz
#
# 用法: bash scripts/prepare-deploy.sh [output-name]
# 输出: /tmp/<name>.tar.gz

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/external/WebGAL/packages/webgal/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "❌ dist 不存在，先跑: npm run build:dist" >&2
  exit 1
fi

NAME="${1:-ai-coc-keeper-$(date +%Y%m%d-%H%M%S)}"
OUT="/tmp/${NAME}.tar.gz"

cd "$DIST_DIR"
tar czf "$OUT" .

SIZE=$(du -h "$OUT" | cut -f1)
echo "✅ $OUT  ($SIZE)"
echo ""
echo "部署 (任选其一):"
echo "  Vercel:    vercel --prod  (在 $DIST_DIR 里跑)"
echo "  Netlify:   netlify deploy --prod --dir=$DIST_DIR"
echo "  CF Pages:  wrangler pages deploy $DIST_DIR --project-name=ai-coc-keeper"
echo "  手动:      把 $OUT 解压到任何 CDN / nginx root 即可"
