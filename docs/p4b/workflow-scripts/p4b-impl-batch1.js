export const meta = {
  name: 'p4b-impl-batch1',
  description: 'P4B 구현 1묶음(p4b-dev, 결정 무관): 단계 1 노출 구조 동결 · 단계 3a 캐릭터 데이터 층 · 단계 5 PBD 래그돌 — 워크트리 격리 병렬 구현 → 브랜치별 적대 검증',
  phases: [
    { title: 'Implement', detail: '단계 1 · 3a · 5 병렬(워크트리)' },
    { title: 'Verify', detail: '브랜치별 독립 적대 검증' },
  ],
}

const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Vh2VNgqUqtwJ9BqjuuvmPQ'
const COMMON = (key) => `
당신은 JOSEON-CQB(three.js r180 브라우저 FPS) P4B 구현자다. 설계서는 docs/P4B-DESIGN.md(개정 2 + 부록 R2) — 지정된 절을 먼저 정독하고 그대로 구현하라. 계약은 docs/contracts/briefs/P4-BRIEF.md, 규칙은 HARNESS.md·ARCHITECTURE.md. 하위 시스템 사실 지도: docs/p4b/inputs/map_*.json(필요한 것만).
**작업 환경 규칙**
1. 지금 격리된 git 워크트리 안이다(현재 디렉터리). 먼저 \`[ -e node_modules ] || ln -s <저장소 루트>/node_modules node_modules\`. node_modules 는 절대 커밋하지 않는다 — \`git add\` 는 **경로를 지정해서만**(\`git add -A\`·\`git add .\` 금지).
2. 브랜치: \`git branch --list p4b/${key}\` 가 이미 있으면(이전 시도가 사용량 한도로 끊긴 것) \`git checkout p4b/${key}\` 후 \`git log --oneline p4b-dev..\` 로 진행분을 확인하고 **이어서** 하라. 없으면 \`git checkout -b p4b/${key}\`. **푸시하지 마라.**
3. **작게 자주 커밋**(논리 단위마다 — 중간에 끊겨도 진행분이 남게). 커밋 메시지는 한국어, 끝에 빈 줄 뒤 다음 두 줄:\n${ATTR}
4. 결정성 규칙: src 시뮬 코드에 Math.random·Date.now·performance.now 금지(난수는 core/rng 의 rngStream(name) 을 쓸 때마다 호출, 시간은 core/clock). three 객체 생성(generateUUID → Math.random)은 부팅 경로에서만. 명명 상수만(매직 넘버 금지), 주석은 기존 코드처럼 한국어로 왜를 적는다.
5. 디렉터리 간 직접 import 금지 — 주입(설계서 §1-1 묶음 표). 시뮬 파일은 three 를 import 하지 않는다(전이 폐포 포함).
6. 테스트: 새 동작마다 \`test/*.test.mjs\`(node --test) 를 쓰고 **음성 테스트**(검사가 실제로 실패를 잡는지)도 같이. "모든 X 가 Y" 검사는 X ≥ 1 을 함께 단언(비공허). 끝나기 전 \`npm test\` 전체가 통과해야 한다(기존 테스트 포함).
7. 게이트 임계를 발명하지 마라(014-C). 설계서가 '후보'·'발주자 확정'이라 한 값은 그 표시를 코드 주석·상수 이름에 남긴다.
8. 설계와 다르게 해야 하면 코드 사실로 근거를 대고 최종 보고 deviations 에 적어라. 설계서 파일 자체는 고치지 마라.
`
const RESULT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string', description: '실행한 명령과 결과(통과/실패 수)' },
    renderRuns: { type: 'string', description: '실행한 렌더 도구와 결과(없으면 없음)' },
    deviations: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
    integrationNotes: { type: 'string', description: 'p4b-dev 에 병합할 때·다음 단계가 알아야 할 것' },
  },
  required: ['branch', 'commits', 'files', 'tests', 'renderRuns', 'deviations', 'openIssues', 'integrationNotes'],
}

