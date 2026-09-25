#!/usr/bin/env bash
# 게이트 체인 드라이버 — **게이트 목록의 유일한 원본**(발주자 결정 2026-09-25, 장부 #27 조치). 브리프는 목록을 손으로 쓰지 않고 이 파일을 따른다.
# 새 게이트는 여기에 추가하고 브리프에는 "이번 패스에서 새로 추가되는 게이트"만 적는다. 케이스 수 같은 개수도 브리프에 쓰지 않는다. **순차 실행**(PATCH-005-J).
# 하나라도 실패하면 즉시 멈춘다. audioaudit 는 발주자 청감 판정 전까지 체인 밖(P4-BRIEF −1-B) — 판정이 오면 아래 주석을 푼다.
# silhouetteaudit 는 P4B 에서 생긴다. 사용: bash tools/gates.sh <출력디렉토리>   (이력: tools/_r4gates.sh 는 R4 판)
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
# 출처 고정 (발주자 지시 2026-09-23): 이 체인이 어느 상태를 잰 것인지 SHA 로 남긴다.
# 렌더 도구는 이 스냅샷 워크트리를 서빙하므로, 체인이 도는 동안 작업 트리를 편집해도 결과가 흔들리지 않는다.
node --input-type=module -e 'import("./tools/lib/pinned.mjs").then(m=>{const p=m.pinnedRoot();console.log(p?("pinned sha="+p.sha+" dirty="+p.dirty+" root="+p.root+(p.untracked.length?" 추적안됨="+p.untracked.join(","):"")):"pinned 실패 — 작업 트리 서빙");})' | tee -a "$OUT/SUMMARY.txt"
git rev-parse HEAD | sed 's/^/HEAD /' | tee -a "$OUT/SUMMARY.txt"
run harnesstest      node tools/harnesstest.mjs
# run audioaudit       node tools/audioaudit.mjs   # 발주자 청감 판정 대기 — 3쌍(창살-천 · 기둥-초가 · 기둥-지붕흙) exit 1 (P4-BRIEF −1-B)
# run silhouetteaudit  node tools/silhouetteaudit.mjs   # P4B 신규
run determinismaudit node tools/determinismaudit.mjs
run geometryaudit    node tools/geometryaudit.mjs
run chainaudit       node tools/chainaudit.mjs
run surfaceaudit     node tools/surfaceaudit.mjs
run coveraudit       node tools/coveraudit.mjs
run fxaudit          node tools/fxaudit.mjs
run npmtest          npm test
run distaudit        node tools/distaudit.mjs   # 배포물 검사 (P4-BRIEF §7 신규) — vite build → dist 부팅 · 에셋 200 · 콘솔 오류 0
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
