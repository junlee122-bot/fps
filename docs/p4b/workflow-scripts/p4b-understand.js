export const meta = {
  name: 'p4b-understand',
  description: 'P4B 착수 전 관련 하위 시스템 6개를 병렬로 읽어 구조화 지도 작성 → 완전성 비평 → 빈칸 표적 재조사(읽기 전용)',
  phases: [
    { title: 'Map', detail: '하위 시스템별 독립 판독' },
  ],
}

const RULES = `
작업 규칙 (반드시):
- 저장소: <저장소 루트> (브랜치 r4-wip). **읽기 전용** — 어떤 파일도 수정·생성하지 마라(스크래치 <임시디렉터리>).
- 브라우저·렌더 도구(baseline, capture, shotset, playtest, profile, rendervariance, albedoaudit, viewmodelaudit, pixelowner, shotaudit 의 렌더 경로, harnesstest, gates.sh)를 **실행하지 마라**. 노드 헤드리스로 2분 안에 끝나는 읽기 전용 확인(예: node -e 로 모듈 상수 출력, grep, wc)은 허용.
- 주장마다 근거(파일:줄)를 달아라. 추측은 추측이라고 표시하라. 코드에 없는 것을 있다고 쓰지 마라(예: 문서가 "PBD 래그돌"을 말해도 코드에 없으면 없다고).
- 출력 언어: 한국어(식별자·경로는 원문).
- 맥락: P4B = 액터 4종(자라·도깨비·토끼·콩쥐, v1 8종 대비 데이터 형식) + 청크 내비메시(런타임 간선·이동 능력 플래그) + PBD 래그돌(결정적, resetState 포함) + tools/silhouetteaudit.mjs(HANJI 판 뒤 2.5 m 역광 실루엣 6쌍×4축, 대비 ≥0.15, 팀 색 대역 비겹침) + harnesstest 케이스 22 + 노출 적응 범위·속도 계약값 동결(P4-BRIEF §5-1 ⓐ). 계약 원문은 docs/contracts/briefs/P4-BRIEF.md §3·§5·§7.
`

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    subsystem: { type: 'string' },
    summary: { type: 'string', description: '설계자가 먼저 알아야 할 것 5~10문장' },
    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, role: { type: 'string' }, keyExports: { type: 'array', items: { type: 'string' } } }, required: ['path', 'role'] } },
    apis: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, where: { type: 'string' }, signature: { type: 'string' }, semantics: { type: 'string' } }, required: ['name', 'where', 'semantics'] } },
    invariants: { type: 'array', items: { type: 'object', properties: { rule: { type: 'string' }, evidence: { type: 'string' } }, required: ['rule', 'evidence'] } },
    extensionPoints: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, where: { type: 'string' }, howP4BUsesIt: { type: 'string' } }, required: ['point', 'where', 'howP4BUsesIt'] } },
    p4bConstraints: { type: 'array', items: { type: 'object', properties: { constraint: { type: 'string' }, source: { type: 'string' } }, required: ['constraint', 'source'] } },
    risks: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, why: { type: 'string' }, mitigation: { type: 'string' } }, required: ['risk', 'why'] } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['subsystem', 'summary', 'files', 'apis', 'invariants', 'extensionPoints', 'p4bConstraints', 'risks', 'openQuestions'],
}