const UNITS = [
  { key: 'exposure', step: '단계 1 — 노출 계약 구조 동결', prompt: `설계서 §9 전체(9-1~9-7)와 §13 단계 1 행, §10-1(harness)·§10-7(케이스 표의 30)을 따른다. 범위: src/render/exposure-contract.js(신설, deepFreeze, 단독 수정 금지 머리주석, exposureContractHash), src/render/exposure.js·pipeline.js(계약 frozen 뷰, 셰이더 상수 템플릿, lock/unlock, 그리기 시점 값 기록 — 미터 드로우 유니폼과 블룸·출력 드로우의 ec, testOverride 층), src/core/harness.js(측정 잠금·testOverride 노출, resetState 에서 해제), tools/playtest.mjs(\`--section <이름>\` 으로 해당 절만 실행 + \`--inject-exposure-drift\` 음성), tools/harnesstest.mjs 케이스 30(exit 1 + testOverride 표식 + 그리기 시점 rateUp 증거, 타임아웃은 실측 × 2.5), HARNESS.md 도구·규칙 행. exposureprobe(단계 13)는 하지 않는다. 노출 **값은 바꾸지 않는다**(현재값 동결 — pipeline.js EXPOSURE_PARAMS 그대로).
**렌더 실행 허용(이 단위만)**: 다른 두 단위는 렌더를 쓰지 않는다. 확인용으로 (a) \`node tools/playtest.mjs --section <노출 절>\` 과 음성, (b) 케이스 30 단독, (c) **체크포인트 ①** — \`node tools/baseline.mjs --out=tmp/ckpt1 --shots=courtyard_noon,hanji_silhouette\`(계약 해상도·settle 기본값, 샷당 ≈20 분) 결과의 샷별 sha256 이 기준 <CI 실행의 base1/report.json — docs/P4-LOG.md 참조>(같은 src 의 CI 실행) 과 같아야 한다 — 구조 동결은 픽셀을 바꾸면 안 된다. 렌더 도구는 한 번에 하나씩, 백그라운드로 여러 개 띄우지 마라. 브라우저 실행이 끝나면 프로세스가 남지 않게 하라.` },
  { key: 'actordata', step: '단계 3a — 캐릭터 데이터 층', prompt: `설계서 §2 전체(2-1~2-7)와 §1-1·§1-2 의 actors-data 행, §13 단계 3a 행, 부록 R·R2 중 데이터 형식 관련 항목을 따른다. 범위: src/actors/data/limits.js, schema.js(validateCharacter(def, ctx) → {ok, problems[]}, estimateTris), skeletons/biped.js(BIPED deep frozen, buildRest(proportions, posture) 순수 함수, 래그돌 템플릿 — 입자 16·막대·버팀대·거리 한계·경첩·프레임 복원표), characters/{jara,dokkaebi,tokki,kongjwi}.js(설계서 §2-6 초안 수치 — 순수 데이터, 함수 없음), roster.js(import 줄과 배열만), index.js(getRoster(ctx), resolveAppearance, visualRigOf, agentOf — 외견은 시각 리그 단위 rigOf), test/fixtures/characters-v1/{gyeonu,jiknyeo,simcheong,heungbu}.js(제안 윤곽 — 흥부 disguise=도깨비 선언 예외 포함), test/fixtures 음성 정의들. 재질 키는 materials 를 import 하지 말고 ctx.materialKeys 로 주입받는다(테스트는 설계서 §3-6 의 ACTOR_* 키 목록을 넘긴다). 무기 금속은 무채 ACTOR_METAL(검토 #8 처분). 테스트 test/actor-data.test.mjs: 8종(v0 4 + v1 fixture 4) 검증 통과, 음성 fixture 마다 throw/problem, src/** 에서 로스터 id 문자열 리터럴 0(데이터·자산 디렉터리 제외), JSON 왕복 동일(순수성), roster.js 린트, buildRest 결정성, 외견 해석(rigOf) 단언, estimateTris ≤ 25,000. **렌더 도구 실행 금지**(노드만).` },
  { key: 'ragdoll', step: '단계 5 — PBD 래그돌', prompt: `설계서 §6 전체(6-1~6-5)와 §1-2 의 physics 행(ragdoll.js, index.js 파사드 확장, character.js 는 이 단위에서 건드리지 않음), §13 단계 5 행을 따른다. 3a(biped 템플릿)는 병렬로 다른 구현자가 만든다 — 이 단위는 설계서 §2-4·§6-2 의 템플릿 형식을 그대로 따르는 **합성 템플릿**(test/fixtures/ragdoll-template.mjs)으로 먼저 개발하고, 리그 컴파일 입력 형식을 설계서와 일치시켜 나중에 biped.js 로 바꿔 끼우기만 하면 되게 하라. 범위: src/physics/ragdoll.js(PBD 월드 — 입자 16, 막대·버팀대·거리 한계·경첩 반공간, 뼈 캡슐–정적 삼각형 접촉 축약(overlapCapsule 접촉 합산 과보정 방지), 입자 CCD, '중심은 어떤 삼각형도 건너지 않는다' 클램프, 활성화 시 부모→자식 초기 클램프(부록 R 검토 #17), 슬립 상한, 질량 분율 + 진짜 총질량, Float64 최종 자세 해시, 부팅 풀·할당 0, reset), src/physics/index.js(ragdoll 소유, step = rigid → ragdoll, gravity 공개, initRagdoll). 기존 강체 동작·rigid.bodies 수(playtest 가 3 을 단언)는 바꾸지 마라. actor:death 배선(ai/death.js)은 단계 9a 이므로 하지 않는다 — API 만. 테스트 test/ragdoll.test.mjs: 같은 입력 2회 해시 동일, reset 후 재실행 동일, 바닥 정지·슬립, 0.3 mm 얇은 판 비관통(판 앞 0.3 m 팔 뻗은 자세 사망 포함), 창살 24 mm, 총질량 = 진짜 massKg, 할당 0(풀), 음성(구속 제거 시 해시·자세가 달라지는지 등). 헤드리스 StaticWorld 는 test/raychain.test.mjs 선례처럼 합성 기하로. **렌더 도구 실행 금지**(노드만).` },
]

