export const meta = {
  name: 'p4b-design',
  description: 'P4B 설계: 우선순위가 다른 독립 설계안 3개 → 심사·접목 → 종합 설계서 → 계약 대조 적대 검토',
  phases: [
    { title: 'Propose', detail: '독립 설계안 3개(관점별)' },
    { title: 'Judge', detail: '기준별 채점·승자·접목' },
    { title: 'Synthesize', detail: '종합 설계서(한국어 마크다운)' },
    { title: 'Review', detail: '계약·코드 사실 대조 적대 검토' },
  ],
}

const MAPS = 'docs/p4b/inputs'
const COMMON = `
맥락: 저장소 <저장소 루트> (브랜치 r4-wip). JOSEON-CQB — three.js r180 브라우저 FPS, 4코어 SwiftShader 헤드리스로 게이트를 돈다. P4A(오디오)는 끝났고 지금 P4B(액터 4종 + 청크 내비메시 + PBD 래그돌 + silhouetteaudit + 케이스 22 + 노출 적응 동결)를 설계한다.
**입력 지도 6개**(이미 코드를 읽고 만든 구조화 사실, 근거 파일:줄 포함): ${MAPS}/map_physics.json, map_world.json, map_render.json, map_core.json, map_tooling.json, map_contracts.json — 먼저 이 6개를 읽어라(cat). 계약 원문은 docs/contracts/briefs/P4-BRIEF.md §0·§1·§3·§4-1·§4-9·§5·§7.
**지도에 이미 있는 사실은 다시 조사하지 마라.** 코드는 설계 판단에 꼭 필요한 특정 구간만 확인하라(grep→해당 줄). 파일 수정·생성 금지(읽기 전용), 브라우저·렌더 도구 실행 금지.
반드시 지킬 계약 사실(지도에서 확인됨):
- 야간 창호지 실루엣은 메시 그림자가 아니라 등록된 해석적 캡슐 차폐(hanji-occluders.js, 상한 4, 초과 시 조용히 탈락, resetState 미복원)로 계산된다. HANJI 불투명도 1.0 이라 판 뒤 메시는 보이지 않는다. 현재 등롱 높이 2.0 m(P1 배치, 계약값 아님)로는 바닥에서 ≈0.68 m 아래가 판에 투영되지 않는다. 브리프: "판독되지 않으면 캐릭터가 아니라 조명 구성을 고쳐라 — 더미를 가까이 옮겨 통과시키지 마라"(PATCH-008-B).
- PBD 래그돌·내비메시·src/ai·액터는 코드에 없다(신규 구현). CharacterController 는 정적 BVH 하고만 충돌(캐릭터끼리 통과), 캡슐 수직 고정, h<2r 이면 발이 뜬다. BVH 는 증분 없음(전체 재빌드 49–270 ms) → 런타임 간선·표면을 BVH 재빌드에 기대지 마라.
- 결정성: 시뮬 창(stepFrames, 렌더 포함)에서 Math.random 1회라도 → 하네스 오류. three 의 Object3D/Material/Geometry/Skeleton 생성자가 Math.random(generateUUID)을 부르므로 메시·본·래그돌 표시물은 부팅 때 풀로 미리 만든다. 난수는 rngStream(name) 을 쓸 때마다 호출. resetState 19단계 고정 순서에 액터·래그돌·내비·차폐 등록이 없다. bus 어휘 17종 폐쇄(actor:damage/death 선언만).
- 렌더: 재질 TRI(월드 투영) 모드는 움직이는 액터에서 미끄러진다 → 캐릭터는 'uv' 모드 복제본 + 생성기 UV(ROOF_TILE_UV·VM_* 선례). 스키닝은 프로그램 캐시 키 비트라 forward·그림자·GTAO 변형이 늘어난다 — 프리웜 샷에서 스킨 액터가 보여야 플레이 중 컴파일 0. 프로그램 예산 110(현재 44). 팀 색: 이세계=청(175–240°), 인간계=적(355–15°), LACQUER 는 적 대역, BRONZE 녹청은 청 하한 근처, 원본 DANCHEONG 은 청·적 혼재.
- 판정 임계 원칙(014-C, 내 오류 기록 CONTRACT-NOTES ≈1990): **게이트 임계를 설계자가 발명하지 마라.** 숫자는 후보를 좁히는 데까지만, 최종은 캡처를 본 발주자가 정한다. 기존 계약값을 재사용하는 것은 가능(예: fxaudit 시각 구별 '상대차 15% 초과·최소 2축' = VISUAL_REL_MIN·발주자 지시 2026-09-20) — 그 경우 근거를 명시하고 '발주자 확정 대기'로 표시.
- 예산: 캐릭터 1종 ≤25k 삼각형, tris_scene ≤600k, tris_frame_p95 ≤250k, programs ≤110, 플레이 중 컴파일 0, boot_cpu ≤3 s. 게이트 목록 원본은 tools/gates.sh(CI 는 .github/workflows/gates.yml 의 구간·시간 조각 잡). 체인은 순차.
출력은 한국어(식별자·경로 원문). 근거가 지도/코드에 있으면 파일:줄을 달아라.`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    overview: { type: 'string' },
    modules: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, responsibility: { type: 'string' }, publicApi: { type: 'string' }, simOrPresentation: { type: 'string' } }, required: ['path', 'responsibility', 'publicApi', 'simOrPresentation'] } },
    characterData: { type: 'string', description: '데이터 형식 정의 + 자라 예시(JSON 형태) + v1 8종·흥부 변장 예외·정보 은닉 필드가 코드 추가 없이 들어가는 이유' },
    meshGeneration: { type: 'string', description: '절차 스킨드 메시 생성(원시→메시, 스키닝, UV, 재질 슬롯, 삼각형 예산 계산)' },
    silhouetteModel: { type: 'string', description: '차폐 모델 선택(대안 비교: 캡슐 프록시 확장 / 원뿔·구 프록시 / 점광 큐브 그림자맵 / 혼합), 메시-프록시 일치 보장, 상한·컬링, 셰이더 변경, 비용, 조명 구성 수정(등롱 위치·높이 기하 계산 포함)' },
    navmesh: { type: 'string', description: '표현(격자/폴리곤), 굽기(StaticWorld 삼각형·하향 레이), 청크·경계 간선, 런타임 간선 추가/제거, 이동 능력 플래그(걷기·점프·낙하·담 넘기), 경로 탐색, 결정성, resetState, 현 맵 결함(객사 출입구·누각 난간) 처리' },
    ragdoll: { type: 'string', description: 'PBD 표현(입자·거리 구속·각도 제한), 정적 월드 충돌(overlapCapsule 접촉 합산 문제·얇은 콜라이더 터널링 대책), 스텝·반복 순서, 슬립, 풀링, actor:death 배선, 최종 자세 해시 검증 방법' },
    actorRuntime: { type: 'string', description: '스폰·컨트롤러·액터 간/플레이어와 분리, 히트박스(체인 통합은 P4C 로 미루는 범위 구분), 시뮬/표현 분리, 정보 은닉 경계, simSubstep·resetState 통합 지점' },
    silhouetteaudit: { type: 'string', description: '장면 구성(hanji_silhouette 재사용·더미 처리), 실루엣 추출(차분 방식·노출 처리), 4축의 수치 정의, 쌍 판정(임계 원칙 준수), 대비 공식·해상도, 팀 색 분리 정적 검사 위치, 음성 --test-clone(케이스 22), 선언 예외(P4D), 게이트·CI 배치, 소요 시간 추정' },
    exposureFreeze: { type: 'string', description: '동결 대상·방법(구조적 읽기 전용 + 런타임 일치 검사 + 음성), 플레이테스트 근거 측정 방법, 시점' },
    integrationAndTests: { type: 'string', description: 'harness/main.js/prewarm/profile/baseline/shotaudit/playtest/harnesstest 변경 목록, 단위 테스트(node --test) 목록, 새 게이트, 계약 샷 영향' },
    ownerDecisions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, recommendation: { type: 'string' }, why: { type: 'string' } }, required: ['question', 'recommendation', 'why'] } },
    risks: { type: 'array', items: { type: 'string' } },
    implementationPlan: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, files: { type: 'string' }, parallelizable: { type: 'boolean' }, verify: { type: 'string' } }, required: ['step', 'files', 'parallelizable', 'verify'] } },
  },
  required: ['lens', 'overview', 'modules', 'characterData', 'meshGeneration', 'silhouetteModel', 'navmesh', 'ragdoll', 'actorRuntime', 'silhouetteaudit', 'exposureFreeze', 'integrationAndTests', 'ownerDecisions', 'risks', 'implementationPlan'],
}