const READERS = [
  { key: 'physics', prompt: `하위 시스템: 물리·플레이어 — src/physics/* (bvh.js StaticWorld·bakeMesh, character.js CharacterController, rigidbody.js RigidBody/RigidBodyWorld, raychain.js collectRayChain, math.js, surface-registry.js MASK/LAYER, index.js PhysicsWorld), src/player/*, test/raychain.test.mjs·penetration.test.mjs.
P4B 가 알아야 할 것: (1) PBD 래그돌을 새로 만들 때 재사용할 원시 함수(캡슐/구 vs 삼각형 접촉, closestPtSegSeg 등)와 정적 월드 질의 API, 스텝 시간(PHYSICS_DT)·서브스텝 구조·결정성(정렬·반복 순서·부동소수 의존) (2) 액터 이동에 CharacterController 를 재사용할 수 있는지(플레이어 전용 가정이 있는지), 생성 API(physics.createCharacter) (3) 액터 히트박스/탄도 판정에 쓸 수 있는 구조(rayCapsule·rayObb, MASK.BULLET, 동적 콜라이더가 raychain 에 들어가는지) (4) 내비메시 굽기에 쓸 정적 기하 접근(BVH 삼각형 열거, 표면 종류, 법선) (5) 래그돌이 resetState·determinismaudit 를 통과하려면 지켜야 할 규칙(rng/clock 사용, Math.random 금지 등) (6) PhysicsWorld 의 step 순서와 main.js 루프 결합.` },
  { key: 'world', prompt: `하위 시스템: 월드·레벨 — src/world/level.js, src/world/kit.js (+ main.js 의 buildWorld 사용부, tools/coveraudit.mjs·geometryaudit.mjs 가 월드를 보는 방식).
P4B 가 알아야 할 것: (1) 경내 전체 경계·건물 목록·담장·대문·기단·마루·계단 등 이동 가능/불가 영역을 결정하는 요소와 좌표계(단위 m, y-up) (2) 내비메시 "청크 1~2개" 분할의 자연스러운 경계 후보와 청크 경계를 넘는 연결(대문·담장 틈·계단) (3) 담 높이 — 견우 "담 넘기 가능" 플래그 간선이 생길 자리 (4) hanji_silhouette 샷의 구성: silhouette_dummy(캡슐) 위치·판(na_w_-3) 위치·실내 등롱(lantern_light_na)·카메라 — silhouetteaudit 가 재사용할 배치 (PATCH-008-B 기록 포함) (5) 창호지 판 목록(hanjiPanes) 과 판 뒤 공간 (6) 표면 종류가 메시에 붙는 방식(userData.surface, physics.addStaticMesh) (7) 플레이 구역 축소(§4-5)가 P4C 일 때 P4B 내비메시가 미리 알아야 할 것.` },
  { key: 'render', prompt: `하위 시스템: 렌더·머티리얼·팔레트·노출 — src/materials/* (index.js createSurfaceMaterials, surface-shader.js, synth.js, hanji.js, hanji-occluders.js, fx-look 등), src/render/* (exposure.js, pipeline.js, tagmask.js, output.js, grade.js), src/core/prewarm.js, tools/paletteaudit.mjs.
P4B 가 알아야 할 것: (1) 캐릭터 메시에 LACQUER·BRONZE·WOOD_COLUMN·FABRIC·DANCHEONG 머티리얼을 입히는 방법(기존 재질 재사용 vs 복제, 스킨드 메시와 셰이더 호환 — SkinnedMesh 에서 surface-shader 가 skinning chunk 를 지원하는지) (2) **창호지 실루엣이 생기는 원리**: 점광 투과·해석적 캡슐 차폐(PATCH-008-B), hanji-occluders.js 가 무엇을 등록하는지 — 캐릭터가 판에 그림자를 드리우려면 무엇을 등록해야 하는지(캡슐 몇 개까지, 유니폼 상한) (3) 팔레트 규율: 단청 5색 대역 정의, paletteaudit 판정 방식, 팀 색(이세계 청·인간계 적)이 들어갈 자리와 "대역 비겹침" 정적 검사를 어디서 할 수 있는지 (4) exposure.js 적응 파라미터(범위 evMin/evMax·무릎·속도·EC) 현재 값과 출처(CONTRACT-NOTES C4), 동결 대상 (5) 프로그램 수 예산(110, 현재 44)과 프리웜 — 새 머티리얼/스키닝 변형이 플레이 중 컴파일 0 을 깨지 않게 하는 방법 (6) 태그 마스크(자발광) 와 캐릭터.` },
  { key: 'core', prompt: `하위 시스템: 코어·하네스·결정성 — src/core/* (clock.js, rng.js, events.js, harness.js, determinism.js, stats.js, surfaces.js), src/main.js 전체(배선·루프·harness ctx), tools/determinismaudit.mjs.
P4B 가 알아야 할 것: (1) resetState() 가 복원하는 범위 전체(순서 포함)와 새 시스템(액터·래그돌·내비메시 런타임 간선)을 넣는 방법 (2) rng 스트림 구조(이름별 스트림?), clock(FIXED_DT, PHYSICS_DT, sim window), determinism.js 의 시뮬 창 난수 소비 트립와이어 (3) events.js 의 이벤트 목록(actor:damage, actor:death 등 선언만 있는 것)과 bus 사용 규약 (4) harness API 전체(setShot, stepFrames, runScript, getStats, getErrors, getDeterminism, _internal 노출, 테스트 훅 관례 — 예: --inject-* 음성 훅이 페이지에 어떻게 전달되는지) (5) determinismaudit 가 src 에서 금지하는 패턴 (6) "시뮬레이션과 표현 분리"(§5)를 지금 구조에서 어디에 경계로 둘 수 있는지 — 현재 sim 과 render 가 섞인 지점 목록.` },
  { key: 'tooling', prompt: `하위 시스템: 감사 도구 패턴 — tools/lib/browser.mjs·server.mjs(렌더 잠금 /tmp/fps-render.lock)·pinned.mjs·args.mjs, tools/harnesstest.mjs(케이스 구조, 음성 테스트, 타임아웃 규칙, 비공허 규칙), tools/shotaudit.mjs, tools/pixelowner.mjs, tools/albedoaudit.mjs, tools/viewmodelaudit.mjs, tools/paletteaudit.mjs, tools/profile.mjs(BUDGETS p3, 삼각형 집계), tools/baseline.mjs·tools/shots.js(계약 샷 12개 — hanji_silhouette 가 더미를 쓰는지), tools/gates.sh, HARNESS.md(도구 표·규칙).
P4B 가 알아야 할 것: (1) silhouetteaudit 를 만들 때 따를 템플릿 — 특수 장면 구성(샷 오버라이드·오브젝트 숨김·조명 설정)·오프스크린 렌더·마스크 추출·휘도/대비 측정을 하는 기존 코드 경로와 함수 (2) 음성 입력(--test-clone A=B 같은) 관례와 harnesstest 케이스 추가 방법(번호 22 비어 있음), 케이스 타임아웃 규칙(실측×2.5) (3) gates.sh 에 새 게이트를 넣는 방법·주석 위치 (4) 캐릭터가 계약 샷에 들어가면 바뀌는 것(baseline 픽셀, profile tris/drawCalls/programs 예산 PATCH-010-C: 캐릭터당 ≤25k, tris_scene ≤600k, tris_frame_p95 ≤250k) (5) 팀 색 정적 검사를 둘 만한 기존 정적 감사(surfaceaudit·fxaudit 팔레트 규율) (6) 대비 측정 해상도 규칙(CONTRACT-NOTES 1632·1730 근처 '2.5 m 판독 불가' 정의). **경제 규칙: 필요한 파일·구간만 읽어라(전체 파일 통독 금지, grep 으로 위치를 찾고 해당 줄 범위만). 결과는 핵심만, 항목당 1~2문장.**` },
  { key: 'contracts', prompt: `하위 시스템: 계약·기록 — docs/contracts/briefs/P4-BRIEF.md 전체(특히 §0·§1·§3·§4-1·§4-9·§5·§7, §−1-A 이월 배정표), docs/CONTRACT-NOTES.md(006-D ≈1019·1166, PATCH-008-B, 2.5 m 판독 불가 정의 ≈1632·1730·1993, P4 착수 스캔·판정 표 ≈2070~2125), HARNESS.md(PATCH-010-C 예산 ≈294, 규칙), ARCHITECTURE.md(src/ai·physics 계획, 결합 관심사), docs/contracts/patches/ 에서 PATCH-010-B·010-C·008-B·015-E 원문, docs/P3-DEBT.md·docs/CARRYOVER-AUDIT.md·docs/contracts/briefs/W1-RECEIVING.md 중 P4B 에 배정된 항목.
출력: P4B 요구사항 전수 목록(원문 인용 + 출처), 각 요구의 측정 가능한 판정 기준, 문서 간 모순·모호(예: §3-4 "physics 의 PBD 래그돌을 사용한다" vs 코드 부재), v1 8종(§3-1-B)·스킬(§4-1)이 P4B 데이터 형식에 요구하는 필드(무기 개체·스킬 조합·이동 능력·선언된 동일쌍 예외·정보 은닉 표시), 발주자 결정이 아직 필요한 항목. P4-BRIEF 72행 근처 '더미가 액터로 바뀐다' 문맥과 §3-2 '조명 구성을 고쳐라' 의 근거 패치 원문을 꼭 인용하라. **경제 규칙: 필요한 파일·구간만 읽어라(전체 파일 통독 금지, grep 으로 위치를 찾고 해당 줄 범위만). 결과는 핵심만, 항목당 1~2문장.**` },
]

phase('Map')
const maps = await parallel(READERS.map(r => () =>
  agent(`${RULES}\n${r.prompt}\n\n구조화 지도를 반환하라.`, { label: `map:${r.key}`, phase: 'Map', schema: MAP_SCHEMA })
    .then(m => m ? { key: r.key, ...m } : null)))
const got = maps.filter(Boolean)
log(`지도 ${got.length}/${READERS.length}`)

return { maps: got }