phase('Implement')
const impl = await parallel(UNITS.map(u => () =>
  agent(`${COMMON(u.key)}\n## 맡은 단위: ${u.step}\n${u.prompt}\n\n끝나면 결과를 구조화해 반환하라.`, { label: `impl:${u.key}`, phase: 'Implement', isolation: 'worktree', schema: RESULT })
    .then(r => r ? { key: u.key, step: u.step, ...r } : null)))
const done = impl.filter(Boolean)
log(`구현 ${done.length}/${UNITS.length}`)

phase('Verify')
const VERDICT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    testsReRun: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['치명', '중대', '경미'] }, file: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'file', 'issue', 'evidence', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['branch', 'testsReRun', 'findings', 'verdict'],
}
const verified = await parallel(done.map(d => () =>
  agent(`당신은 독립 적대 검증자다. 저장소 <저장소 루트> 의 브랜치 **${d.branch}**(기준 p4b-dev)에 들어온 P4B ${d.step} 구현을 **반박하려고** 검증하라. 읽기 전용 — 파일을 고치거나 커밋하지 마라.
방법: \`git -C <저장소 루트> diff p4b-dev...${d.branch}\` 로 변경을 보고, 설계서 docs/P4B-DESIGN.md 의 해당 절(구현자 보고 아래)과 대조하라. 임시 워크트리로 테스트를 다시 돌려라: \`D=$(mktemp -d) && git -C <저장소 루트> worktree add -q --detach $D ${d.branch} && ln -s <저장소 루트>/node_modules $D/node_modules && (cd $D && npm test)\`, 끝나면 \`git -C <저장소 루트> worktree remove --force $D\`. **렌더 도구 실행 금지.**
찾을 것: 설계 불일치, 결정성 구멍(Math.random·시간원·할당·순서 의존·resetState 누락), 공허한 테스트(항상 통과하는 단언, 비공허 누락), 음성 테스트가 실제로 검사를 발화시키는지, 직접 import 규칙 위반(시뮬 파일의 three 전이 폐포), 기존 동작 변경(기존 테스트·playtest 가정), 매직 넘버·발명 임계. 근거는 파일:줄.
구현자 보고: ${JSON.stringify(d)}`,
    { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT })))

return { impl: done, verified: verified.filter(Boolean) }
