#!/usr/bin/env bash
# 게이트 체인 드라이버 — **게이트 목록의 유일한 원본**(발주자 결정 2026-09-25, 장부 #27 조치). 브리프는 목록을 손으로 쓰지 않고 이 파일을 따른다.
# 새 게이트는 여기에 추가하고 브리프에는 "이번 패스에서 새로 추가되는 게이트"만 적는다. 케이스 수 같은 개수도 브리프에 쓰지 않는다. **순차 실행**(PATCH-005-J).
# 하나라도 실패하면 즉시 멈춘다. audioaudit 는 발주자 청감 판정 전까지 체인 밖(P4-BRIEF −1-B) — 판정이 오면 아래 주석을 푼다.
# silhouetteaudit 는 P4B 에서 생긴다. 사용: bash tools/gates.sh <출력디렉토리>   (이력: tools/_r4gates.sh 는 R4 판)
#
# 재개 (RESUME=1 bash tools/gates.sh <같은 출력디렉토리>): 이 컨테이너는 ~14 h 마다 재부팅되어 nohup 체인까지 죽는다
# (P4A 체인 1차 09-25 17:38 · 2차 09-26 04:20~07:55 소실 — docs/P4-LOG.md). 체인은 17 h 넘게 걸리므로 재개 없이는 끝을 못 본다.
# 규칙: (1) 출력디렉토리의 SUMMARY.txt 첫 줄(pinned sha·dirty)이 지금과 **글자까지 같을 때만** 재개 — 다르면 exit 2. 게이트 목록은 그대로다.
#       (2) `<이름> exit=0` 이 SUMMARY 에 있는 단계만 건너뛰고, 건너뛴 사실을 SUMMARY 에 남긴다. 실패(exit≠0)는 체인이 멈추므로 SUMMARY 에 남지 않는다.
#       (3) 재부팅에 잘린 단계는 다시 돈다. baseline1/2 · profile 은 도구 자체가 샷·런 단위로 이어 받는다(`--resume` / `--state`,
#           2026-09-27: 컨테이너 생존 창 2~4.5 h 가 baseline 3.7 h · profile 5 h 보다 짧아 단계 단위 재개로는 끝을 못 봤다).
#           단계는 각각 독립 프로세스이고 스냅샷은 불변이라 여러 번에 나눠 돈 체인과 한 번에 돈 체인은 같은 것을 잰다 —
#           단, baseline1/2 가 재부팅 양쪽에 걸리면 "다른 컨테이너 인스턴스 2회"가 된다(더 강한 시험).
#
# 구간 실행 (GATES_FROM=<이름> GATES_TO=<이름>): 목록 순서에서 그 구간만 돈다 — 6 h 잡 상한이 있는 CI 에서 체인을 잡 여러 개로 나눌 때 쓴다.
#   목록·순서는 여전히 이 파일 하나다. `bash tools/gates.sh --list` 는 순서대로 이름만 출력하며, CI 의 마지막 잡이 이것으로
#   모든 단계가 어느 잡에선가 exit=0 였는지 대조한다(구간 밖은 SUMMARY 에 `skip(구간 밖)` 로 남김). 구간 모드는 ALL GREEN 대신 RANGE GREEN 을 찍는다.
set -u
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--list" ]; then grep -E '^run ' "$0" | awk '{print $2}'; exit 0; fi
OUT="${1:-/tmp/r4gates}"
RESUME="${RESUME:-0}"
GATES_FROM="${GATES_FROM:-}"
GATES_TO="${GATES_TO:-}"
mkdir -p "$OUT"

done_step() { [ "$RESUME" = 1 ] && grep -qxF "$1 exit=0" "$OUT/SUMMARY.txt" 2>/dev/null; }
IN_RANGE=1; [ -n "$GATES_FROM" ] && IN_RANGE=0
RANGE_DONE=0

run() {  # run <이름> <명령...>
  local name="$1"; shift
  if [ -n "$GATES_FROM" ] && [ "$name" = "$GATES_FROM" ]; then IN_RANGE=1; fi
  if [ "$IN_RANGE" != 1 ] || [ "$RANGE_DONE" = 1 ]; then echo "$name skip(구간 밖)" >> "$OUT/SUMMARY.txt"; return; fi
  if [ -n "$GATES_TO" ] && [ "$name" = "$GATES_TO" ]; then RANGE_DONE=1; fi
  if done_step "$name"; then echo "=== $name  건너뜀(이전 실행에서 exit=0)"; return; fi
  echo "=== $name  $(date -u +%H:%M:%S)"
  "$@" > "$OUT/$name.json" 2> "$OUT/$name.log"
  local code=$?
  echo "$name exit=$code" | tee -a "$OUT/SUMMARY.txt"
  if [ $code -ne 0 ]; then echo "!! $name 실패 — 중단"; tail -5 "$OUT/$name.log"; exit $code; fi
}

# 출처 고정 (발주자 지시 2026-09-23): 이 체인이 어느 상태를 잰 것인지 SHA 로 남긴다.
# 렌더 도구는 이 스냅샷 워크트리를 서빙하므로, 체인이 도는 동안 작업 트리를 편집해도 결과가 흔들리지 않는다.
PIN=$(node --input-type=module -e 'import("./tools/lib/pinned.mjs").then(m=>{const p=m.pinnedRoot();console.log(p?("pinned sha="+p.sha+" dirty="+p.dirty+" root="+p.root+(p.untracked.length?" 추적안됨="+p.untracked.join(","):"")):"pinned 실패 — 작업 트리 서빙");})')
if [ "$RESUME" = 1 ] && [ -s "$OUT/SUMMARY.txt" ]; then
  PREV=$(head -n1 "$OUT/SUMMARY.txt")
  if [ "$PREV" != "$PIN" ]; then
    echo "!! RESUME 거부 — 스냅샷 불일치"; echo "   이전: $PREV"; echo "   지금: $PIN"; exit 2
  fi
  echo "RESUME $(date -u +%Y-%m-%dT%H:%M:%SZ) — 같은 스냅샷, exit=0 단계 건너뜀" | tee -a "$OUT/SUMMARY.txt"
else
  : > "$OUT/SUMMARY.txt"
  echo "$PIN" | tee -a "$OUT/SUMMARY.txt"
  git rev-parse HEAD | sed 's/^/HEAD /' | tee -a "$OUT/SUMMARY.txt"
fi
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
run baseline1        node tools/baseline.mjs --out="$OUT/base1" --resume   # --resume: 샷별 사이드카가 있으면 그 샷은 건너뜀(잘린 실행 이어 받기)
run baseline2        node tools/baseline.mjs --out="$OUT/base2" --resume
run imagediff        node tools/imagediff.mjs "$OUT/base1" "$OUT/base2"
run shotaudit        node tools/shotaudit.mjs
run rendervariance   node tools/rendervariance.mjs
run paletteaudit     node tools/paletteaudit.mjs "$OUT/base1"
run albedoaudit      node tools/albedoaudit.mjs
run viewmodelaudit   node tools/viewmodelaudit.mjs
run profile          node tools/profile.mjs --phase=p3 --state="$OUT/profile.state"   # --state: 런·스윕별 사이드카로 이어 받기
if [ -n "$GATES_FROM$GATES_TO" ]; then echo "RANGE GREEN ${GATES_FROM:-처음}..${GATES_TO:-끝} $(date -u +%H:%M:%S)" | tee -a "$OUT/SUMMARY.txt"
else echo "ALL GREEN $(date -u +%H:%M:%S)" | tee -a "$OUT/SUMMARY.txt"; fi