const LENSES = [
  { key: 'fidelity', text: '관점 A — **핵심 메커닉 충실도 우선**: 창호지 너머 실루엣 판독이 이 게임의 핵심이다. 4종 윤곽이 2.5 m 역광에서 확실히 갈리고 메시와 판 위 그림자가 어긋나지 않는 것을 최우선으로 설계하라. 비용·복잡도는 예산 안에서 감수.' },
  { key: 'extensible', text: '관점 B — **확장성 우선(v1 8종·한양 시내)**: P4D 에서 v1 4종을 코드 추가 0 으로 받고, 도시 규모로 청크가 늘어나도 구조를 다시 짜지 않는 것을 최우선으로. 데이터 주도·조합 가능성·청크 독립성.' },
  { key: 'robust', text: '관점 C — **결정성·넷코드·검증 가능성 우선**: 리슨 서버 권위형(§5), resetState 완전 복원, 시뮬/표현 분리, 정보 은닉, 모든 새 동작에 음성 테스트, 최소 변경으로 기존 게이트를 깨지 않는 것을 최우선으로. 단순하고 감사 가능한 설계.' },
]

phase('Propose')
const designs = await parallel(LENSES.map(l => () =>
  agent(`${COMMON}\n\n${l.text}\n\nP4B 전체 설계안을 하나 만들어라(다른 관점의 설계안이 따로 나온다 — 네 관점을 끝까지 밀어라). 각 항목은 구현자가 바로 코드를 쓸 수 있을 만큼 구체적으로(자료구조·알고리즘·파일 경로·함수 이름). ownerDecisions 에는 발주자만 정할 수 있는 것만 넣고 각각 추천안을 달아라.`,
    { label: `propose:${l.key}`, phase: 'Propose', schema: DESIGN_SCHEMA })
    .then(d => d ? { key: l.key, ...d } : null)))
