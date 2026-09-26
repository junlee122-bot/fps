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
#       (3) 재부팅에 잘린 단계는 부분 산출물(base1/base2)을 지우고 처음부터 다시 돈다. 단계는 각각 독립 프로세스이고 스냅샷은 불변이라
#           여러 번에 나눠 돈 체인과 한 번에 돈 체인은 같은 것을 잰다 — 단, baseline1/2 가 재부팅 양쪽에 걸리면 "다른 컨테이너 인스턴스 2회"가 된다(더 강한 시험).
set -u
OUT="${1:-/tmp/r4gates}"
RESUME="${RESUME:-0}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.."

done_step() { [ "$RESUME" = 1 ] && grep -qxF "$1 exit=0" "$OUT/SUMMARY.txt" 2>/dev/null; }

run() {  # run <이름> <명령...>
  local name="$1"; shift
  if done_step "$name"; then echo "=== $name  건너뜀(이전 실행에서 exit=0)"; return; fi
  case "$name" in baseline1) rm -rf "$OUT/base1" ;; baseline2) rm -rf "$OUT/base2" ;; esac   # 잘린 부분 산출물 제거
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
