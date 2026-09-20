#!/usr/bin/env bash
# R4 마감 게이트 드라이버 — R4-BRIEF §5 목록 그대로, **순차 실행**(PATCH-005-J).
# 기억이 아니라 브리프 §5 목록에서 뽑았다. 하나라도 실패하면 즉시 멈춘다.
# 사용: bash tools/_r4gates.sh <출력디렉토리>
set -u
OUT="${1:-/tmp/r4gates}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.."

run() {  # run <이름> <명령...>
  local name="$1"; shift
  echo "=== $name  $(date -u +%H:%M:%S)"
  "$@" > "$OUT/$name.json" 2> "$OUT/$name.log"
  local code=$?
  echo "$name exit=$code" | tee -a "$OUT/SUMMARY.txt"
  if [ $code -ne 0 ]; then echo "!! $name 실패 — 중단"; tail -5 "$OUT/$name.log"; exit $code; fi
}

: > "$OUT/SUMMARY.txt"
run harnesstest      node tools/harnesstest.mjs
run determinismaudit node tools/determinismaudit.mjs
run geometryaudit    node tools/geometryaudit.mjs
run chainaudit       node tools/chainaudit.mjs
run surfaceaudit     node tools/surfaceaudit.mjs
run coveraudit       node tools/coveraudit.mjs
run fxaudit          node tools/fxaudit.mjs
run npmtest          npm test
run playtest         node tools/playtest.mjs
run baseline1        node tools/baseline.mjs --out="$OUT/base1"
run baseline2        node tools/baseline.mjs --out="$OUT/base2"
run imagediff        node tools/imagediff.mjs "$OUT/base1" "$OUT/base2"
run shotaudit        node tools/shotaudit.mjs
run rendervariance   node tools/rendervariance.mjs
run paletteaudit     node tools/paletteaudit.mjs "$OUT/base1"
run albedoaudit      node tools/albedoaudit.mjs
run viewmodelaudit   node tools/viewmodelaudit.mjs
run profile          node tools/profile.mjs --phase=p3
echo "ALL GREEN $(date -u +%H:%M:%S)" | tee -a "$OUT/SUMMARY.txt"