const ok = designs.filter(Boolean)
log(`설계안 ${ok.length}/3`)

phase('Judge')
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, contract: { type: 'number' }, mechanic: { type: 'number' }, determinism: { type: 'number' }, extensibility: { type: 'number' }, cost: { type: 'number' }, testability: { type: 'number' }, notes: { type: 'string' } }, required: ['key', 'contract', 'mechanic', 'determinism', 'extensibility', 'cost', 'testability', 'notes'] } },
    perComponentWinner: { type: 'array', items: { type: 'object', properties: { component: { type: 'string' }, winner: { type: 'string' }, why: { type: 'string' }, grafts: { type: 'string' } }, required: ['component', 'winner', 'why', 'grafts'] } },
    fatalFlaws: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, flaw: { type: 'string' }, evidence: { type: 'string' } }, required: ['key', 'flaw', 'evidence'] } },
  },
  required: ['scores', 'perComponentWinner', 'fatalFlaws'],
}
const judge = await agent(`${COMMON}\n\n당신은 심사관이다. 아래 P4B 설계안 ${ok.length}개를 계약 준수(P4-BRIEF §3·§5·§7, 014-C 임계 원칙)·핵심 메커닉(실루엣 판독)·결정성/resetState·확장성(v1 코드 0, 도시 청크)·비용(예산·구현 규모)·검증 가능성(음성 테스트·게이트) 6기준 0–10 으로 채점하라.
구성요소별(데이터 형식·메시 생성·실루엣 모델·조명 수정·내비메시·래그돌·액터 런타임·silhouetteaudit·노출 동결·통합/테스트) 승자와 다른 안에서 접목할 것을 정하라. 치명적 결함(계약 위반·코드 사실과 모순·결정성 붕괴)은 근거와 함께 따로 적어라 — 의심되면 코드를 직접 확인하라.\n\n${JSON.stringify(ok)}`,
  { label: 'judge', phase: 'Judge', schema: JUDGE_SCHEMA })

phase('Synthesize')
const synth = await agent(`${COMMON}\n\n당신은 종합 설계자다. 아래 설계안 ${ok.length}개와 심사 결과를 받아 **최종 P4B 설계서**를 한국어 마크다운으로 써라(docs/P4B-DESIGN.md 로 저장될 본문 — 반환 텍스트 전체가 문서다, 파일은 쓰지 마라).
구성: 0 요약(결정 10줄) · 1 모듈 배치(경로·책임·시뮬/표현) · 2 캐릭터 데이터 형식(필드 표 + v0 4종 정의 초안 + v1 수용 근거) · 3 절차 메시 생성 · 4 실루엣 모델·조명 구성(기하 계산 포함) · 5 내비메시 · 6 PBD 래그돌 · 7 액터 런타임·시뮬/표현 분리·정보 은닉 · 8 silhouetteaudit(축 정의·판정·대비·팀 색·케이스 22·CI 배치) · 9 노출 동결 · 10 하네스·게이트·계약 샷 영향 · 11 발주자 결정 사항(추천안 포함, 014-C 원칙) · 12 위험 · 13 구현 순서(병렬 가능 단위·검증).
심사의 구성요소별 승자를 기본으로 하되 치명적 결함은 반드시 고쳐 반영하라. 구현자가 그대로 따라 코딩할 수 있게 구체적으로(자료구조·함수 시그니처·상수 출처). 발명 임계는 넣지 말고 '후보 + 발주자 확정' 으로.\n\n## 설계안\n${JSON.stringify(ok)}\n\n## 심사\n${JSON.stringify(judge)}`,
  { label: 'synthesize', phase: 'Synthesize' })

phase('Review')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['치명', '중대', '경미'] }, section: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'section', 'issue', 'evidence', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}
const review = await agent(`${COMMON}\n\n당신은 적대적 검토자다. 아래 P4B 최종 설계서를 **반박하려고** 읽어라: 계약 원문(P4-BRIEF §3·§5·§7, PATCH-008-B·010-C, HARNESS 규칙, 014-C)과 어긋나는 곳, 코드 사실(지도·실제 코드)과 모순되는 가정, 결정성·resetState 구멍, 예산 초과 위험, 검증 불가능한 주장, 발명된 임계, 구현 순서의 의존성 오류를 찾아라. 의심되면 코드를 직접 열어 확인하라. 항목마다 근거와 고칠 방법.\n\n${synth}`,
  { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA })

return { designs: ok, judge, synth, review }
