# P4B 설계서 (개정 2): 액터 4종 · 청크 내비메시 · PBD 래그돌 · silhouetteaudit · 케이스 22 · 노출 동결

> **상태**: 개정 2 + 부록 R2(2차 독립 재검토 13건 — 단계별 반영 시점 표, 조건부 승인). 발주자 결정 대기 항목은 §11, 착수 전 스캔 요약은 `docs/CONTRACT-NOTES.md` 「P4B 착수 전 스캔」.

- **기준**: `r4-wip`(ecf8815). 입력: 하위 시스템 지도 6종, 설계안 3종(A 충실도·B 확장성·C 견고성), 심사 결과, 개정 1 검토 23건, 개정 1 재검토 17건(치명 1·중대 5·경미 11).
- **원칙**: 구성요소마다 심사 승자를 기본으로 하고 다른 안의 장점을 이식했다. 심사 치명 결함 5건(§0 끝), 검토 23건, 재검토 17건을 모두 반영했다. 재검토 지적은 코드·계약 원문으로 확인했고 완전 반박은 없다(부록 R).
- **임계 원칙(014-C)**: 게이트 임계를 발명하지 않는다. 숫자는 계약값 / 기존 계약값 재사용 후보 / 물리량 유도 정의 / 하네스 규칙(비공허 ≥ 1, 실측 × 2.5) / 구현 파라미터(게이트 아님) 중 하나다(§8-13). 최종값은 캡처를 본 발주자가 정한다.
- **검사 원칙(016-A·016-B)**: 리그 검사는 대상의 상태가 아니라 변화에 건다. 눈으로 합격시키는 게이트 앞에서 절차를 쪼갠다. "모든 X가 Y"에는 X ≥ 1을 함께 요구한다.
- **사본**: `/tmp/claude-0/-home-user-fps/3c1b06d0-bb19-5041-8521-d899c35118dc/scratchpad/rr2/rev2c.md`(이 문서 전문).
- **표기**: "추정" = 계산·코드 판독, "미측정" = 실측 전. 근거는 `파일:줄`. 재검토 지적은 "재검토 #n", 개정 1 검토는 "검토 #n".

---

## 0. 요약 — 결정 10가지

1. **형상 원천은 하나, 외견은 시각 리그 단위.** 형상 원시(둥근원뿔 `rc`, 타원체 `el`, 뼈에 강체 부착, 액터당 ≤ 24)에서만 메시·창호지 차폐·히트박스·래그돌 충돌체를 만든다. 메시는 같은 원시를 강체 스키닝(뼈 1개, 가중치 1)으로 테셀레이션하므로 어떤 자세에서도 원시 합집합과 같다(새그 ≤ 3 mm). 외견 상태는 **시각 리그**(골격 비례·자세, 형상, 포즈 스타일, 룩, 감사 자세)와 팀 표시를 통째로 바꾼다. 충돌 캡슐·이동 수치·발소리·래그돌 총질량은 진짜 값이다. "외견 A인 B"의 월드 원시는 같은 포즈의 A 원시와 비트 동일하다.
2. **창호지 차폐 v2.** 소스 풀 8 × 원시 24를 RGBA32F 텍스처로 넘긴다. 액터 안은 원시 min 합집합 뒤 smoothstep 1회. 판별 마스크, 경계구 조기 탈출(셰이더 정의의 일부, §4-4), 초과 throw. 풀은 액터 슬롯과 분리되고 예약 슬롯이 없으며, 순서는 내용만의 함수라 정체와 무관하다. 매 프레임 재구성. 점광 `castShadow=false`·프로그램 수 불변.
3. **조명.** 현행 L0로 먼저 실측·보고하고 멈춘다. 추천 후보 B: 판 뒤 9.2 m, 높이 2.0 m, 이 등롱만 강도 ×1.96. 결정 뒤 단계 12a에서만 계약 샷에 넣는다. 액터 2.5 m·카메라는 고정이고, 감사가 **액터 실제 루트**로 거리를 단언한다. 이 등롱은 24 m 컷오프라 다른 계약 샷에 닿지 않는다(§4-7).
4. **내비.** 0.25 m 다층 스팬 격자, 48 m 청크(경내 4개). 클리어런스는 컨트롤러가 걷는 **들어 올린 캡슐**로 대표점에서 정확히 재고 내림 양자화한다. 간선은 `sweepCapsule`, Δy 간선은 실제 이동 코드를 주입한 오라클을 **이동 클래스별로** 돌려 비트로 저장한다(굽기 1회). 바닥에서 닿을 수 없는 스팬(지붕)은 기하 상계로 가지친 뒤 오라클을 돈다. 청크 간 연결은 `portals`에만. 부팅 throw는 정수 구조 지문·파라미터 해시(`NAV_CONFIG` + 매니페스트 클래스)만이고, Float32 기하 해시는 보고한다. 신선도는 `navcheck` 줄. 블로커는 노드·간선·링크 선분을 막는다.
5. **래그돌.** physics 소유 PBD. 입자 16, 막대·버팀대·거리 한계·경첩 반공간, 뼈 캡슐–삼각형 접촉 축약, 입자 CCD, "중심은 어떤 삼각형도 건너지 않는다" 클램프, 활성화 시 부모→자식 초기 클램프, 슬립 상한, Float64 최종 자세 해시. `RigidBody` 미사용.
6. **액터 런타임.** 슬롯 6(3:3) SoA, 슬롯마다 `CharacterController`. 분리는 분리 전용 수평 슬라이드(리프트·스냅 없음, `_slide`가 바꾸는 접촉 상태·속도는 스냅샷·복원). 감사 배치는 `auditStatic` 슬롯 모드(컨트롤러·이동·분리·물리 후처리·포즈 시간 진행에서 제외). 서브시스템 간 직접 import 없이 주입만. 시뮬의 three 무의존은 import **전이 폐포**로 검사한다. 표현은 `VIEW_BRAND` 공개 뷰만 받는다.
7. **silhouetteaudit.** HDR `sceneRT`에서 `o = (B−A)/(B−Z)`, `S = {o ≥ 0.5}`. 대비는 표시 PNG에서 마스크와 독립. 리그 검사는 변화에 건다(`B−Z > 0`, `Σ(B−A) > 0`). 누설 검사 영역 = 경계구 조기 탈출 술어 ∪ 원시 단위 보수 술어(모든 원시에서 smoothstep = 1), 판독 프레임 지터의 화소 네 모서리 기준. 비공허는 `영역 ∩ 유효 화소 ≥ 1`이고 L0에서도 성립한다(계산, §8-3). 창살은 방향별로 메운다. ρ 0.15는 재사용 후보, 2축은 계약값.
8. **케이스 22.** `--test-clone A=B`가 B의 시각 리그 전체를 A로 바꿔(부팅 메시 재사용) 판 rect HDR이 바이트 동일해지므로 exit 1·표식·0축이 구성으로 보장된다. 브라우저 단계 실패는 모두 모은 뒤 exit를 정하므로 쌍 기록이 가려지지 않는다. 선언 예외 쌍은 바이트 동일일 때만 면제.
9. **노출.** 착수 즉시 현재값으로 구조 동결(deepFreeze, 셰이더 상수 템플릿). 일치 검사는 **그리기 시점 값**(미터 드로우 유니폼, 블룸·출력 드로우의 `ec`)과 컴파일 셰이더 문자열을 계약과 대조한다. 음성은 계약→유니폼 쓰기를 감싸 그리기 값을 바꾼다. 측정 잠금은 lock/unlock, 후보는 testOverride 층. 값은 `exposureprobe` 근거로 P4B 종료 전 발주자가 확정.
10. **파급과 시간.** 부팅 활성 액터 0. 액터 프리웜은 기존 풀해상도 웜 렌더에 얹는다(렌더 호출 증가 0). 계약 샷 변경은 `hanji_silhouette` 한 장뿐이다(④a 샷 3 교체, ④b 조명). 비트 동일 체크포인트는 ①②③③b(도구·시간 §10-9). 새 게이트 줄은 `silhouetteaudit`·`paletteauditactors`·`navcheck`. silhouette CI는 처음부터 잡 3개, harnesstest는 음성 playtest를 해당 절만 돌리고 시간 조각을 둔다.

**심사 치명 결함 처분**

| # | 결함 | 처분 |
|---|---|---|
| A-1 | 표시 선형 `D=1−L_c/L_R ≥ 0.5` 추출은 대비 검사를 공허하게 하고 마스크를 잃는다 | HDR `sceneRT` 정규화 `o`(B안), 대비는 표시 PNG에서 독립 측정(§8-3, §8-7) |
| A-2 | 내비가 얇은 벽·창호지를 관통, EDT 양자화가 좁은 문 오판 | C안 내비: 대표점 정확 클리어런스, sweep 간선, 오라클(§5) |
| A-3 | 자라 반지름 0.40은 내아 동문 0.7425 m를 못 지난다 | `radius ≤ 0.34`(플레이어 반경 재사용, `player.js:30-32`) |
| C-1 | 추출·대비 정의에 A-1과 같은 결함 | C안 추출 미채택 |
| C-2 | 후보 D의 "강도 보상 없이 Weber 무영향" 주장 | A안 강도 보상 표 채택(차폐 불가 상수항 `uHanjiAmbient`, `index.js:398`) |

그 밖: 상태당 프레임을 계약 `FIXED_STEP_FRAMES` 90으로, A안 "섹터 거리 2"는 돌출부 정의 변경으로 제거, C안 캡슐당 1024 tris는 새그 기반 분할로, C안 팀 대역 0 여유는 여유 있는 후보로, `HANJI_OCC_MAX` 48은 풀 8 × 24로 바꿨다.

---

## 1. 모듈 배치

### 1-1. 의존 규칙

- **디렉터리 간 import 금지, 주입으로 대신한다**(ARCHITECTURE.md:34, :155). 선례 `src/audio/index.js:4`(판정 1-5).
- **허용 집합은 파일 묶음 단위다.** `src/actors`는 한 최상위 디렉터리 안에 시뮬과 표현이 함께 있어, 최상위 단위 규칙으로는 `sim → present` 간선을 못 잡는다(재검토 #6).

| 묶음 | 파일 | 층 | 직접 import 허용 |
|---|---|---|---|
| actors-data | `src/actors/data/**` | 시뮬(데이터) | {actors-data, `src/core`} |
| actors-sim | `src/actors/sim/**` | 시뮬 | {actors-data, actors-sim, `src/core`} |
| ai | `src/ai/**` | 시뮬 | {ai, `src/core`}, 액터·내비 기능은 주입 |
| physics-sim | `src/physics/ragdoll.js`, `character.js` | 시뮬 | {`physics/math.js`, `physics/surface-registry.js`, `src/core`}. `StaticWorld`는 인스턴스 주입. `bvh.js:24`·`index.js:8`·`rigidbody.js:16`은 메시 적재 때문에 three를 import하므로 시뮬 파일이 import하지 않는다 |
| actors-present | `src/actors/present/**` | 표현 | {actors-present, actors-sim 순수 함수(`pose.js`·`rig.js`, 읽기 전용), actors-data, `src/core`, `three`}. 차폐 브로커·재질은 주입 |
| materials | `src/materials/**` | 표현 | 기존 규칙. **actors를 import하지 않는다** |

- 용량 상수(`HJ_SLOT_MAX`, `HJ_PRIM_MAX`)와 시뮬 상한(`ACTOR_SLOTS`, `NON_ACTOR_OCCLUDERS_MAX`, `PRIMS_PER_ACTOR_MAX`)은 각자 두고, `main.js` 부팅 단언과 테스트가 `시뮬 상한 ≤ 렌더 용량`을 검사한다.

| 소비자 | 필요한 것 | 주입 경로 |
|---|---|---|
| `ai/nav/probe.js`(오라클) | `stepMovement`, 컨트롤러 생성 | `bake(staticWorld, {stepMovement, createController, mask})`(navbake·테스트가 넘김). 런타임 navmesh/path는 이동 코드를 안 쓴다 |
| `ai/nav/bake.js`, `navmesh.js` | `StaticWorld` 질의, mask, 에이전트 | 인자(`physics.static`, mask, `agentOf` 결과) |
| `actors/sim/separation.js` | 분리 이동 | 컨트롤러 `slideHorizontal`. 수직 캡슐 거리는 자체 닫힌 식 |
| `actors/sim/actor-sim.js`, `movement.js` | 컨트롤러, 중력, 래그돌 | 생성자 `{physics}` 파사드 |
| `ai/perception.js` | 차폐 가시도, 시선 | `createPerception({actorVis, lineOfSight})`(main.js가 `occlusion-math.actorVis`·raycast 래퍼를 넘김) |
| `ai/death.js` | 액터 시드, 래그돌 | `installDeathWiring({bus, actors, ragdoll})` |
| `actors/present/actor-view.js` | 차폐 브로커, 액터 재질 | 생성자 `{occlusion, materials}` |
| `materials/team-bands.js` | 로스터 | `checkTeamColors(roster, recipes, bands)` |
| `actors/data/index.js` | 재질 키, 무기 계열 | `ctx`(main.js·테스트) |

- **검사**(determinismaudit 검사 3, `test/sim-purity.test.mjs`, 공용 `tools/lib/import-graph.mjs`):
  1. 직접 간선: 시뮬 묶음 파일의 정적 `import`·`export … from`·리터럴 `import()`가 자기 묶음 허용 집합 안인지.
  2. **전이 폐포**: 시뮬 파일 전부를 진입점으로 import 폐포를 계산해 `three`, `src/actors/present`, `src/render`, `src/materials`, `src/fx`, `src/audio`, `src/world`, `src/weapons`가 없어야 한다. 위반 시 진입 파일부터 금지 대상까지 경로 전체를 출력한다.
  3. 시뮬 파일 안 `clock.wallNowMs` 금지.
  4. 비공허: 진입 파일 ≥ 1, 간선 ≥ 1.
- P4B는 디렉터리 간 간선을 새로 만들지 않는다. 기존 간선(`fx → materials/fx-look.js`, `world → materials/hanji.js`)은 계약 미기록 선례라 보고만 한다. 예외는 결정 14 허용 간선 표로 승인.
- 도구 공용 순수 분석은 `tools/lib/*.mjs`(번들 밖). 도구는 디렉터리 규칙 대상이 아니라 주입자다.

### 1-2. 파일 표

| 경로 | 책임 | 공개 API | 층 |
|---|---|---|---|
| `src/actors/data/limits.js` | 상한 단일 출처 | `ACTOR_SLOTS=6`, `NON_ACTOR_OCCLUDERS_MAX=2`, `PRIMS_PER_ACTOR_MAX=24`, `BONES_MAX=24`, `TRIS_PER_CHARACTER_MAX=25000`(PATCH-010-C), `RAGDOLL_PARTICLES=16`, `STEP_HEIGHT=0.42`, `AGENT_RADIUS_MAX=0.34`, `ABILITY_NAMES`, `SKILL_PRIMITIVES`(6종) | 시뮬(데이터) |
| `src/actors/data/schema.js` | 검증·정규화(위반 → problems[], 레지스트리가 throw) | `SCHEMA_VERSION=1`, `validateCharacter(def, ctx)`, `estimateTris(def, skel)` | 시뮬 |
| `src/actors/data/skeletons/biped.js` | 공용 이족 골격·비례 키·래그돌 템플릿 | `BIPED`(deep frozen), `buildRest(proportions, posture)` | 시뮬(데이터) |
| `src/actors/data/characters/{jara,dokkaebi,tokki,kongjwi}.js` | v0 4종(순수 데이터) | `export default Object.freeze({...})` | 데이터 |
| `src/actors/data/roster.js` | 로스터 순서(= 캐릭터 인덱스), import 줄과 배열만(린트) | `ROSTER_DEFS` | 데이터 |
| `src/actors/data/index.js` | 레지스트리(import 시 전수 검증), 외견 해석 | `getRoster(ctx)`, `resolveAppearance(roster, charId, state) → {rigId, team}`, `visualRigOf(roster, rigId) → {skeleton, shape, pose, look, auditPose, ragdoll}`, `agentOf(def, classes)` | 시뮬 |
| `src/actors/sim/pose.js` | 절차 자세(보행·조준·웅크림·재장전·ADS·dangle), 래그돌 입자 → 뼈. 시간원은 dt뿐 | `evalPose(...)`, `framesFromParticles(...)` | 시뮬(순수) |
| `src/actors/sim/rig.js` | 뼈 → 월드 원시·경계구 | `PRIM_STRIDE=16`, `primsToWorld`, `boundSphere` | 시뮬(순수) |
| `src/actors/sim/hitbox.js` | 광선 대 rc·el 해석 교차, 액터별 구간 합집합 | `rayActor(...)` | 시뮬 |
| `src/actors/sim/occlusion-math.js` | HANJI 차폐 셰이더 JS 미러(같은 연산·같은 조기 탈출 정의) | `primDist`, `softOf`, `earlyOut`, `primSafe`(모든 원시 `d − rad ≥ soft(s)/2`), `actorVis`, `hardShadow` | 시뮬(순수) |
| `src/actors/sim/movement.js` | 데이터 수치로 이동 상태머신, 주입된 `ctrl.move` 호출(Player와 같은 적분 순서) | `stepMovement(def, input, ctrl, st, dt, gravity)` | 시뮬(순수, import 0) |
| `src/actors/sim/separation.js` | 액터끼리 수평 분리, 플레이어는 고정 장애물 | `separate(slots, ctrls, playerCapsule)` | 시뮬 |
| `src/actors/sim/controllers/*` | `idle`·`script`·`navfollow`(`remote`는 P5 자리) | `CONTROLLERS[type].create(params)` | 시뮬 |
| `src/actors/sim/fields.js` | 필드 가시성 표, 정체 무관 차폐 정렬 키 | `ACTOR_FIELDS`, `VIEW_BRAND`, `HIT_SHAPE_RULE`, `occluderKey` | 시뮬 |
| `src/actors/sim/actor-sim.js` | 슬롯 SoA·스폰·갱신·사망 발행·히트·공개 뷰·해시·리셋·감사 배치 | §7-1 | 시뮬 |
| `src/actors/present/meshgen.js` | 원시 → 스킨 메시 배열(three 무의존, 노드 공용) | `generateMesh(...)`, `posedWorldPositions(mesh, bones)` | 표현(순수) |
| `src/actors/present/meshbuild.js` | BufferGeometry·SkinnedMesh 조립(부팅 전용) | `buildGeometry`, `makeActorMesh` | 표현 |
| `src/actors/present/actor-view.js` | 풀(슬롯 6 × 캐릭터 N), 슬롯별 Skeleton, 부팅 `computeBoneTexture`, 매 프레임 뼈·경계구·씬 add/remove, 차폐 소스, 웜 렌더 프리웜 | `new ActorView({scene, roster, materials, occlusion, pipeline})`, `sync(view)`, `prewarmAttach()`/`prewarmDetach()`, `reset()`, `occluderSource` | 표현 |
| `src/actors/present/audit-rig.js` | silhouetteaudit 페이지 훅 | `installSilhouetteAuditRig(ctx)`(§8-1) | 표현(감사) |
| `src/materials/actor-look.js` | 룩 레시피(`'uv'`, 팀 변형). `createSurfaceMaterials` 안에서 같은 합성기로 생성 | `ACTOR_RECIPES`, `createActorMaterials({synth, shared})` | 표현 |
| `src/materials/team-bands.js` | 팀 대역·정적 팀 색 검사(`paletteInBand` import) | `TEAM_BANDS`, `checkTeamColors(...)` | 표현(색 계약) |
| `src/materials/hanji-occluders.js`(v2) | `HanjiOcclusion` 브로커 | §4-5 | 표현 |
| `src/materials/index.js`(개정) | `hjPrim`·액터 합집합 `hjOcclusion`·0색 광원 건너뛰기, 상한 템플릿 주입. `createSurfaceMaterials` 반환에 `actor` 추가 | `applyHanjiTransmit(...)` 시그니처 불변 | 표현 |
| `src/physics/ragdoll.js` | PBD 래그돌 | §6-1 | 시뮬 |
| `src/physics/index.js`(확장) | `ragdoll` 소유, `step = rigid → ragdoll`, `gravity` 공개 | `physics.ragdoll`, `initRagdoll(opts)` | 시뮬 |
| `src/physics/character.js`(소변경) | 치수 재설정, 분리 전용 수평 슬라이드(§7-3) | `configure({...})`, `slideHorizontal(dx, dz)` | 시뮬 |
| `src/physics/bvh.js`(소변경) | 정적 기하 지문 | `structureFingerprint()`(정수·문자열), `contentHash()`(Float32, 보고) | 시뮬 |
| `src/ai/death.js` | `actor:death` 구독(markBoot 전) → 래그돌 | `installDeathWiring(...)` | 시뮬 |
| `src/ai/perception.js` | 봇 지각(공개 뷰만, P5 전제) | `createPerception(...)` | 시뮬 |
| `src/ai/nav/*` | 청크 내비(§5) | §5 | 시뮬(굽기는 오프라인) |
| `src/ai/nav/assets/manifest.js` + `gwana/*.navbin` | 굽기 산출물(생성물), `new URL` 리터럴 | `NAV_ASSETS` | 데이터 |
| `src/render/exposure-contract.js` | 노출 계약 단일 출처 | `EXPOSURE_CONTRACT`, `exposureContractHash()` | 표현 상수 |
| `src/render/exposure.js`·`pipeline.js`(개정) | frozen 뷰·템플릿 상수·lock/unlock·그리기 시점 기록·testOverride·일치 검사 | §9 | 표현 |
| `tools/silhouetteaudit.mjs` | 핵심 게이트 | §8-12 | 도구 |
| `tools/lib/silhouette-metrics.mjs` | 4축·대비·쌍 판정·좌표 변환·창살 채움·누설 영역(순수), 규칙 상수 단일 위치 | `axesOf`, `checkPairs`, `contrastOf`, `fillLattice`, `leakRegion`, `SILHOUETTE_RULE` | 도구 |
| `tools/lib/import-graph.mjs` | import 파서·전이 폐포(§1-1) | `importEdges`, `closure`, `checkSimPurity` | 도구 |
| `tools/silhouettepredict.mjs` | 노드 해석 예측(조명 후보, v1 28쌍, 무기 제외, 누설 영역), 비게이트 | `--lighting L0\|B\|C\|D --fixtures v1 --no-weapon` | 진단 |
| `tools/navbake.mjs` | 오프라인 굽기·매니페스트·리포트, `--check` = `navcheck` | | 도구 |
| `tools/exposureprobe.mjs` | 노출 근거 E1–E4, 비게이트, testOverride 표식 | | 진단 |

---

## 2. 캐릭터 데이터 형식

### 2-1. 원칙

- 캐릭터 하나 = 순수 데이터 모듈 하나(`src/actors/data/characters/<id>.js`, `export default Object.freeze({...})`). `.js`라 고정 스냅샷·vite·`node --test` 어디서든 동기 import 된다. 함수·계산식 금지: `actor-data` 테스트가 `deepEqual(JSON.parse(JSON.stringify(def)), def)`, roster 린트.
- **코드는 캐릭터를 모른다**: `src/**`(data·nav assets 제외)에 로스터 id 리터럴이 있으면 테스트 실패("캐릭터 ID 분기 0", P4-BRIEF:336-337).
- `validateCharacter(def, ctx)` → `problems[]`, `getRoster()`는 비어 있지 않으면 throw(PATCH-001-D). `ctx = {surfaces, materialKeys, skeletons, abilityNames, skillPrimitives, weaponFamilies}`. 시뮬은 materials·weapons를 import하지 않으므로 `materialKeys`·`weaponFamilies`는 main.js·테스트가 주입한다.

### 2-2. 필드 표

| 필드 | 형식 | 검증 | 소비자 |
|---|---|---|---|
| `schema`, `id` | `1`, `[a-z][a-z0-9_]*` 유일 | 일치·형식·유일 | 레지스트리, 감사 키 `'<id>:<state>'`, 메시명 `actor_s<slot>_<id>` |
| `faction` | `'isegye' \| 'ingan'` | 열거 | 팀 대역, `{team}` 치환 |
| `displayName` | `{ko}` | 문자열 | UI(P4C) |
| `skeleton` | `{template:'biped', proportions, posture:{spinePitchDeg, neckPitchDeg, shoulderWidth, hipWidth}}` | 템플릿 존재, 비례 키 완전·양수 | pose, ragdoll(시각 리그) |
| `shape.primitives[]` | §2-3 | ≤ 24, id 유일 | meshgen·차폐·히트·래그돌(시각 리그) |
| `look.slots` | `{slot: {material: 'ACTOR_*'('{team}' 허용), tileMeters}}` | 키 ∈ `materialKeys`, slot 완전 | meshgen·actor-look(시각 리그) |
| `body.capsule` | `{radius, height, crouchHeight, stepHeight}` | `radius ≤ 0.34`, `height, crouchHeight ≥ 2r + 0.05`(`character.js:119-130`), `stepHeight == 0.42` | 컨트롤러·내비 클래스(진짜) |
| `body.massKg`, `body.health` | 수 | 양수 | 래그돌 총질량, P4C(진짜) |
| `movement` | `{walk, sprint, crouch, jumpSpeed, abilities[], provisional}` | 양수, abilities ⊆ `ABILITY_NAMES` | movement·내비(진짜) |
| `weapon` | `{family}` 또는 `{familyChoices[]}`, `instance{...}` | family ∈ {SHOTGUN, CARBINE, DMR}(`params.js:16-41`) | P4C |
| `skills[]` | `{primitive, params, maxActive:1, cooldownS, durationS}` | primitive ∈ 닫힌 6종, 값 null 허용 | P4C |
| `appearance.states` | `{default:{rigOf:'self', lookOf:'self', team:'self'}, <name>:{rigOf, lookOf, team:'self'\|'opponent'}}` | default 필수, 참조 유효, 순환 없음, `rigOf` 대상과 템플릿 동일, **`lookOf === rigOf`**(풀 메시는 캐릭터당 그 look slot 그룹으로 1개, §3-8), **해석된 외견 팀 = `rigOf` 대상 진영**(풀 재질 `{team}`은 부팅 고정) | 표현·차폐·래그돌 배치·(규칙에 따라) 히트 |
| `silhouette` | `{audit, auditPose, identicalTo:[{state, character, characterState, reason}]}` | 참조 유효, 대칭 해석. `auditPose`는 시각 리그 항목(외견 상태에서는 `rigOf` 대상 값). `identicalTo` 쌍의 해석된 `rigOf`가 같아야 함 | silhouetteaudit |
| `audio.footstep` | 프로파일 키 | 존재(`ctx.footstepProfiles` 주입 시. 주입이 없으면 검증은 `skipped`에 이름·사유를 남기고, **부팅 배선(main.js)은 주입 누락이면 throw**) | 오디오(외견 무관, §4-1-C) |
| `ragdoll` | `{template:'biped', massScale, limits?}` | 키 유효 | ragdoll(시각 리그와 함께 컴파일, 템플릿은 질량 **분율**만) |
| `pose` | `{style:{strideM, armSwing, bob, idleBreath}, aim:{propBone, twoHand}, dangle:[{chain, stiffness, damping}]}` | 체인 뼈 유효 | pose(시각 리그) |

**외견 상태의 닫힌 규칙**
- 외견 상태는 시각 리그 `{skeleton, shape, pose, ragdoll.massScale·limits, look, silhouette.auditPose}`와 팀 표시를 통째로 다른 캐릭터(또는 self)의 것으로 바꾼다. 원시는 뼈 로컬이라 형상만 바꾸면 A의 윤곽이 나오지 않는다(검토 #1). 룩·감사 자세가 시각 리그에 있으므로 `lookOf`는 `rigOf`와 같은 값만 허용하고, 공개 뷰 외견 식별자는 `apparentRigId` 하나다.
- 진짜 값(닫힌 목록): `body.capsule`, `movement`, `audio.footstep`, `body.massKg`, `body.health`, `weapon`, `skills`.
- 래그돌 입자 배치·구속은 외견 리그에서 컴파일한다. 템플릿은 질량 분율(합 1)만 담고 `activate(slot, key, massKg, …)`가 진짜 `massKg`로 슬롯 `invMass`를 채운다(할당 0, §6-1).
- 히트 형상 출처는 전역 `HIT_SHAPE_RULE`(§7-5, 결정 15) 하나다.
- **보장**: 같은 `poseParams`·위치·yaw에서 "외견 A인 B"의 월드 원시 = A 원시(비트 동일, `actor-sim`·v1 흥부 테스트). 감사 자세도 시각 리그에서 오므로 선언쌍은 자세까지 같다.

### 2-3. 원시 형식

- 공통: `{id, bone, kind, slot, surface, zone, occluder=true, hitbox=true, seg?, bands?[]}`. `zone ∈ {head, torso, limb, shell, cloth, prop}`. `surface ∈ SURFACES`, DECAL 등급(LACQUER·DANCHEONG) 금지, v0 hitbox 원시는 모두 `FABRIC`(결정 9). `bands[] = {slot, v0, v1, mode: 'stripe'|'meoricho'|'geummun'}`(호 길이 비율 구간을 다른 재질 그룹으로, §3-3).
- `rc`: `a, b, ra, rb`(뼈 로컬 m, `|ra − rb| < |b − a|`). 집합: 선분 위 최근접 t에 대해 `|x − C(t)| ≤ r(t)`(반구–원뿔대–반구). 셰이더·히트·메시가 같은 집합.
- `el`: `c, r[3], rotDeg[3]`(뼈 로컬).
- 무기 원시: `zone:'prop'`, `hitbox:false`, `occluder:true`.

### 2-4. biped 골격 템플릿

- 뼈 24: root, pelvis, spine, chest, neck, head, shoulder/elbow/wrist/hip/knee/ankle × L/R, prop, acc_head, acc_back, acc_waist, 예약 2(dangle). 휴지 위치는 `buildRest(proportions, posture)`. 비례 키 `hip, spine, chest, neck, upperArm, foreArm, thigh, shin` + `shoulderWidth`, `hipWidth`.
- 래그돌: 입자 16(pelvis, chest, neck, headTop, L/R × {shoulder, elbow, wrist, hip, knee, ankle}), 막대 15, 버팀대 6, 거리 한계(무릎·팔꿈치·척추·목), 경첩 반공간(무릎·팔꿈치), 프레임 복원표(입자 13 + 강체 자식 11). 골격 트리 순서(pelvis 뿌리)를 데이터 순서로 고정한다(§6-4).
- `prop`, `acc_*`, `spine`은 부모 프레임에 강체 부착, 예약 뼈는 dangle이 쓴다.

### 2-5. 검증 규칙(요지)

1. 원시 ≤ 24, 추정 tris ≤ 25,000(무기 포함, 결정 13), `estimateTris = index.count/3` 테스트.
2. `radius ≤ 0.34`(플레이어 반경 재사용). 내아 동문 0.7425 m 때문에 0.40은 불가. 반지름 차는 내비 클래스가 다룬다(§5-5, 결정 8).
3. `height ≥ 2r + 0.05`, `stepHeight == 0.42`.
4. surface ∈ SURFACES, DECAL 금지, look slot 완전.
5. abilities ⊆ `{walk, jump, drop, crouch, vault}`(+ 예약 climb, swim), skills ∈ 닫힌 6종.
6. appearance 참조·순환·팀. `rigOf` 대상 템플릿 동일(슬롯 Skeleton 공유, §3-4), `lookOf === rigOf`, 외견 팀 = `rigOf` 대상 진영, `identicalTo` 상대 정체 존재·쌍 `rigOf` 일치.
7. 실루엣 대역 경고(보고): 원시 최고점이 무대 가시 대역 밖이면 경고(판정 아님).
8. 시각 돌출 보고: 원시 수평 반경이 `radius`를 넘는 양을 캐릭터별·`rigOf` 쌍별로 보고(R11·R21).

### 2-6. v0 4종 정의 초안

수치는 형식 예시이자 설계 의도이고 확정 디자인이 아니다(`silhouettepredict`로 조정). 높이는 바닥 기준, 추천 B의 가시 대역은 0.60–2.09 m다(§4-7).

**자라**(이세계, 산탄, `spawnSurface`). 낮고 넓고 머리가 앞으로 나온 윤곽. A안에서 반지름 0.40 → 0.34, 무기 금속 → `ACTOR_METAL`(무채)로 고쳤다.

```js
export default Object.freeze({
  schema: 1, id: 'jara', faction: 'isegye', displayName: { ko: '자라' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.55, spine: 0.12, chest: 0.18, neck: 0.12, upperArm: 0.24, foreArm: 0.22, thigh: 0.26, shin: 0.24 },
    posture: { spinePitchDeg: 18, neckPitchDeg: -24, shoulderWidth: 0.36, hipWidth: 0.22 } },
  shape: { primitives: [
    { id: 'shell',    bone: 'acc_back', kind: 'el', c: [0, 0.05, -0.14], r: [0.42, 0.40, 0.20], rotDeg: [0, 0, 0], slot: 'shell', surface: 'FABRIC', zone: 'shell',
      bands: [{ slot: 'accent', v0: 0.46, v1: 0.54, mode: 'stripe' }] },
    { id: 'plastron', bone: 'chest',  kind: 'el', c: [0, -0.06, 0.10], r: [0.28, 0.32, 0.11], rotDeg: [0, 0, 0], slot: 'shell', surface: 'FABRIC', zone: 'torso' },
    { id: 'pelvis',   bone: 'pelvis', kind: 'rc', a: [-0.11, 0, 0], b: [0.11, 0, 0], ra: 0.14, rb: 0.14, slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.40, v1: 0.60, mode: 'stripe' }] },
    { id: 'neck',     bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.08, 0.08], ra: 0.07, rb: 0.06, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',     bone: 'head',   kind: 'el', c: [0, 0.05, 0.08], r: [0.11, 0.10, 0.15], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'uarm_L', bone: 'shoulder_L', kind: 'rc', a: [0,0,0], b: [0,-0.24,0],    ra: 0.075, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb',
      bands: [{ slot: 'accent', v0: 0.80, v1: 1.0, mode: 'stripe' }] },
    { id: 'farm_L', bone: 'elbow_L',    kind: 'rc', a: [0,0,0], b: [0,-0.22,0.02], ra: 0.060, rb: 0.075, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    // uarm_R · farm_R · thigh_L/R(rc .095→.085, 0.26) · shin_L/R(rc .085→.09, 0.24) · foot_L/R(el .07/.04/.11) — 같은 패턴
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0,0,0.05], b: [0,0,0.62],     ra: 0.025, rb: 0.020, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0,-0.02,0], b: [0,-0.06,-0.25], ra: 0.040, rb: 0.035, slot: 'wood', surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    shell:  { material: 'ACTOR_BRONZE_{team}', tileMeters: 0.40 },
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },   // 직조 스케일 = tileMeters(결정 10)
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.25 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },   // 무채(§3-6)
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.34, height: 1.25, crouchHeight: 1.00, stepHeight: 0.42 }, massKg: 80, health: { max: 110, provisional: true } },
  movement: { walk: 3.4, sprint: 5.0, crouch: 1.8, jumpSpeed: 6.0, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'SHOTGUN', instance: { id: 'jara_shotgun_v0', displayName: null, handling: {} } },
  skills: [{ primitive: 'spawnSurface', params: { class: 'GRANITE', shape: 'shell_wall_v0' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'heavy_shell' },
  ragdoll: { template: 'biped', massScale: { chest: 1.6 } },
  pose: { style: { strideM: 0.45, armSwing: 0.35, bob: 0.02, idleBreath: 0.01 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
```

원시 17개, 추정 6.8k tris. 등껍질 탄도 표면은 `FABRIC`, 보이는 것은 `ACTOR_BRONZE_ISEGYE` 녹청(결정 7·9). 총열 `BRONZE`는 `hitbox:false`라 판정에 안 쓰고, 보이는 것은 `ACTOR_METAL`이다.

| 캐릭터 | 핵심 원시(뼈, 종류, 치수 m) | 최고점 / 최대폭(높이) | 캡슐 r/h/crouch | 원시 / tris |
|---|---|---|---|---|
| **도깨비**(이세계, `familyChoices:[CARBINE, DMR]`, `spawnLight`) | 가슴 el .30/.34/.20 · 배 el .26/.22/.20 · 머리 el .14/.15/.15 · **뿔 ×2** rc(acc_head) .05→.01, 길이 .22, 바깥 25° · 굵은 사지 rc .11/.09 · **방망이** rc(acc_back, 오른 어깨 너머 35°) .05→.11, 길이 .75 + 가시 rc ×3 · 총 rc ×2 | 2.05(뿔) / 0.80(1.5, 어깨) | .34/1.85/1.30 | 23 / ≈9k |
| **토끼**(인간계, CARBINE, `projectSilhouette`) | 몸통 el .17/.28/.13 · 머리 el .10/.11/.11 · **귀 ×2** rc(acc_head) .045→.035, 길이 .40, 벌림 8°, 안쪽 accent 밴드 · 가는 사지 rc .055/.075 · 긴 발 el .05/.035/.12 · 꼬리 el(acc_waist) .06 · 총 rc ×2 | 2.00(귀) / 0.40(1.35) | .30/1.62/1.10 | 19 / ≈6.5k |
| **콩쥐**(인간계, DMR, `editHoles(fill)`) | 저고리 el .16/.17/.12 + 고름 밴드 · **치마 2단** rc(pelvis) 상단 1.20→0.65 m, r .16→.30 / 하단 0.65→0.05 m, r .30→.42, 단 밴드 · 머리 el .10/.11/.11 · **쪽머리** el .07/.06/.07 · 소매 rc .07→.09 · 다리 rc · 총 rc ×2 | 1.62(쪽) / 0.60(0.65) · 0.84(바닥, 대역 밖 — 결정 20) | .34/1.60/1.15 | 18 / ≈7.5k |

모든 캐릭터의 무기 금속 slot은 `ACTOR_METAL`이다. 설계 의도(미측정): 6쌍 × 정면·측면에서 4축 중 3축 이상 다르게(게이트는 2축). 현행 L0(대역 0.68–1.875 m)에서는 뿔·귀가 상단에서 잘려 그 쌍의 높이 축이 판정 불가이므로 나머지 3축 중 2축으로 통과해야 한다. 누설 영역은 L0에서도 비지 않으므로 L0 판정 자체는 성립한다(§8-3).

### 2-7. v1 8종이 코드 추가 없이 들어오는 이유

1. 고유성이 모두 데이터 축이다: 윤곽 = 원시 조합(견우 삿갓 납작 el, 직녀 두루마리 비대칭 rc, 심청 댕기 dangle rc, 흥부 갓·지게), 무기 = 계열 + 개체, 스킬 = 닫힌 6종 + params, 이동 = 능력 비트(견우 `'vault'`), 체력·속도 = 수치.
2. 흥부 변장은 데이터 두 줄: `appearance.states.disguise = {rigOf: 'dokkaebi', lookOf: 'dokkaebi', team: 'opponent'}`, `silhouette.identicalTo = [{state: 'disguise', character: 'dokkaebi', characterState: 'default', reason: 'P4-BRIEF §4-1-C'}]`. `applyModifier`(P4C)는 `appearanceState`만 바꾼다. 시각 리그를 통째로 바꾸므로 선언쌍 HDR이 바이트 동일해지고(§8-6) P4D에 코드가 필요 없다(P4-BRIEF:337·865).
3. 정보 은닉은 필드 표(§7-8)가 정한다.
4. 지금 시험한다: `test-fixtures/characters-v1/{gyeonu, jiknyeo, simcheong, heungbu}.js`로 스키마·meshgen·삼각형·dangle·히트·내비 클래스·흥부 원시 비트 동일·실루엣 예측(28쌍 보고)을 돌린다. 제안 윤곽이고 제품 데이터가 아니다. 내비 굽기에 이 클래스를 포함한다. rc+el로 못 그리는 윤곽은 P4B 안에서 드러난다(R12).

---

## 3. 절차 메시 생성

### 3-1. 원시에서 메시로 (`present/meshgen.js`, three 무의존, 같은 입력 → 같은 바이트)

- **rc**: 기저 `u = (B−A)/L`, `e1 = normalize(cross(u, |u.y| < 0.99 ? Y : X))`, `e2 = cross(u, e1)`. 프로파일은 A 반구(φ π/2→0, `z = −ra·sinφ`, `ρ = ra·cosφ`, `nCap+1`점) · 원뿔대(`z = tL`, `ρ = ra + (rb − ra)t`, 내부 `nSide−1`점) · B 반구(`z = L + rb·sinφ`). §2-3 집합 경계와 정확히 같다. 이음 고리는 정점 중복. 법선: 반구 방사, 원뿔대 `normalize(radial + ((ra − rb)/L)·u)`.
- **el**: 위경도 구(R × Q)를 반축 스케일·회전, 법선 `normalize(MᵀM(x − c))`. 모든 정점 `|sdf| ≤ 1e-5`.

### 3-2. 분할 규칙 (구현 파라미터)

새그 `ε = 3 mm`(추천 조명에서 판 위 ≈1.5 px). `R = clamp(2·ceil(π / (2·acos(1 − ε/r_max))), 12, 32)`(r .45 → 28, r .07 → 12), `nCap = clamp(ceil(r_max/0.03), 3, 6)`, `nSide = clamp(ceil(L/0.08), 1, 8)`, el `Q = R/2 + 1`, 원시 `seg`로 국소 증가. "메시 ⊂ 원시 합집합, 합집합의 ε 침식 ⊂ 메시"를 보장하고 `actor-proxy`가 검증한다.

### 3-3. 밴드

프로파일 호 길이 비율 `v0`, `v1`에 고리를 끼워 그 구간을 밴드 slot 그룹으로 보낸다(껍질 마디·소매 끝·치맛단·고름, P4-BRIEF §3-5). 고리당 `+2R` tris.

### 3-4. 스키닝 — 강체, 뼈 로컬

- 모든 정점 `skinIndex = (bone,0,0,0)`, `skinWeight = (1,0,0,0)`. LBS 혼합이 없어 어떤 자세에서도 메시 = ∪원시(B안 2뼈 블렌드는 미채택).
- 정점은 뼈 로컬. `Skeleton(bones, boneInverses = 단위)`, 원점 SkinnedMesh를 `bind(skeleton, identity)` → `boneMatrices = bone.matrixWorld`. 같은 biped 위상의 모든 캐릭터 메시가 **슬롯당 Skeleton 1개를 공유**한다(그래서 `rigOf` 대상 템플릿 동일 검증).
- Bone은 씬 밖, `matrixAutoUpdate = matrixWorldAutoUpdate = false`. `ActorView.sync`가 공개 뷰 `bones`(외견 리그)를 `matrixWorld`에 복사한다.
- **결정성 함정**: three r180은 첫 렌더에 `computeBoneTexture`를 지연 실행해(`WebGLRenderer.js:2451`) DataTexture UUID → `Math.random` → 시뮬 창 오류가 난다. 부팅에 모든 슬롯 skeleton에서 미리 호출한다.
- **컬링**: `Frustum.js:148-152`가 `boundingSphere`를 쓰므로 매 프레임 원시 경계구를 직접 기록한다. `spawn`·`placeForAudit`도 즉시 기록한다.

### 3-5. UV — `'uv'` 모드 전용

TRI는 월드 투영이라 미끄러지고(`surface-shader.js:60-64, 166-168`), LOCAL은 `aBoxDims` 전제(`136-150`)라 둘 다 안 쓴다. `u = (방위각/2π) × round(둘레/tileMeters)`(이음매는 뼈 −z, 정점 중복), `v = 누적 호 길이/tileMeters`. 밴드: `meoricho` = DANCHEONG u 0–0.5 끝단(`synth.js:121-123`)을 밴드 높이에 대응(`u_tex = 0.5·(v − v0)/(v1 − v0)`), `geummun` = u 0.5–1 반복, `stripe` = 단색. 선례 `ROOF_TILE_UV`(`index.js:494-500`), `VM_*`(`viewmodel-look.js:56-74`).

### 3-6. 재질 슬롯과 `ACTOR_*`

- groups를 slot 첫 등장 순으로 안정 정렬, SkinnedMesh에 재질 배열(액터당 draw ≤ 6).
- **생성**: `createSurfaceMaterials` 안에서 뷰모델 선례(`index.js:505-509`: `createViewmodelMaterials({synth})` → `synth.dispose()`)처럼 같은 합성기로 만들어 반환값 `actor`로 낸다. 합성기는 그 함수의 지역 변수라 `main.js`가 부를 수 없다(재검토 #9). 모든 재질이 map + normalMap + ORM, `'uv'` 같은 구성이라 스킨 프로그램은 한 벌이다. `main.js`가 각 재질에 CSM `patchMaterial`(풀은 `patchScene` 밖, `main.js:160-162` 선례)과 albedo `extraMaterials` 등록(`main.js:315` 선례)을 한다. emissive 0(태그 마스크 8%·블룸 회피, `tagmask.js:32-37`). `albedo-manifest.json` 등록.
- **텍스처 공유**(합성 0, HSV는 계산값): `ACTOR_FABRIC` ← FABRIC(42°, s .19–.23 → 공용 황), `ACTOR_WOOD` ← WOOD_COLUMN(28–31°, s ≤ .35), `ACTOR_HIDE` ← EARTH_WALL(34°, s ≈ .30), `ACTOR_METAL` ← VM_POLYMER(`viewmodel-look.js:36`, s ≤ .054 → 무채). BRONZE 원본 녹청(176–178°, s .31–.40, `index.js:147-150`, `CHROMA_SCALE` .8 뒤에도 ≥ .10)과 VM_GUNMETAL(216°, s ≈ .145)은 §8-9 규칙 3을 어겨 쓰지 않는다(검토 #8).
- **새 팀 변형 합성**(boot_cpu 계측): `ACTOR_DANCHEONG_ISEGYE/INGAN`, `ACTOR_BRONZE_ISEGYE`(녹청 ≈200°), `ACTOR_ACCENT_ISEGYE/INGAN`.
- `userData.surface` = 면적 최대 원시의 표면, `userData.surfaces` = 그룹별 목록(surfaceaudit 대상, PATCH-010-C).

### 3-7. 삼각형 공식과 예산

rc `2R(P − 2)`(`P = 2(nCap+1) + nSide − 1`), el `2R(Q − 2)`, 밴드 고리 `+2R`. `estimateTris = Σ`를 `actor-mesh`가 `index.count/3`과 단언한다. 상한 25,000(PATCH-010-C, 무기 포함 여부는 결정 13), 목표 몸 ≤ 12k + 무기 ≤ 3k.

| 항목 | 값 | 근거 |
|---|---|---|
| 캐릭터별 | 자라 ≈6.8k · 도깨비 ≈9k · 토끼 ≈6.5k · 콩쥐 ≈7.5k(추정) | §2-6 |
| 2:2 4인 | ≈30k → `tris_scene` 135,622 → ≈166k(≤600k) | P4-LOG |
| `tris_frame_p95` | 122,610 + 최대 30k(≤250k) | `stats.js:36` |

**함정**: `getSceneTriangles`는 비가시 메시도 센다(`harness.js:447`). 그래서 **스폰할 때만 `scene.add`** 하고(DEBRIS_POOL 선례), `groupOf`에 `actor_` 그룹과 `byActor`를 둔다.

### 3-8. 풀과 프리웜

- 부팅에 캐릭터별 BufferGeometry 1개(슬롯 공유), SkinnedMesh (슬롯 6 × 캐릭터 4) = 24(v1이면 48). 메시는 그 캐릭터의 look slot 그룹과 진영 팀 재질로 고정된다(그래서 §2-2 `lookOf === rigOf`, 외견 팀 = `rigOf` 진영). 슬롯별 Skeleton(Bone 24)과 `computeBoneTexture`도 부팅에. 이름 `actor_s<slot>_<id>`, `world.group` 밖 `actors` 그룹(`harness.js:425-429`, `main.js:89`).
- **프로그램 키의 사실**: `compile`은 `traverseVisible`이다(`WebGLRenderer.js:1312, 1330`). 키에 바인딩 타깃과 `scene.environment` 유무가 들어간다(`prewarm.js:41-44`: 환경광 없는 컴파일 → 사장 10, "35 = 25 + 10"). 환경광은 `applySunConfig` → `sky.apply`가 처음 설정한다(`renderer.js:57-62`, `sky/index.js:149, 290`). `fx.prewarmSpawn`(`main.js:339`)은 스폰만 하고(`fx/index.js:109-116`) 그 시점엔 환경광이 없고 해상도 축소(`:343`) 전이다. 그래서 그 옆에서 `pipeline.render()`를 부르던 개정 1의 (b)는 사장 변형을 컴파일하고 실제 플레이 변형은 첫 스폰에 컴파일된다(재검토 #2).
- **(b) 주 경로 — 웜 렌더 편승**: `:360` `applyDefaultView()` 뒤 `:363` 풀해상도 웜 렌더 직전에 `actorView.prewarmAttach()`(풀 전부 씬에, `frustumCulled = false`, `castShadow = true`). 이 렌더 한 번으로 플레이 상태(기본 뷰 환경광, 2048 그림자)의 forward·CSM 깊이·GTAO 노멀 스킨 변형, 버퍼 업로드, 뼈 텍스처 바인딩이 끝난다. `:364` `pipeline.reset()` 전에 `prewarmDetach()`. 렌더 호출 증가 0, 정점 처리 증분은 부팅 단계 `warm_render+reset`(`main.js:376`)으로 실측.
- **(a) 보조**: 프리웜 renderFrame(`main.js:354`)을 `() => { actorView.sync(actors.viewFor(null)); pipeline.render(); }`로. 배치는 포즈·원시·경계구를 즉시 계산하므로 simSubstep 없이 유효하다. 9b 뒤 샷 3 액터가 그 샷 상태로 그려진다(기본 뷰와 키가 같으면 기여 0).
- **폴백**: (b)가 놓친 변형이 실측되면 `prewarmShaders`에 `applyShot(shots[0])` 뒤 훅(`prewarm.js:46-60`)을 두고 부팅 비용을 함께 보고한다.
- (b)만으로 기본 뷰 플레이 중 컴파일 0(단계 9a 판정). `_progcount`로 (a)(b) 기여를 따로 기록. 예상 programs 44 → ≈47(forward·CSM 깊이·GTAO 노멀 +1씩, 추정). 태그·객체 마스크 스킨 변형 +2는 캡처 뒤 표식.

### 3-9. 메시 테스트 (`test/actor-mesh.test.mjs`)

2회 바이트 동일, 정점 `|sdf| ≤ 1e-5`, 가중치 뼈 1개·1.0, UV 범위, 그룹 ↔ slot 완전, 법선 단위. `triCount = index.count/3 = estimateTris ≤ 25,000`, v0·v1 8종 수치 보고.

---

## 4. 실루엣 모델과 조명 구성

### 4-1. 현 모델의 사실

- 야간 창호지 실루엣은 메시 그림자가 아니라 HANJI 프래그먼트에서 판→점광 선분과 **등록 캡슐** 축의 최근접 거리로 계산한다(`index.js:300-332, 399-419`). 판 불투명도 1.0(`hanji.js:34`)이라 판 뒤 메시는 안 보인다.
- 상한 4가 세 곳에 하드코딩(`index.js:304, 432-433`, `hanji-occluders.js:12`), 넘치면 조용히 탈락, 반지름은 `A.w`뿐, `resetState`가 목록을 복원하지 않는다. 점광 `castShadow=false`는 계약 기록 사항(CONTRACT-NOTES:1151-1152).
- 판 휘도 = 표준 셰이딩 + `uHanjiAmbient`(0.035, 차폐 불가, `index.js:256, 398`) + 태양 투과 × CSM + 점광 투과 × V. **점광항만 V에 선형**이다(§8-3 추출의 근거).

### 4-2. 대안 비교

| 대안 | 득 | 실 | 판정 |
|---|---|---|---|
| (1) 캡슐 수·상한만 확장 | 최소 구현 | 캡슐마다 smoothstep 곱 → 관절 이중 어둡힘, 테이퍼 불가, 메시와 어긋날 원천 | 기각 |
| (2) rc + el, 액터 단위 합집합 SDF | 테이퍼·납작함, 이음 없음 | 단독으로는 메시와 어긋날 원천 | **채택(+ 메시 동일 원천)** |
| (3) 점광 큐브 그림자맵 | 메시 그대로, 가구도 가림 | 24 m 캐스터 6면 렌더(`WebGLShadowMap.js:346`), `NUM_POINT_LIGHT_SHADOWS`로 전 조명 키 변경, 귀에 ≥512² 필요, 고정 PCF로 반그림자 상실, 서버 재현 불가, P3 결정 번복 | 기각 |
| (4) 런타임 (2) + 노드 '참 그림자' 대조 | 비용 0으로 정확성 기준만 차용 | — | **채택(보고 전용)** |

### 4-3. 메시–프록시 일치 보장 (4중)

1. 원시 목록이 meshgen·차폐·히트·래그돌의 유일한 입력. 2. 강체 스키닝(§3-4). 3. 같은 서브스텝의 같은 행렬: 공개 뷰가 `bones`와 정체 무관 `occluders`(§7-8)를 같은 상태에서 복사하고, `beforeRender`의 `occlusion.update`는 뷰 공간 변환만 한다. 4. `actor-proxy` 테스트와 감사의 메시 투영·예측 대조(§8-8, 보고).

### 4-4. 셰이더 (`materials/index.js` HANJI_PARS_GLSL 개정)

상한은 `hanji-occluders.js` export에서 템플릿으로 주입한다(하드코딩 3곳 제거).

```glsl
#define HJ_SLOT_MAX ${HJ_SLOT_MAX}      // 8 = 소스 풀 용량(예약 없음, 정체 무관 순서)
#define HJ_PRIM_MAX ${HJ_PRIM_MAX}      // 24
uniform highp sampler2D uHanjiOccTex;    // RGBA32F, 폭 4 × 높이 HJ_SLOT_MAX·HJ_PRIM_MAX, NEAREST
uniform vec4 uHanjiOccBound[HJ_SLOT_MAX]; // 뷰공간 경계구 xyz, w = 반지름
uniform int  uHanjiOccN[HJ_SLOT_MAX];     // 슬롯별 원시 수(0 = 빈 슬롯)
uniform int  uHanjiOccMask;               // 판별: 이 판에 관련된 풀 슬롯 비트
// 행 = slot·HJ_PRIM_MAX + j.  rc: t0=(A, ra) t1=(B, rb) t2=(0,0,0, 0).  el: t0=(C,0) t1..t3 = M 행0..2(t2.w = 1), M = 뷰공간 → 단위구
void hjPrim(vec3 P, vec3 L, int row, out float d, out float rad, out float s) {
  vec4 t0 = texelFetch(uHanjiOccTex, ivec2(0, row), 0);
  vec4 t1 = texelFetch(uHanjiOccTex, ivec2(1, row), 0);
  vec4 t2 = texelFetch(uHanjiOccTex, ivec2(2, row), 0);
  if (t2.w < 0.5) {                                   // rc
    if (t0.w == t1.w) { float t; d = hjSegSeg2(P, L, t0.xyz, t1.xyz, s, t); rad = t0.w; }   // 옛 캡슐과 같은 연산
    else { hjRcTaperMin(P, L, t0, t1, d, s); rad = 0.0; }                                     // 정확 최소
  } else {                                            // el — 영점 집합 정확, 반그림자 폭은 1차 SDF
    vec4 t3 = texelFetch(uHanjiOccTex, ivec2(3, row), 0);
    vec3 p = P - t0.xyz, q = L - t0.xyz;
    vec3 pu = vec3(dot(t1.xyz, p), dot(t2.xyz, p), dot(t3.xyz, p));
    vec3 du = vec3(dot(t1.xyz, q), dot(t2.xyz, q), dot(t3.xyz, q)) - pu;
    s = clamp(-dot(pu, du) / max(dot(du, du), 1e-8), 0.0, 1.0);
    vec3 cu = pu + du * s; float r = length(cu);
    vec3 g = (cu.x * t1.xyz + cu.y * t2.xyz + cu.z * t3.xyz) / max(r, 1e-6);
    d = (r - 1.0) / max(length(g), 1e-6); rad = 0.0;
  }
}
float hjOcclusion(vec3 P, vec3 L) {
  float vis = 1.0; float len = length(L - P);
  for (int k = 0; k < HJ_SLOT_MAX; k++) {
    if ((uHanjiOccMask & (1 << k)) == 0) continue;
    int n = uHanjiOccN[k]; if (n == 0) continue;
    float sb; float db = hjSegPoint(P, L, uHanjiOccBound[k].xyz, sb);
    float sp = min(sb + uHanjiOccBound[k].w / max(len, 1e-4), 1.0);
    float softB = (uHanjiLightSize * sp / max(1.0 - sp, 0.05) + uHanjiPaperBlur) * uHanjiScatter;
    if (db > uHanjiOccBound[k].w + 0.5 * softB) continue;   // 경계구 조기 탈출 = 정의의 일부(JS earlyOut). rc는 전체 계산과 같고 el은 정의로 둔다
    float bestF = 1e9, bestD = 0.0, bestR = 0.0, bestS = 0.0;
    for (int j = 0; j < HJ_PRIM_MAX; j++) {
      if (j >= n) break;
      float d, rad, s; hjPrim(P, L, k * HJ_PRIM_MAX + j, d, rad, s);
      if (d - rad < bestF) { bestF = d - rad; bestD = d; bestR = rad; bestS = s; }   // 액터 내부 = 합집합(min)
    }
    float soft = max((uHanjiLightSize * bestS / max(1.0 - bestS, 0.05) + uHanjiPaperBlur) * uHanjiScatter, 0.005);
    vis *= smoothstep(bestR - soft * 0.5, bestR + soft * 0.5, bestD);   // 소스 간 = 곱
  }
  return vis;
}
```

**구현 주의**
- `hjSegSeg2`는 기존 `hjSegSeg`(`index.js:310-320`)의 연산 순서를 그대로 두고 `t`만 함께 낸다. `hjSegPoint`는 점–선분 거리.
- **비트 동일 장치**: argmin 원시의 `(d, rad)`로 옛 식 `smoothstep(rad − soft/2, rad + soft/2, d)`를 같은 형태로 계산하므로 `ra = rb` 단일 rc는 옛 캡슐과 같은 연산이다. 더미를 풀의 정적 캡슐로 넣은 상태의 12샷 비트 동일이 체크포인트 ②다. SwiftShader JIT 차이로 깨지면 차이 샷·HDR 최대 차를 보고해 승인받는다.
- **`hjRcTaperMin`**(`ra ≠ rb`): `g(s) = |p⊥(s)| − r(z(s))`를 정확히 최소화(p⊥·z는 s에 아핀). 내부 해 `s = (−b ± |c|·sqrt((ae − b²)/(a − c²)))/a`(`a = |p⊥D|²`, `b = p⊥0·p⊥D`, `e = |p⊥0|²`, `c = (rb − ra)·zD/L`, 부호 `sign(as + b) = sign(c)`), 양끝 반구 닫힌 해, s=0,1 후보 비교. ≈40 flop. 옛 근사의 치마 기울기 2–3 cm 오차를 없앤다. JS 미러 동일, 무차별 샘플과 1e-6 m 일치.
- **조기 탈출의 성격**(재검토 #16): rc의 `d`는 참 거리라 `db > R + softB/2`이면 전체 계산도 정확히 1.0이다(보수적). el의 `d = (r − 1)/|∇r|`는 볼록 1-동차 노름의 1차 SDF라 참 거리의 하한이다(`r(y) ≥ r(x) + ∇r·(y − x)`). 그래서 조기 탈출이 V < 1인 광선을 1로 자를 수 있다(결정적인 작은 계단). **조기 탈출을 셰이더 정의의 일부로 명시**한다: 출력 = (조기 탈출 ? 1 : 원시 루프). JS 미러가 같은 정의를 쓰므로 예측·누설 영역·지각이 셰이더와 같다. 보수성 테스트는 rc 전용 레코드로 한정하고, el 혼합 레코드는 동일성만 판정한다. `silhouettepredict`가 v0·v1의 최대 계단 \|V_full − V_def\|를 보고한다. 경계구 반경 확대(보수성 회복) 대안은 원시 루프 화소를 늘리므로 계단이 판독에 보일 때만 올린다.
- **0색 광원 건너뛰기**: `pointLights[i].color == vec3(0)`이면 `hjOcclusion` 생략(B안). 0을 더하는 것과 같아 비트 동일.
- 샘플러 +1(HANJI 텍스처 유닛 ≈10/16, 추정). 부팅에 `maxTextures`·링크 성공 단언. `texelFetch`·정수 비트 연산은 GLSL 300 es 기본.

### 4-5. `HanjiOcclusion` 브로커 (`materials/hanji-occluders.js` v2)

```js
export const HJ_SLOT_MAX = 8, HJ_PRIM_MAX = 24, HJ_TEXELS = 4;
export class HanjiOcclusion {
  constructor()                    // 부팅: DataTexture(Float32Array(4·4·8·24), 4, 192, RGBA, Float, Nearest) — UUID는 부팅에만
  addSource(name, emitFn)          // emitFn(w): w.begin() · w.rc(a,b,ra,rb) · w.el(c, Mworld) · w.bound(cx,cy,cz,R) · w.end() — 슬롯 번호·출처 없음
  addStaticCapsule(id, {a, b, r}) / removeStaticCapsule(id)   // 레거시 더미 전용(② ~ 9b), 일반 레코드와 같은 형식
  registerPane(paneId, { corners, normal, uniforms })   // syncPaneUniforms() 뒤(main.js:334, opacity.js:80-82)
  assertPanesRegistered(hanjiPanes)                     // 미등록 판이 있으면 부팅 throw
  update(camera, pointLights)      // beforeRender: 수집 → occluderKey 정렬 → 슬롯 0..n−1 → 뷰 변환 → 텍스처·경계 → 판별 마스크
  reset()                          // 정적 캡슐 = 부팅 등록. 소스는 무상태(매 프레임 재구성)
  stats() → { sourcesUsed, primsMax, panesMasked, staticCapsules }
  get uniforms()                   // 공유 { uHanjiOccTex, uHanjiOccBound, uHanjiOccN }, uHanjiOccMask는 판별
}
```

- **풀 규칙**(검토 #9): 레코드는 진짜 액터·레거시 더미·P4C 가짜 실루엣 모두 같은 형식이고 출처를 담지 않는다. 매 프레임 `occluderKey`(경계구 중심 mm 정수 (x, z, y) 사전순, 동률은 원시 바이트 FNV) 오름차순으로 0부터 배정한다. 순서가 내용만의 함수라 정체와 무관하다(P4-BRIEF:796). `HJ_SLOT_MAX` 초과·원시 25개 이상이면 throw(조용한 탈락 폐지, PATCH-001-D). 시뮬도 같은 키로 정렬한 `occluders`를 공개 뷰에 싣는다.
- 용량 단언 `ACTOR_SLOTS + NON_ACTOR_OCCLUDERS_MAX ≤ HJ_SLOT_MAX`(6 + 2 ≤ 8). 판 휘도는 풀 슬롯 순서로 곱한다(결정적). 테스트: 등록 순서를 섞은 두 입력의 텍스처·마스크 바이트 동일.
- 뷰 변환은 기존 경로(`_v.copy(a).applyMatrix4(view)`)와 같게. el은 `M_view = M_world · R_viewᵀ`, `c_view = view · c`.
- **판별 마스크(CPU)**: 판 × 활성 슬롯 × 켜진 점광(`intensity > 0`, 판까지 `distance` 안)마다, 경계구 + `soft_max/2`(`(0.12·20 + 0.03)·scatter = 2.43 m`)가 AABB(판 모서리 ∪ 광원)와 겹치면 비트를 켠다(< 0.1 ms, 추정). `softB ≤ soft_max`이므로 마스크가 끈 판의 모든 광선은 조기 탈출 정의에서도 1.0이다(정의에 대해 보수적). `soft_max`는 이 마스크에만 쓴다.
- 사망·래그돌 액터도 등록을 유지한다(시체도 빛을 가린다). 미등록 물체(가구·기둥)는 가리지 않는다(설계 한계).

### 4-6. 비용과 폴백

유니폼 ≈17 vec4 + 샘플러 1, 텍스처 프레임당 12 KB, 프로그램 수 불변. 프래그먼트는 판 마스크 → 조기 탈출 → 원시 루프(≤ 24 × texelFetch 3–4 + ≈50 flop)로 거른다. 샷 3 SwiftShader 증가는 미측정(profile·감사로 실측). 허용 불가면 발주자 보고 뒤 (1) 원시 상한을 데이터 상한으로 낮추거나 (2) 판별 유니폼 배열(B안, el은 장축 캡슐 근사)로 후퇴한다.

### 4-7. 조명 구성 — 기하 계산

- 무대(코드에서 읽음): 판 `na_w_-3` x = −32, 가시 y 1.45–3.50(바닥 1.0 기준 0.45–2.50), z −12.85..−10.15. 앵커(현 더미 자리) (−29.5, 1.0, −11.5), 판 뒤 `D_a = 2.5`(고정). 등롱은 판 뒤 `D_L`, 높이 `y_L`(현행 (−26, 2.0)), z는 앵커와 같다(`level.js:594-606`, `shots.js:65-78`).
- 식: `m = D_L/(D_L − D_a)`, 액터 공간 대역 `h = y_L + (y_p − y_L)/m − 1.0`(`y_p ∈ {1.45, 3.50}`), 측면 반폭 `1.35/m`, 반그림자 `soft = 0.12·s/(1 − s) + 0.03`(`s = D_a/D_L`, 판 위 `soft·m`, `index.js:327`), 판 중심 조도 `att = d^−1.5·(1 − (d/24)^4)²`(decay 1.5, distance 24, `level.js:601`).

| 후보 | 등롱 (x, y) | 판 뒤 | m | 대역 | 측면 | soft 액터/판 | att | 강도 보상 |
|---|---|---|---|---|---|---|---|---|
| **L0 현행** | (−26, 2.0) | 6.0 | 1.714 | 0.68–1.875 | ±0.79 | 0.116 / 0.198 | 0.0672 | — (9) |
| **B 추천** | (−22.8, 2.0) | 9.2 | 1.373 | 0.60–2.09 | ±0.98 | 0.075 / 0.103 | 0.0342 | ×1.96 → 17.7 |
| C | (−22.8, 1.8) | 9.2 | 1.373 | 0.545–2.04 | ±0.98 | 0.075 / 0.103 | ≈0.034 | ×≈1.97 |
| D | (−22.2, 2.0) | 9.8 | 1.342 | 0.59–2.12 | ±1.01 | 0.071 / 0.095 | ≈0.031 | ×≈2.2(동벽까지 0.2 m) |

- **원리**: 점광이 액터 뒤·바닥 위에 있는 한 `m > 1`이라 대역 높이 `2.05/m < 2.05`이고 발(h=0)은 늘 판 아래로 떨어진다. 전신 투영은 불가능하다. 폭과 선명도를 함께 개선하는 변수는 깊이(m → 1)뿐이다.
- **콩쥐 치마단**: 최대폭 0.84 m는 바닥이라 대역 밖이고, 대역 안(B 0.60–1.20 m)에서는 폭 0.32 → 0.62 m의 퍼짐 경향만 투영된다(계산). 처분은 결정 20.
- **B 근거**: 깊이 한 변수만 바꾼다(R4). 귀 2.00·뿔 2.05가 대역 안. 반그림자 116 → 75 mm. ×1.96은 점광항을 현행 수준으로 되돌려 `uHanjiAmbient` 대비 차폐 가능 분율을 보존한다(C-2). 대가: 확대 1.71 → 1.37로 실루엣 ≈20% 축소. 008-B "1.7×에서 사람 비례가 읽힌다"(CONTRACT-NOTES:1170-1177)는 캡슐 기준 경험치이므로 캡처를 보고 발주자가 정한다(결정 2).
- **간섭**: B 등롱 → 판 모서리 광선과 실내 기둥 (−28.67, −10), (−25.33, −10)은 표면 기준 ≈0.48 m 떨어진다(기둥은 차폐 미등록이라 결과 무관). 등롱은 동벽 x = −22에서 0.8 m 안쪽.
- **그림자 밖 영향(계산, 재검토 #14 정정)**: `castShadow=false`라 벽 너머로 비추지만 도달은 `distance` 24 m 컷오프로 끝나고(`level.js:601`), three 거리 감쇠는 컷오프 밖에서 정확히 0이다. 등롱을 켜는 계약 샷은 `hanji_silhouette`·`lantern_night` 둘뿐이고(`lantern: 9`), 기본 뷰는 0이다(`shots.js:23`). `lantern_night` 시야(카메라 (1.2, 1.6, 36.5) → (5, 2.2, 40), z ≳ 36)는 L0·B 모두에서 ≥ 47.5 m 떨어져 있다(카메라까지 ≈54 m). 따라서 조명 이동(④b)은 `hanji_silhouette` 한 장만 바꾸고 11샷은 비트 동일이 기대값이다(imagediff 확인).

### 4-8. 조명 적용 방식

- **앵커**: 단계 9a에 지오메트리 없는 `Object3D 'silhouette_anchor'`를 더미 자리에 추가(화소 불변). 단계 9b(결정 3)에 `silhouette_dummy` 메시·FABRIC 콜라이더(`level.js:355-365`)·정적 캡슐 소스 제거.
- **등롱 배치**: 9a에 `'dummy.x + 3.5'`(`level.js:598`)를 앵커 기준 상수 `{behindActor, y, headY}` = L0 `{3.5, 2.0, 2.05}`로(화소 불변). B `{6.7, 2.0, 2.05}`는 12a에서만. `na_lantern_head`도 함께.
- **강도 배율**: 9a에 세 등롱 `userData.intensityScale = 1` 명시(없으면 throw). `applyShot`·`applyDefaultView`(`main.js:235, 259`)는 `l.intensity = shot.lantern × intensityScale`. 1.96은 12a.
- **순서**(C안 + 016-B): ① 단계 11: L0 1차 실측(clip·대비·4축 원값). 누설 영역이 L0에서도 비지 않아 정적 단계에서 멈추지 않는다(§8-3). ② 같은 실행에서 `--stage-candidates`(testOverride)로 L0·B·C·D 캡처. ③ **정지·보고**(016-B). 레벨·계약 샷 등롱은 L0 그대로, 9b 샷 3 교체도 L0. ④ 12a: 결정 2 반영 → 재실측(④b).
- 액터·앵커·카메라는 어떤 경우에도 옮기지 않는다. 감사는 `|anchor.x − pane.x| = 2.5`(정적)와 **액터 실제 루트** `|root.x − pane.x| = 2.5`(브라우저, §8-1)를 단언한다.

---

## 5. 내비메시

### 5-1. 표현 — 청크 다층 스팬 그래프

**`NAV_CONFIG`**(`ai/nav/config.js`, deep frozen, 구현 파라미터)
- `cell 0.25`, `chunk 48`(원점 정렬, 경내 ±45 = 4청크, 이음선 x=0·z=0), `pad 1.0`, `maxLayers 4`(초과 throw), `slopeCos cos50°`.
- `clearMax = AGENT_RADIUS_MAX`(0.34, 질의 반지름 상한에서 유도, 이분 6회 → ≈5.3 mm).
- **클리어런스 캡슐 = 컨트롤러가 들어 올린 자세**(`character.js:150-160`): `ℓ = min(STEP_HEIGHT, head − h)`, `p0 = y + ℓ + r`, `p1 = max(p0, y + ℓ + h − r)`. h는 STAND면 클래스 최대 키, CROUCH_ONLY면 최대 crouchHeight(보수, 거짓 음성만). 0.42 m 아래 문지방·계단 단은 캡슐에 안 닿고 Δy 오라클이 맡는다. 0.45 m 문지방은 수평 0.14 m 안에서만 닿는다(계산, r .34) — nav-synthetic 양성 케이스로 확인.
- `minHeadroom` = 로스터 최소 crouchHeight. **이동 클래스** `agentClasses`: 로스터 ∪ v1 fixture의 `(radius, height, crouchHeight, walk, jumpSpeed)` 고유 튜플 사전순(데이터 유도, 매니페스트에 기록).
- `jumpLadder [5.0..7.5] m/s` 0.5 간격(클래스 `jumpSpeed` 이하만), `dropMax 4.0`, `crossMax 1.5`, `vaultablePrefixes ['wall_g_', 'wall_cap_', 'wall_ridge_']`, `subtile 12`, 표면 비용·벌점(JUMP 1.5, DROP 1.2, VAULT 3, 튜닝값). 청크 크기는 데이터 하나이고 4청크는 다층 이음을 실제로 시험하려고 골랐다.

**청크 SoA**(`format.js`)

| 배열 | 형식 | 의미 |
|---|---|---|
| `colStart` | `Uint32Array(192²+1)` | 열별 스팬 시작 |
| `spanY` | `Float32Array` | 바닥 높이 |
| `spanHead` | `Uint8Array`(2 cm, **내림**) | 헤드룸 |
| `spanClear` | `Uint8Array`(cm **내림**, 상한 clearMax) | 노드 클리어런스. 반올림하면 0.336 m를 34로 저장해 r 0.34를 잘못 통과시킨다(재검토 #17) |
| `spanRep` | `Int8Array ×2`(cm) | 대표점 오프셋. 탐색으로 고른 점을 **먼저 양자화하고 그 점에서** 클리어런스·간선을 다시 잰다 |
| `spanSurf`, `spanFlags` | `Uint8Array` | 표면 인덱스, STAND·CROUCH_ONLY·WATER·PRUNED |
| `spanLink` | `Uint32Array` | 비트 0–7 평탄 간선(\|Δy\| ≤ 0.05) 기하 유효, 8–23 방향별 이웃 층 |
| `dyWalk` | `Uint8Array(spans × classes)` | 클래스별 8방향 Δy WALK 비트(오라클) |
| `edgeClear` | 희소(`Uint32` 스팬 + `Uint8 ×8`, cm 내림) | clearMax 미만 평탄 간선의 방향별 값 |
| `links` | `Int32Array [from, to, req, param, costCm, classMask]` | 청크 내부 JUMP·DROP·VAULT·가로지르기 |

- 전역 `portals [chunkA, spanA, dir, chunkB, spanB, req, param, classMask]`: 청크 경계 연결은 **여기에만**.
- 선택 근거: Recast식 폴리곤보다 결정성·감사가 단순하고, 대표점·정확 클리어런스로 격자 양자화 오판을 피한다(내아 동문 여유 ≈3 cm, A-2 정정).

### 5-2. 굽기 (`ai/nav/bake.js`, `tools/navbake.mjs`, 오프라인, 순수)

입력은 헤드리스 `buildWorld` + `physics.build()`(`coveraudit.mjs:46-49` 선례)의 `StaticWorld`와 주입물뿐이다. 청크마다(패딩 포함) 다음을 한다.

1. **열 샘플**: 셀 중심 `aabb.maxy+1`부터 `MASK.CHARACTER` 하향 다중 히트(창호지 0.3 mm는 막고 연못 수면은 통과, 히트 뒤 1 mm 전진). **오브젝트별 교차 패리티**(`raychain.js:6-22`, 홀수 번째 = 진입)로 진입만 바닥 후보로 삼고, 뒤집힌 out 노멀(`bvh.js:545-547`) `ny ≥ slopeCos`만 쓴다(삼각형 nrm 부호 불신, 와인딩 반전 8,320개). 열 끝에 패리티 홀수인 열린 메시는 리포트하고 ⑩에서 거른다(검토 #19).
2. **헤드룸**: 바닥 +0.05 상향 raycast, `minHeadroom` 미만 버림.
3. **nodeClear**: 셀 안 5×5 → 최선점 주변 3×3 반 간격(최종 1.25 cm), 후보마다 클리어런스 캡슐 `overlapCapsule`로 반지름 6회 이분(0..clearMax, −5 mm 허용은 `character.js:95-130`과 같음). 개활지면 중심 `r = clearMax` 통과 시 생략. 최종 점은 양자화 뒤 다시 잰다.
4. **STAND / CROUCH_ONLY / 막힘**: 대표점 헤드룸과 클래스 최대 키·crouch. nodeClear < 로스터 최소 반지름이면 막힘(막은 object id 기록).
4b. **도달 상계 가지치기**(재검토 #17): 지붕은 충돌체(`kit.js:703, 732`, 기와 30 mm·보토 80 mm, `collide: true`)이고 경사 < 50°라 지붕 셀 전부가 스팬이 되고, 0.25 m 셀에서 Δy 0.12–0.21 m라 모두 Δy 간선이 되어 오라클(+ jumpLadder 최대 6회)이 폭증한다. 그래서 시드(바닥 오브젝트 `ground`, `level.js:148`)에서 상계 그래프(8이웃·층 전이·`crossMax` 후보, 위로 `H_up` 이하·아래로 `dropMax` 이하)로 닿지 않는 스팬을 PRUNED로 표시하고 ⑤–⑧을 건너뛴다. `H_up = v_max²/(2|g|) + STEP_HEIGHT + r_max`(v_max = 클래스 `jumpSpeed` 이하 jumpLadder 최댓값, g = `physics.gravity`, vault 클래스가 있으면 vault 한계와 최댓값). 기존 값에서 유도한 상계라 실제로 닿는 스팬은 가지치지 않는다. PRUNED 수·분포는 리포트.
5. **8이웃 평탄 간선**(\|Δy\| ≤ 0.05): 대표점 A→B로 들어 올린 캡슐을 `r = clearMax`로 `sweepCapsule`(`bvh.js:672-775`) 1회, 막히면 이분으로 `edgeClear`. 0.10 m 심벽·0.3 mm 창호지를 정확히 잡는다. "양끝 ≥ clearMax면 sweep 생략" 단축은 대각 간선 가운데 창호지를 놓쳐 없앴다(A2).
6. **Δy 간선 = 오라클**(`probe.js`, **클래스마다**): 주입 `createController`로 클래스 캡슐을 A에 teleport, 주입 `stepMovement`로 walk 속도에서 B로 N 서브스텝. `|y − yB| < 0.05`로 도착하면 `dyWalk` 비트. 실패하고 Δy > 0이면 jumpLadder 오름차순(성공 최소 속도 = JUMP `param`), Δy < 0이고 걸어서 떨어지면 단방향 DROP. 실효 등반 한계 ≈0.42 + r(`character.js:157-160`, 실측 r .34: 0.7 m 걷기·0.75 m 실패)을 클래스마다 수치 임계 없이 재현한다(검토 #5).
7. **가로지르기·원거리**: 이웃 빠진 가장자리 스팬에서 걷기·점프 오라클로 `crossMax` 안 착지 스팬(누각 데크 3.0, 마루 1.0, 회랑 0.55).
8. **VAULT**: 막은 오브젝트(`bvh.js:105-132`)가 `vaultablePrefixes`이고, 상단 ≤ vault 한계, 양쪽 착지 nodeClear ≥ r, vault 능력 클래스만. 건물 벽은 접두 밖이라 "담장까지만"(§4-1-C)이 구성으로 보장된다.
9. 인코딩·해시(§5-3). 10. **고체 내부 스팬 0 단언**: 스팬 바닥 +0.05 상향 패리티가 전부 짝수여야 한다(위반 throw, object id·좌표 출력).

**봉합**(`stitch.js`): 경계 열 쌍에 ⑤⑥⑦을 클래스별로 적용해 portals를 만들고, 패딩 샘플 = 이웃 내부 샘플 비트 동일을 단언한다.

**비용(미측정)**: 청크당 36,864열. **단계 7 첫 작업은 건식 집계**다: 오라클 전에 청크별 스팬·PRUNED·Δy 간선 × 클래스·가장자리 후보 수와 오라클 1회 시간을 보고하고, `navcheck`가 statics 잡(120분)에 드는지 먼저 판단한다. 굽기 시간은 실측해 R15·§8-12에 넣는다(종전 추정은 폐기). 런타임 굽기를 안 쓰는 이유는 boot_cpu ≤ 3 s다.

### 5-3. 산출물·부팅·신선도

- **자산**: `src/ai/nav/assets/gwana/<cx>_<cz>.navbin`, `portals.navbin`, `manifest.js`(navbake 생성, "생성물 — 손대지 마라").
  ```js
  export const NAV_ASSETS = Object.freeze({ gwana: Object.freeze({
    version: 1, bakerVersion: 1,
    paramsHash: '…',     // NAV_CONFIG + classes + bakerVersion 정규 JSON(문자열·정수) — 부팅 throw
    structure: '…',      // StaticWorld 정수 구조 지문(순서·이름·삼각형 수·표면·마스크) — 부팅 throw
    geomHash: '…',       // Float32 기하 FNV — 노드–브라우저 일치 보고(결정 16)
    sourceHash: '…',     // level·kit·bvh·surface-registry·src/ai/nav/**·movement·character·로스터·fixture 바이트 — 진단
    classes: Object.freeze([/* (radius, height, crouchHeight, walk, jumpSpeed) … */]),
    chunks: Object.freeze({ '-1_-1': new URL('./gwana/-1_-1.navbin', import.meta.url), /* … */ }),
    portals: new URL('./gwana/portals.navbin', import.meta.url) }) });
  ```
  `new URL` 리터럴은 vite 규칙(`src/audio/assets/manifest.js` 선례). distaudit [3]이 dist 200을 확인한다(`distaudit.mjs:50` 확장). 고정 스냅샷은 `src/`를 서빙하므로 **커밋해야 서빙된다**(`pinned.mjs:23, 63-64`).
- **부팅**(throw는 비트 일치가 구성으로 보장되는 것만, 검토 #7): `physics.build()` 직후 `NavWorld.load(NAV_ASSETS.gwana, physics.static, {mask})`.
  - `paramsHash`를 `NAV_CONFIG` + **매니페스트 `classes`** + `bakerVersion`으로 재계산해 다르면 throw. 브라우저·dist는 v1 fixture(`test/`)를 못 읽으므로 클래스 출처는 매니페스트다(재검토 #17).
  - 로스터 캐릭터의 `agentOf` 튜플이 `classes`에 없으면 throw(로스터 ⊂ classes를 따로 단언).
  - `structureFingerprint()` 불일치 throw("nav 낡음 — node tools/navbake.mjs"), 부동소수 무관.
  - `geomHash`는 `nav.parity = {baked, live, equal}`로 기록만 하고(playtest `p4b_nav_hash_parity`·distaudit 보고), 불일치면 청크·첫 차이 삼각형을 진단 출력한다. 반복 실측 일치 뒤 승격은 결정 16(노드↔브라우저 기하 비교 선례 없음, `level.js` 회전·곡면은 Math.sin/cos).
  - 낡은 내비를 조용히 쓰는 경로는 없다(구조 변경 → 부팅, 내용 변경 → `navcheck`). PATCH-010-C "ready에 에셋 로드 포함" 충족.
- **신선도**(노드가 권위): `navcheck` 줄 = `node tools/navbake.mjs --check`(전체 재굽기 = 커밋 산출물 바이트 동일, statics의 `npmtest` 뒤, 타임아웃 실측 × 2.5). `nav-fresh`(npm test)는 빠른 검사만: 매니페스트 해시 ↔ 자산, 매니페스트 `classes` ↔ 로스터 ∪ fixture 유도 표, `paramsHash` ↔ 설정, `structure` ↔ 헤드리스 buildWorld. `sourceHash` 불일치는 경고만. `bakerVersion`·`paramsHash`·클래스 변경은 재굽기 강제.

### 5-4. 런타임 오버레이 (BVH 재빌드 없음, `overlay.js`)

- `addBlocker(id, {kind: 'obb'|'capsule', …, yRange})`: (가) 대표점이 `블로커 ⊕ r` 안이거나, (나) 펼치는 간선·링크의 수평 선분이 `발자국 ⊕ r`과 교차하고 `yRange`가 간선 수직 범위(양끝 바닥 ~ + 클래스 키, JUMP는 정점 높이 포함)와 겹치면 차단(검토 #18). 활성 블로커 ≤ 슬롯 수라 O(B).
- `addLink(id, aPos, bPos, req, param, costCm, classMask)`(`nearestSpan`으로 해석), `remove(id)`. id는 출처에서 결정적(`skill:<slot>:<seq>`), 처리는 등록 순. 영향 subtile만 캐시 무효화, `version++`. 새 이벤트 없음(P4C `spawnSurface`가 같은 서브스텝에서 주입된 nav 파사드를 호출, `events.js:9-32`).

### 5-5. 이동 능력과 에이전트

- `ABILITY = {WALK 1, JUMP 2, DROP 4, CROUCH 8, VAULT 16, CLIMB 32(예약), SWIM 64(예약)}`, 링크 플래그 `RUNTIME 128`. `agentOf(def, classes) = {radius, height, crouchHeight, abilities, jumpSpeed, maxDrop, navClass}`.
- 통과 조건(모두): `(req & ~abilities) == 0`, nodeClear·edgeClear ≥ radius, head ≥ (CROUCH ? crouchHeight : height), Δy 간선은 `dyWalk[span·classes + navClass]` 방향 비트, 링크·포털은 `classMask & (1 << navClass)`, JUMP `param ≤ jumpSpeed`, DROP `param ≤ maxDrop`.
- 캐릭터별 굽기 없음(굽기 1회, 오라클 비트만 클래스 수만큼). 새 클래스는 재굽기(코드 0), 부팅 단언이 알린다. v1 fixture 클래스 포함이라 P4D 편입에 재굽기 불필요. 단일 반경은 특수 경우(결정 8). 견우만 VAULT, 심청 blink는 서버 충돌 검사(내비 밖).

### 5-6. 경로 탐색 (`path.js`, `navmesh.js`)

노드 `chunkOrd·2²² + span`, 그래프 = 8방향 + 층 전이 + 링크 + portals. 비용 정수 cm(직선 25, 대각 35, 링크 costCm × 벌점 × 표면 배수), 휴리스틱 octile `25·max + 10·min`. 이진 힙 키 `(f, h, id)` 사전순, 청크별 `g`·`stamp` 로드 시 할당(질의 중 할당 0). `maxExpand` 초과 `'exhausted'`, 미로드 `'unloaded'`(조용한 부분 경로 금지). 클리어런스 보존 시선 검사(supercover, 블로커 선분 포함)로 스트링 풀링, `Float32Array` 출력. 섹터 HPA\*는 같은 인터페이스 뒤 최적화(정확성 기준은 셀 A\*). API: `findPath(start, goal, agent, outF32, maxPts) → {status, count, costCm}`, `nearestSpan`, `snapshot()`, `getState()`.

### 5-7. 결정성과 resetState

배열 순서 고정·float32·`Math.random`·시계 없음, 2회·2프로세스 굽기 바이트 동일. 질의는 무상태, 오버레이 변경은 시뮬 서브스텝 안에서만. `nav.markBoot()`·`nav.resetToBoot()`(⑥a)가 오버레이·캐시·id·version을 복원해 `getState().hash`가 부팅과 바이트 동일.

### 5-8. 현 맵 결함 처리 (있는 그대로 굽고 픽스처로 고정)

`test/fixtures/nav-expect-gwana.json`(B안, 클래스별 기대값):

| 결함 | 굽기 결과 | 근거 |
|---|---|---|
| 객사 서측 기둥 (21, −10)의 0.49 m 틈 2개 | 객사 실내 별도 성분(섬) | `level.js:372-381` |
| 누각 전폭 북측 난간 `nu_rail_x_-1` | 계단 정상→데크는 JUMP만 | `level.js:470-473` |
| 내아 동문 0.7425 m | r .34 통과 / r .40 불통(합성) | map_world |
| 남문 밖 0.55 m 띠 | 막다른 스팬, dangling portal 자리 | gate_walk |
| 담 넘기 | VAULT 0(바깥 착지 여유 0.015 m), 구조는 합성 월드로 증명 | map_world |
| 동헌 칸막이 머름 0.45 m | 클래스별 Δy 오라클 WALK | `level.js:284` |
| coveraudit와 차이 | coveraudit는 캡슐 폭 무시(`coveraudit.mjs:96-104`) — 사유 기록 | |

굽기는 단계 7(더미 콜라이더 포함)과 9b(제거 뒤) 두 번. P1이 결함을 고치면(결정 12) 재굽기가 강제되고 기대값은 의도적으로 갱신한다.

### 5-9. 오디오 연결

`audio-adapter.makeDetourGraph(nav).findDetours(src, lis)`: 반경 0.1 에이전트의 `WALK|DROP` 경로 → `{apparentPos, pathLength, turns}`(`propagation.js:8-16`). Δy는 클래스 비트 OR, 블로커는 §5-4 선분 검사. 주입(`audio.setPropagationGraph`, `audio/index.js:83-85`)은 오디오 해시를 바꾸므로 P4C 청감 판정과 묶는다(결정 17).

---

## 6. PBD 래그돌 (`src/physics/ragdoll.js`, `PhysicsWorld` 소유)

### 6-1. API와 메모리

```js
new RagdollWorld(staticWorld, { slots: 6, gravity, mask: MASK.CHARACTER })
registerTemplate(key, compiledRig)          // 부팅, 시각 리그별. 질량은 분율(합 1)만
activate(slot, key, massKg, jointPos, jointVel, impulseWorldPos, impulse)   // massKg = 진짜 값 → 슬롯 invMass. 초기 클램프, 할당 0
step(dt)                                     // PhysicsWorld.step: rigid.step → ragdoll.step
particles(slot, out) → n;  state(slot) → { active, sleeping, forced, steps, hash }
wake(slot); snapshot() / hash() / reset()
```

- SoA(부팅 할당): `Float64Array x, xPrev (6·16·3)`, `invMass`, `radius`, `active`, `sleeping`, `forced`, `still`, `steps`, 슬롯별 후보 삼각형 스크래치·접촉 버퍼.
- `RigidBody` 미사용: playtest `crates_exist = 3`(`playtest.mjs:153-154`), `maxBodies` 256 축출(`rigidbody.js:236-247`), 전역 `_nextId`(`rigidbody.js:23`)와 무관하게.
- 표시는 액터 자신의 SkinnedMesh(`postPhysics`가 입자 → 뼈). 래그돌 전용 메시·프로그램·UUID 0.

### 6-2. 리그 컴파일 (외견 리그 + biped 템플릿 → 동결 typed array)

- 질량: 템플릿은 외견 리그 `massScale`로 정한 분율(합 1)만 담고, 활성화 때 진짜 `massKg`를 곱해 슬롯 `invMass`에 쓴다(재검토 #10). 키가 시각 리그여도 총질량은 진짜 값이다.
- 입자 반지름·뼈 충돌체는 외견 원시에서 유도(rc `(ra + rb)/2`, el 최단 반축, 데이터로 덮어쓰기 가능). 뼈 충돌체 = 입자 쌍 선분 + 반지름.
- 구속(데이터 순서 고정): 막대 15(길이 = 활성화 직전 뼈 길이, 클램프 전), 버팀대 6(강성 0.9), 거리 한계(각도 → 코사인 법칙 `|ac| ∈ [dmin, dmax]`), 경첩 반공간(무릎·팔꿈치, `(x_관절 − 양끝 중점)·n ≥ 0`). 분기가 적고 순서 고정이라 결정적. 비틀림·자기충돌은 표현하지 않는다.

### 6-3. 서브스텝 (`PHYSICS_DT = 1/120`, 슬롯 0..5, 깨어 있는 것만)

1. Verlet: `v = (x − xPrev)(1 − 0.02)`, `|v| ≤ vMax·dt`(vMax 25 m/s), `x += v + g·dt²`, g = `physics.gravity` −20.6(`rigidbody.js:217`).
2. 브로드페이즈: 래그돌 AABB로 `queryAabb` 1회, 결과를 **즉시 슬롯 스크래치로 복사**(공유 `_cand` 재진입 오염 방지, `bvh.js:661-666`).
3. 입자 CCD: `|x − xPrev| > 0.5·r`이면 `sweepCapsule`로 TOI − 1 mm 클램프(`rigidbody.js:316-362` 선례).
4. 반복 8회: 막대 → 버팀대 → 한계 → 경첩 → 충돌. 충돌은 `segTriangleClosest`(`math.js:224`), `depth = r − d`, 관통이면 면 노멀을 '이전 서브스텝 뼈 중점 쪽' 부호로. **접촉 축약**: 깊이 내림차순·삼각형 번호 오름차순, `character.js:364-378`의 already/extra 누적, `|applied| ≤ 0.25`, 양끝 분배 `w = 1/((1−s)² + s²)`. `overlapCapsule` 256 절단(`bvh.js:781-832`)은 안 쓴다.
5. **중심 비교차 클램프**: 입자마다 `raycast(xPrev → x)`, 히트면 `x = xPrev + dir·max(0, t − r)`. 0.3 mm HANJI 상자(`level.js:112-116`)·24 mm 창살을 터널링하지 않는다. 초기 상태의 성립은 §6-4가 세운다.
6. 마찰 `(1 − μ)`(SURFACE_PROPS), 반발 0.
7. 슬립: 최대 변위 < 2e-4 m가 60 서브스텝 → sleeping, 720 서브스텝 → 강제 슬립(`forced = 1`). 구현 파라미터, 서브스텝 카운터(`clock.js:43-59`).
8. 슬립 진입 스텝에서도 뼈 복원(`index.js:86` 패턴 미복제).

마스크 `MASK.CHARACTER`(창호지는 막고 물은 통과). 범위 밖(기록): 래그돌 ↔ 강체·액터·래그돌, 자기충돌.

### 6-4. `actor:death` 배선

1. `ActorSim.kill(slot, {impulseWorldPos, impulse})`: alive = 0, 컨트롤러 비활성, `bus.emit('actor:death', {actorId: 'a' + slot, impulseWorldPos, impulse})`(어휘 그대로, `events.js:27-28`). P4B 발행 경로는 `debugKillActor`뿐.
2. `src/ai/death.js`가 `bus.markBoot()`(`main.js:375`) 전에 구독: `{rigKey, massKg} = actors.ragdollSeed(slot, pos, vel)` → `ragdoll.activate(slot, rigKey(외견), massKg(진짜), pos, vel, impulseWorldPos, impulse)`.
3. 초기 상태: 위치 = 외견 리그 관절 원점, 속도 = 액터 속도, `xPrev = x − v·dt`. **초기 클램프**(검토 #17): 골반부터 골격 트리 순(부모 → 자식)으로 `raycast`, 히트면 자식을 `부모 + dir·max(0, t − r_child)`로(xPrev도 같이). 판 바로 앞 사망 시 판 너머 관절이 영구 고정되는 실패를 막는다. 충격은 `impulseWorldPos` 최근접 뼈 선분의 양끝에 `(1−s, s)` 가중 `Δv = J·w_i/m_i`(동률은 낮은 인덱스, 난수 없음).
4. 같은 서브스텝 안: `fire.update`(P4C)/디버그 → emit → `physics.step` → `postPhysics`.

### 6-5. 최종 자세 해시 검증

- 해시: FNV-1a 32 × 2 기저(64비트 표기), 대상은 활성 슬롯의 `[slot, sleeping, forced, steps]`와 **Float64 입자 바이트**(float32면 섭동 시험이 공허해질 수 있다).
- `test/ragdoll.test.mjs`(합성: 바닥, 0.6 m 단, 0.3 mm 판, 24 mm 살 / 헤드리스 경내 4종): 2회·별도 프로세스·reset 후 해시 동일, **1e-9 충격 섭동이면 해시가 달라야 함**(비공허), NaN 0, 매 스텝 중심 비교차, 판·창살 미관통, `rigid.bodies` 불변, 외견 리그가 달라도 총질량 = 진짜 `massKg`, 판 앞 0.3 m 팔 뻗은 사망(초기 클램프 뒤 뼈–판 교차 0, 막대 수렴). 슬립은 판정하지 않는다: 720 서브스텝이면 강제 슬립이라 "720 안 슬립"은 공허하다(재검토 #13). `steps < 720`·`forced`는 보고만 한다.
- playtest `p4b_ragdoll_final_pose`: `resetState → debugSpawnActor → debugKillActor(고정 at·J) → stepFrames(360)` → h1과 `{sleeping, forced, steps}` 기록 → `resetState` → 같은 절차 → h2. 판정은 `h1 === h2`, steps·forced 동일, 리셋 직후 활성 래그돌 0. 360프레임은 정확히 강제 슬립 한계(프레임당 서브스텝 2, `harness.js:18`)라 sleeping은 보고만 한다.
- 노드–브라우저 해시 일치(`p4b_ragdoll_headless_parity`)는 보고만(V8 초월함수 마지막 비트, 결정 16).

---

## 7. 액터 런타임 · 시뮬/표현 분리 · 정보 은닉

### 7-1. `ActorSim` (`actors/sim/actor-sim.js`)

```js
new ActorSim({ physics, roster, bus, nav, limits })      // physics = 주입 파사드
spawn(slot, { characterId, team, pos, yaw, controller:{ type, params }, appearance:'default' })   // 포즈·원시·경계구 즉시 계산
despawn(slot);  setInput(slot, partial);  setAppearance(slot, stateName)   // P4C applyModifier 진입점
update(dt, playerCapsule)    // 컨트롤러 → 이동 → 분리 → 포즈(외견 리그) → 원시. auditStatic 슬롯 제외
postPhysics()                // 래그돌 입자 → 뼈 → 원시(auditStatic 제외)
kill(slot, { impulseWorldPos, impulse })
raycast(ox,oy,oz, dx,dy,dz, maxDist, out) → n    // (tEnter, slot, primId) 사전순
viewFor(viewerTeam | null) → View (VIEW_BRAND);  snapshotFor(viewer) → plain
ragdollSeed(slot, outPos, outVel) → { rigKey, massKg }
placeForAudit({ slot, characterId, rigOf?, anchorPos, yawDeg })   // auditStatic, 자세 = 시각 리그 auditPose, rigOf ≠ self면 testOverride
getState() / stateHash() / invariants() / markBoot() / reset()
```

- 슬롯 SoA(부팅 할당): Int16 `active, alive, team, charIdx, apparentState, rigIdx, mode`, Float64 `vel(3), yaw, pitch, stance, gaitPhase, hp, auditPos(3)`, 입력(8), 뼈·원시(외견 리그 16·24), dangle 상태. `HIT_SHAPE_RULE = 'true'`이고 외견 ≠ 진짜일 때만 진짜 리그 버퍼를 따로 둔다.
- 위치의 정본은 컨트롤러 `position`이다(`character.js:44-47`). `auditStatic` 슬롯만 예외다.
- **슬롯 모드 `auditStatic`**(재검토 #5): `placeForAudit`와 샷 액터 배치가 켜고 `despawn`·`reset`이 끈다. 정본은 `auditPos`이고 컨트롤러는 `enabled = false`로 주차한다(teleport 없음). `update`의 컨트롤러·이동·분리, `postPhysics`, 포즈 시간 진행(보행 위상·idle 호흡·dangle 적분)에서 빠지고 포즈는 배치 때 한 번 평가해 고정한다. 그래서 `stepFrames(90)` 동안 주차 위치 덮어쓰기, 9b 전 더미 콜라이더(`level.js:355-365`)에 대한 depenetrate(`character.js:146`·`:177` probeGround), 중력·스냅, idle 호흡이 일어나지 않는다. 다른 슬롯의 분리 대상에서도 빠진다. 루트가 캡슐 반경과 무관하므로 선언쌍·복제쌍의 바이트 동일이 캡슐 차이로 깨지지 않는다.
- 컨트롤러: 슬롯마다 `physics.createCharacter({id: 'actor:' + slot})`를 부팅에 하나(인스턴스별 스크래치라 안전, `character.js:31-73`). 스폰은 `configure(def.body.capsule)` → `checkCapsule` → `teleport`. three 객체를 안 만든다.
- 부팅 로스터는 빈 슬롯. 테스트·샷 3(9b 뒤)이 채우고 resetState가 비운다.

### 7-2. 컨트롤러와 이동

`CONTROLLERS`: `idle`, `script`, `navFollow`(`nav.findPath` → 꺾임점 추종), `remote`(P5). 출력 `intent {moveX, moveZ, yaw, pitch, jump, crouch, sprint, ads}`, 캐릭터 분기 없음. `stepMovement`는 Player 적분 규칙(`player.js:58-128`)을 데이터 수치·`physics.gravity`로 그대로 도는 import 0 순수 함수라 내비 오라클에 주입된다. **Player 클래스는 바꾸지 않는다**(R10, P5에서 통합).

### 7-3. 분리

- 모든 이동 뒤 `separate` 1회, 활성·생존 쌍 (i<j) 사전순. 수직 캡슐 거리는 닫힌 식. 겹침 `δ = ri + rj − d > 0`이면 수평 성분만 반씩 **`ctrl.slideHorizontal(dx, dz)`**(d ≈ 0이면 슬롯 번호로 방향).
- `slideHorizontal`은 리프트·하강 스냅·`depenetrate`·`probeGround` 없이 `_slide(dx, 0, dz)`만 돈다. 그런데 `_slide`는 접촉마다 `_classifyContact`로 `grounded`·`groundNormal`·`groundSurface`·`groundObject`·`onSteepSlope`·`touchingCeiling`·`touchingWall`·`wallNormal`을 바꾸고(`character.js:224, 288-302`), `_clipVelocity`로 `velocity`를 깎고(`:279, 304-312`), `_planeCount`·`lastMoveBlocked`를 쓴다(`:283-284`). 그래서 이 필드들을 부팅 스크래치에 스냅샷했다가 `_slide` 뒤 위치만 남기고 복원한다(재검토 #7). `_slide`는 고치지 않으므로 Player 경로는 구성상 비트 동일이다.
- `controller.move`를 쓰면 0.42 리프트·스냅·착지 판정이 함께 돌아 분리만으로 단에 오르거나 발소리 상태가 오염된다(검토 #21). 수평 슬라이드가 남긴 작은 수직 변위는 다음 move의 하강 스냅이 정리한다.
- 플레이어는 고정 장애물(겹침은 액터가 전부 받는다, 기존 playtest 궤적 불변). 사망·래그돌·`auditStatic` 슬롯 제외. 남은 최대 겹침은 `invariants()` 보고.
- 테스트(`actor-sim`): 벽·단·바닥 접촉이 생기는 분리 전후로 위 필드 전부와 `velocity`가 바이트 동일, `_slide` 접촉 ≥ 1(비공허).

### 7-4. 포즈 — 시뮬 소유, 결정적

외견 리그(골격, `pose.style`·`aim`·`dangle`)로 평가. `gaitPhase`는 이동 거리 ÷ 외견 `strideM`(시간원은 dt뿐, 속도는 진짜). `'apparent'` 규칙에서 보이는 것 = 맞는 것 = 판에 비친 것. `evalPose`는 순수 함수이고 테스트로 `evalPose(poseParams, dangleState) == sim 뼈`(P5 원격 재현 보증). dangle은 결정적 스프링 사슬(Verlet, 고정 반복), resetState 복원. AnimationMixer 미사용(UUID 회피, 사망 애니메이션 금지 §3-4).

### 7-5. 히트박스 (P4B 범위)

`rayActor`: 경계 캡슐 광역 → rc(원뿔대 이차식 + 반구 2)·el(단위구 변환) 진입·출구 t와 노멀 → 액터별 구간 합집합, `hitbox: true` 원시만. 형상 출처는 `HIT_SHAPE_RULE`(`'apparent' | 'true'`, 결정 15), 테스트는 두 값 모두. P4C로 미룸: `collectBodyHits` 병합(`firecontrol.js:128-150`, `main.js:106-109`), `penetrate()`·`actor:damage`·아군 관통, 지연 보상, 원시 효과 동적 콜라이더. 층 형식은 체인 병합 형식 `{surface, thicknessCm, entryT, exitT, objectId: -1, objectName: 'actor:a<slot>', actor, hitZone}`.

### 7-6. 시뮬/표현 분리

§1-1 규칙을 determinismaudit **검사 3**(묶음별 허용 집합, import 전이 폐포에 three·present·render·materials·fx·audio·world·weapons 없음, `clock.wallNowMs` 금지), 음성 `--inject-sim-impurity=direct|via-present`(케이스 32), `sim-purity` 테스트로 강제한다. 같은 최상위 디렉터리 안의 `sim → present → three`도 폐포가 잡는다(재검토 #6). 시뮬 출력은 typed array뿐, 표현은 `viewFor()`만 읽고 보간하지 않는다. 노드 헤드리스 래그돌 해시가 "표현 없이 시뮬만 돈다"의 실증이다.

### 7-7. 통합 지점

- **simSubstep**(`harness.js:108-116`): `consumeWeaponSwitch → player.update → actors.update(PHYSICS_DT, player capsule) → fire.update → fx.update → physics.step(rigid → ragdoll) → actors.postPhysics()`. `actors.update`가 `fire.update` 앞인 이유는 히트 원시가 같은 서브스텝 위치를 보게 하려는 것. 활성 0이면 빈 루프·rng 미소비. `auditStatic`은 건너뛴다.
- **renderFrame**(`harness.js:122-150`): `pipeline.render` 전에 `actorView.sync(actors.viewFor(null))`, 차폐는 `beforeRender`의 `occlusion.update`.
- **프리웜**: 프리웜 renderFrame(`main.js:354`)을 sync 포함으로((a)), `:363` 웜 렌더 앞 `prewarmAttach()`·`:364` reset 앞 `prewarmDetach()`((b), §3-8).
- **resetState**(`harness.js:236-262`): ⑤ 뒤 ⑤a `physics.ragdoll.reset()`, ⑥ 뒤 ⑥a `nav.resetToBoot()`·⑥b `actors.reset()`(슬롯 비움·컨트롤러 주차·모드 해제, 이벤트 없음), ⑪ 뒤 ⑪a `actorView.reset()`·`occlusion.reset()`(장면 변경은 `pipeline.reset` 앞), ⑫ 안 `exposure.reset()` = unlock + testOverride 해제 + snap, ⑯ 감사 리그 오버라이드 원복(등롱 후보, 더미 숨김·정적 캡슐).
- **부팅 마감**(`main.js:371-379`): `fire.reset`·`fx.reset` 옆에 `actors.reset()`, `actorView.reset()`, `physics.ragdoll.reset()`, `occlusion.reset()`, `markBootBodies` 옆에 `nav.markBoot()`·`actors.markBoot()`, `installDeathWiring`은 `bus.markBoot` 전. 부팅 상태 ≡ resetState 상태.

### 7-8. 정보 은닉

`fields.js`의 `ACTOR_FIELDS`(코드 표):

| 가시성 | 필드 |
|---|---|
| public | `slot, apparentRigId(시각 리그 출처), apparentState, apparentTeam, pos, yaw, pitch, poseParams, bones(외견 리그 16·24), dangleState, alive, ragdoll, footstepProfile(진짜 — 의도된 단서)` |
| public(별도 목록) | `occluders[] = {prims(월드, 외견 리그), n, bound}` — 액터 기록과 잇는 키 없음, `occluderKey` 순 |
| team | (P5 결정 자리) |
| owner | `hp, ammo, cooldowns, activeSkill` |
| server | `trueCharacterId, trueTeam, trueRig, modifiers, 컨트롤러 내부, 입력 버퍼, 타이머` |

- `viewFor`는 미리 할당한 View를 화이트리스트 복사로 채운다(`viewerTeam === trueTeam`이면 진짜 신원·team, 그 밖은 외견만, `null`은 public만). 표에 없는 키는 없다. `ActorView.sync`·`perception.*`는 브랜드 없는 객체에 throw.
- 차폐 소스가 액터 기록과 따로 가므로 P5에서 판 뒤 액터를 차폐 소스로만 보내는 컬링이 가능하고, 진짜와 가짜(P4C)가 한 목록 안에서 구별되지 않는다(R13).
- 테스트: 상대 팀 뷰에 public 밖 키 없음, 변장 직렬화에 진짜 id·비례 값 없음, 메시·차폐 원시가 외견 리그, 합성 가짜 소스와 진짜 레코드가 같은 키·형식이고 등록 순서를 섞어도 같은 바이트.

### 7-9. rng

P4B 액터는 난수가 필요 없다. 필요하면 `rngStream('actor:a' + slot)`을 쓸 때마다 받는다(캐시 금지, `rng.js:50-62`).

---

## 8. silhouetteaudit

### 8-1. 장면과 가드

- `setShot('hanji_silhouette')`의 계약 카메라·조명을 그대로 쓴다(`shots.js:65-78`). 새 계약 샷 없음.
- 훅 `__harness.silhouetteAuditSetup({state: 'Z'|'B'|'A', character?, appearance?, rigOf?, orient, stage?, lineup?})`(`audit-rig.js`, fixed·busy 가드, albedoAuditSetup 패턴 `harness.js:557-578`): ① 액터 전부 해제 ② 9b 전이면 더미 메시 숨김·정적 캡슐 제거(⑯ 원복) ③ A면 슬롯 0을 앵커에 `placeForAudit`(`auditStatic`, 시각 리그 `auditPose`) ④ `lantern_light_na` on/off(Z는 off) ⑤ 풀 활성 레코드 수(A면 1, 아니면 0)와 원시 수 = 외견 리그 원시 수 단언. `stage`는 `--stage-candidates` 전용(testOverride). 반환: 판 모서리·법선, 광원 위치·강도·distance·decay·intensityScale, 앵커, 판까지 거리, 무지터 proj·view·뷰포트, 배치 액터의 월드 원시·경계구, 창살 박스(세로살·가로띠), 바닥 y. **지터는 돌려주지 않는다**(setup 시점 `lastJitter`는 직전 상태 프레임 값, 재검토 #1). 배치는 이름으로 읽는다(`shots.js:30, 67` 주석은 낡음).
- `__harness.readSceneRect(rect) → {data, w, h, jitter, frame, actorRoots}`: `sceneRT`(HalfFloat, 노출·톤매핑·TAA 전, `pipeline.js:184-185, 441`) 판 영역을 동기 판독하고(선례 `getSceneHash`, `harness.js:376-386`) **판독한 그 프레임의** `lastJitter`(`pipeline.js:435`)·프레임 번호·공개 뷰 루트를 함께 돌려준다.
- `renderObjectMask({match})`(tagmask 2패스 `tagmask.js:74-108` 일반화, 캡처 뒤, 표식), `lockExposure(ev)`/`unlockExposure()`(§9).
- **정적 단계**(노드, 실패 즉시 exit 1): (s1) `checkTeamColors`. (s2) 헤드리스 `|anchor.x − pane.x| = 2.5 ± 1e-6`(PATCH-008-B). (s3) 대역 [Y0, Y1]·최고점 clip 예측(보고), 정체별 누설 영역 ∩ 유효 화소를 §8-3과 **같은 정의**(무지터 화소 중심, 창살 박스 제외)로 예측해, 0이면 게이트 실행은 exit 1, 보고 실행(`--stage-candidates`·`--reference-dummy`)은 그 정체·후보를 "판정 불가"로 기록하고 계속한다. (s4) 정체 ≥ 2, 쌍 ≥ 1. (s5) 라인업 액터별 위치–점등 등롱 거리 ≤ `distance`, 프레임 안 투영(§8-9).
- **브라우저 가드**(재검토 #5): A 상태마다 `readSceneRect` 직후 공개 뷰 루트 = 앵커 비트 동일과 `|root.x − pane.x| = 2.5 ± 1e-6`을 단언해 JSON `rootPos`·`rootEqualsAnchor`에 남긴다. 카메라 = 샷 정의도 확인한다. 어긋나면 exit 1("거리를 바꿔 통과" 금지).
- **실패 수집**: 정적 실패는 즉시 exit 1, 브라우저 단계 검사는 모두 `problems[]`에 모은 뒤 끝에 exit를 정한다(쌍 기록이 다른 실패에 가려지지 않게).

### 8-2. 상태 열거와 순서

정체 = `silhouette.audit`인 `(캐릭터, 외견 상태)`. 게이트 방향은 front·side. **diag 45°는 게이트에서 재지 않고** 단계 11 보고 실행에서만 잰다(결정 4, 재검토 #4). 상태마다 `resetState → setShot → silhouetteAuditSetup → stepFrames(90) → readSceneRect → capturePng(+captureMask)`(90 = `FIXED_STEP_FRAMES`, HARNESS.md:25-27, 같은 프레임 위상).

1. **B0**(액터 없음, 자유 적응) → `evB`. 2. 이후 `lockExposure(evB)`, JSON `exposure: {mode: 'locked', ev100, why: 'PATCH-015-E'}`. 3. **Z**(등롱 off), **B_start**(등롱 on). 4. **A(c, o)**: id 사전순 × front, side. 5. **B_end**: B_start와 HDR·PNG 바이트 동일, 아니면 exit 1 "리그 상태 누설". 6. **대조군**(016-A 본 조건, 검토 #2): 판 rect에서 `B_start − Z > 0` 화소 ≥ 1, 정체마다 `Σ(B_start − A) > 0`·`|S| ≥ 1`, 어기면 exit 1 "리그가 대상에 반응하지 않음". 보조로 B_start 판 평균 sRGB가 30/255 미만이면 경고 표식(exit 불변, 효력은 결정 5). 7. **라인업** 2상태(자유 적응, §8-9).

게이트 상태 수 = B0 + Z + B_start + A×8 + B_end + 라인업 2 = **14** + 조각 경계 B_end_k.

**이어 받기·시간 조각**(gates.sh 머리주석 규칙): `--state=FILE`은 상태별 사이드카(HDR rect·PNG 해시·evB·지터·루트)로 이어 받고 `resumed`로 기록한다. exit 75는 **`FPS_MAX_NEW_STATES=N`이 있을 때만**(새 상태 N개 뒤 그 조각의 B_end_k를 그리고 75), 없으면 끝까지 돈다. `--state` 없이 주면 exit 2(HARNESS.md:265 선례). 조각마다 새 페이지라 조각 k 마지막에 **B_end_k**를 그려 저장된 B_start와 바이트 대조한다(그 세션의 누설·조각 간 비결정을 잡음, 다르면 exit 1). 조각 k의 A는 저장된 Z·B_start로 o를 계산하고, 그 정당성을 B_end_k가 보증한다. 조각 안 실패는 조각을 끊지 않고 실패로 끝낸다(baseline 규칙).

### 8-3. 실루엣 추출 — HDR 정규화 (A-1·C-1 정정)

- 판 화소마다 HDR 휘도(Rec.709)로 `o = (B − A)/(B − Z)`, 정의역 `B − Z > 0`. `B − Z`는 점광 투과항 전체(`index.js:404-417`), `B − A`는 그 × (1 − V)이고 나머지 항은 등롱·액터와 무관하며, `sceneRT`는 TAA 전이라 화소가 섞이지 않는다. 그래서 **o = 1 − V가 정확하다.** `S = {o ≥ 0.5}`는 smoothstep 대칭점, 곧 원시 합집합의 빛 방향 기하 경계의 정의다(임계 아님).
- **누설 검사**(검토 #3, 재검토 #1): 한 풀 슬롯 기여가 **정확히 1.0**인 경우는 (가) 경계구 조기 탈출 `db > R + softB/2`(정의의 일부, §4-4), (나) 원시 단위 보수 조건 — 레코드의 **모든** 원시가 `(d − rad) ≥ soft(s)/2`(argmin도 만족하므로 smoothstep이 정확히 1, GLSL은 `x ≥ edge1`에서 1; rc는 segseg·테이퍼 최소, el은 1차 SDF, `max(soft, 0.005)`까지 미러 동일)다. **누설 검사 영역** = 판 화소 중 **판독 프레임 지터**(`readSceneRect().jitter`) 기준 네 모서리 모두에서 (가) 또는 (나)가 참인 화소(`earlyOut`·`primSafe`). 영역에서 A == B 비트 동일, 아니면 exit 1 "리그 누설"이고 위반 화소마다 네 모서리 술어 여유값을 출력한다. **비공허 = 정체마다 영역 ∩ 유효(비창살) 화소 ≥ 1**(창살 화소는 A == B가 자명하므로). 영역 밖 `o = 0` 화소는 배경(§8-7).
- **영역 크기(계산, 판 1 cm 격자, 경계구 중심 (−29.5, 2.0, −11.5))**: (가)만이면 L0에서 R 0.95 → 0.45%, R ≥ 1.00 → 0%, B에서 R 1.0 → 14.1%, 1.1 → 6.8%다. 토끼(귀 2.00 m) R ≥ 1.00, 도깨비(뿔 2.05 m) R ≥ 1.025라 L0에서 공집합이었고, 개정 1은 단계 11 L0 실측·L0 케이스 22·R3 대안을 정적 단계에서 막았다. (나)를 합치면 몸보다 굵은 근사(수직 캡슐 r 0.25·2 m)로도 L0 60.6%, B 73.1%(창살 제외 전)라 L0에서 비공허가 성립한다. 실제 크기는 (s3) 예측·브라우저 확정. 개정 1 첫 정의(경계구 + `soft_max/2` 밖)는 B에서도 공집합이었다(검토 #3).
- HDR이라 o는 노출·AgX·LUT와 독립. HalfFloat로 o 분해능 ≈1e-3(추정).

### 8-4. 좌표 변환과 유효 화소

- 판 모서리 투영으로 호모그래피를 만들어 화소 중심을 판 평면 `(u_p, y_p)`로 보낸다. `sceneRT`는 판독 프레임 지터 투영, 표시 PNG는 무지터 투영. 액터 공간 역투영 `u_a = u_L + (u_p − u_L)/m`, `h_a = y_L + (y_p − y_L)/m − y_floor`.
- 환산(계산): 판까지 4.8 m, fov 60, 1964 장치 px → 판 1 m ≈ 354 px. B: 액터 1 m ≈ 486 px, 판 위 반그림자 반폭 ≈ 18 px. L0: ≈ 607 px, ≈ 35 px.
- **창살 방향별 채움**(검토 #13): 세로살·가로띠 인스턴스(`latticeKey`, `level.js:118, 125`)를 `renderObjectMask`로 각각 2 px 팽창해 '미지'로 둔다. 세로살 미지는 같은 행 좌우 최근접 유효 화소가 모두 S면 S, 가로띠 미지는 같은 열 상하가 모두 S면 S, 교차부는 두 방향 모두 S일 때만 S. 가로띠 `HANJI_LATTICE.bands [−0.36, 0, 0.36]`(`level.js:30`)는 액터 공간 B ≈0.81/1.35/1.88 m, L0 ≈0.85/1.28/1.71 m. 폭·면적은 V 정규화 비율, 경계·끝점은 메운 마스크. 대역 클립 행(판 하단·상단) 위 경계는 돌출부 검출에서 뺀다.

### 8-5. 4축의 수치 정의

정의는 `silhouette-metrics.mjs` 한 곳, 합성 마스크 테스트로 고정, 정의 자체가 결정 4 검토 대상이다.

1. **높이 H**: S의 액터 공간 최고 행. 상단 클립에 닿으면 `clipTop`, 최고점이 가로띠 미지에 걸리면 `[띠 하단, 띠 상단]` 구간. 둘 다 clipTop이면 판정 불가, 한쪽이 clipTop·구간이면 구간 최소 차(하한)가 기준을 넘을 때만 다름. 그 밖은 `|Ha − Hb|/max > ρ`.
2. **폭 분포 W**: 자기 구간 [h0, H]를 K등분한 칸별 평균 폭(V 정규화) 벡터, `Σ|Wa − Wb|/Σ max > ρ`. **K 후보** = `floor((Y1 − Y0)/soft_actor)`(B 19, L0 10; 대안 A안 12, B안 8).
3. **상하 질량비 Q**: 자기 중점 위·아래 S 면적비, `|Qa − Qb|/max > ρ`.
4. **돌출부 P**: 무게중심에서 가장 먼 경계점(클립 행 제외, 동률 사전순), 서술자 `(|x* − c_x|, y*)`, `|P_a − P_b|/max(Ha, Hb) > ρ`. 클립 행·창살 미지 인접이면 판정 불가.

### 8-6. 쌍 판정과 예외

- 기본 외견 정체 C(n,2) × {front, side}, 통과는 다른 축 ≥ 2(**계약값**, P4-BRIEF §3-2), 판정 불가 축은 다름으로 안 센다, 미달이면 exit 1.
- **ρ = 0.15**: `VISUAL_REL_MIN`(`fx-look.js:66`, 발주자 지시 2026-09-20) 재사용 **후보**, `rule.rhoSource`에 확정 대기 기록(014-C, CONTRACT-NOTES:1991-1998). 규칙 상수는 `SILHOUETTE_RULE{rho, axesMin, K, contrastFormula, orientations, status: 'pending-owner'}` 한 곳.
- 모든 쌍·축 원값과 상대차, 상태별 판 크롭·o 맵·S 오버레이 PNG를 `--out`에 저장한다.
- **비공허**(하나라도 어기면 exit 1): 정체 ≥ 2·쌍 ≥ 1, 정체마다 `|S| ≥ 1`·`Σ(B − A) > 0`·누설 영역 ∩ 유효 화소 ≥ 1(보고 실행은 판정 불가 기록), 배경 ≥ 1, `B − Z > 0` ≥ 1, 라인업 장마다 액터별 가시 ≥ 1·s ≥ .10 ≥ 1.
- **선언 예외(P4D)**: `identicalTo`만 대칭 면제, 참조 정체가 없으면 exit 1. 선언쌍은 시각 리그가 같으므로 **판 rect HDR 바이트 동일**일 때만 면제하고, 다르면 "선언이 사실이 아님"(ρ 무관, A3). 면제 쌍도 `exempt: true`로 보고, 미선언 동일쌍은 exit 1.

### 8-7. 대비 (마스크와 독립 — A-1 정정)

표시 PNG(노출 잠금, `lin()` → Rec.709, `viewmodelaudit.mjs:56-77`)에서 잰다. `core` = S를 판 위 반그림자 반폭(`soft·m/2`)만큼 침식 ∩ 유효.

| 공식 | 정의 | 용도 |
|---|---|---|
| **C_bg**(추천) | `1 − mean(L_A[core]) / mean(L_A[bg])`, `bg = {o = 0} ∩ 대역 ∩ 유효` | 브리프 "배경 대비" |
| C_same | `1 − mean(L_A[core]) / mean(L_B[core])` | 종이 조도 경사 제거(참고) |
| C_ring | S 바깥 고리(반그림자 너머 3 cm) | 008-B .315 비교(참고) |

정체마다 선택 공식 ≥ **0.15**(계약값, CONTRACT-NOTES:1632, 공식은 결정 5). S는 HDR, 대비는 표시 공간이라 독립이고, 차폐 불가 상수항·AgX 때문에 0.15 아래로 떨어질 수 있어 검사가 의미를 갖는다. 해상도는 계약 VIEW 1512×982 dpr 2(`shots.js:17`). 기준선: 008-B .315(960×624, 공식 미상), 006-D .24–.33, 첫 실행 `--reference-dummy`(옛 캡슐을 정적 캡슐로, testOverride) 재측정값.

### 8-8. 충실도 대조 (보고 전용)

(a) 메시 투영: 노드가 `meshgen` 삼각형을 등롱 시점에서 판에 래스터화해 S와 IoU·경계 편차 p95(px). (b) 예측–실측: `occlusion-math`로 `V_pred`, `|o − (1 − V_pred)|` 평균·p95(셰이더–JS 발산·패킹 오류·마스크 버그 검출). 후보 기준 "경계 편차 p95 ≤ 판 위 반그림자 반폭"(B ≈ 18 px)은 결정 6 전까지 보고만. B_start 저주파 휘도 변동(P4-BRIEF:58)과 `--no-weapon` 몸만 축 수도 보고(무기 덕 통과 쌍 표식).

### 8-9. 팀 색 분리

**정적 검사** `checkTeamColors`(npm test `team-color`와 정적 단계 공용): 1. `TEAM_BANDS` ⊂ `paletteInBand` 허용역(`fx-look.js:112-120` import, 사본 금지). 2. 두 구간 원형 교집합 = ∅. 3. 캐릭터마다 look 레시피 색(colA..colD, `CHROMA_SCALE` 반영) 중 s ≥ 0.10인 색은 자기 팀 구간 또는 공용 대역(황 40–60, 목재·흙 20–40 s ≤ .35)에만, 상대 팀 계열(청 175–240 / 적 355–15) 0. 4. 자기 팀 색 ≥ 1. **v0 실데이터 4종 양성 케이스**를 테스트한다(검토 #8). 후보 대역 이세계 [190°, 235°], 인간계 [355°, 10°](결정 7, BRONZE 녹청 176–177°·grade cap 12–18° `grade.js:37` 회피). 창호지 너머는 색이 없으므로 실루엣 무대에서는 색을 재지 않는다.

**렌더 확인(라인업)**
- **배치**(재검토 #15): 이름 앵커 `Object3D 'actor_lineup_anchor'`(지오메트리 없음, 단계 9a, 화소 불변)를 `lantern_night`가 켜는 마당 등롱(`lantern_light_±1`, (±5, 2.45, 40), `level.js:568-593`)의 24 m 도달 안에 둔다(계약 샷 카메라와 무관). 4종을 앵커 기준 고정 간격·정면으로 세운다(`auditStatic`). 등롱 밖이면 hemi 0.05·sun 0.02(`shots.js:110-112`)에서 검게 찍혀 비공허가 거짓 실패할 수 있으므로 (s5)가 거리·투영을 단언한다.
- **카메라·노출**: `courtyard_noon`·`lantern_night` 조명을 `setShot`으로 적용한 뒤 debugCamera를 앵커 기준 고정 자세로, 노출은 **자유 적응**(계약 조건, baseline과 같음), `stepFrames(90)` 뒤 1장씩(+ `.emask.png`). 카메라·노출 모드를 JSON에 기록(PATCH-015-E). 결과 `out/silhouette/lineup/`.
- 이 디렉터리에 **paletteaudit(1.5% 계약)를 게이트 줄 `paletteauditactors`**로 돌려 PATCH-010-B "캐릭터 포함 상태"를 충족한다.
- **비공허**(검토 #12): 라인업 장마다 `renderObjectMask({match: '^actor_s<slot>_'})`로 액터별 가시 ≥ 1·s ≥ .10 ≥ 1, 미달이면 exit 1 "라인업 공허"(`paletteaudit.mjs:92-94`는 PNG 수만 본다). 팀 대역 화소 분포는 보고.

### 8-10. 음성 — 케이스 22와 정적 음성

- **`--test-clone A=B`**: B 상태에서 `placeForAudit({characterId: B, rigOf: A})`로 B의 시각 리그 전체를 A로 바꾸고 A의 부팅 메시·원시를 재사용한다(런타임 지오메트리 0). 원시가 비트 동일이라 판 rect HDR 바이트 동일, 모든 축 상대차 0(ρ 무관). testOverride `'silhouette clone A=B — harnesstest 전용, 계약 판정 무효'`, 잘못된 키는 exit 2(`fxaudit.mjs:46-71`). 축소 플래그 `--only`·`--orient`·`--dpr`·`--lineup-only`는 `--test-*`가 있을 때만, 없으면 exit 2(PATCH-001-C).
- **케이스 22**: `--test-clone tokki=kongjwi --only tokki,kongjwi --orient front --dpr 1`(6상태: B0·Z·B_start·A·A′·B_end). 통과 = exit 1 + 표식 + 쌍 `axes.length === 0`이 problems에 기록 + 타임아웃(단독 실측 × 2.5, `timedOut` 기록). 단계 11에서 L0로 구현하며, 누설 영역이 L0에서 비지 않고(§8-3) 브라우저 실패를 모은 뒤 exit를 정하므로(§8-1) 쌍 기록까지 간다.
- **케이스 31**(정적 2건): `--test-team-overlap`(TEAM_BANDS 사본 겹침 → (s1) exit 1), `--test-anchor-shift 0.5`(헤드리스 앵커 이동 → (s2) exit 1), 각각 표식·증거.
- **케이스 35**: `--test-lineup-empty --lineup-only --dpr 1`. (s5)는 계획 위치로 통과시키고 **페이지 단계에서만** 라인업 액터를 카메라 뒤로 옮겨 브라우저 단언 자체를 시험한다(`courtyard_noon` 1상태). exit 1 + 표식 + `visiblePx = 0`.
- P4D 뒤에도 케이스 22는 미선언 복제쌍이라 exit 1. `--test-undeclare`는 P4D에서 추가.

### 8-11. 출력 JSON (stdout; 로그는 stderr)

```json
{ "ok": false, "tool": "silhouetteaudit", "sha": "…", "view": {"w":1512,"h":982,"dpr":2},
  "stage": { "pane":"na_w_-3_hanji", "light":{"name":"lantern_light_na","pos":[…],"intensity":17.7,"intensityScale":1.96},
             "anchor":[-29.5,1.0,-11.5], "distanceM":2.5, "m":1.373, "band":[0.60,2.09], "softActor":0.075 },
  "run": { "fragment":1, "fragments":3, "resumedStates":[], "bEnd":[{"fragment":1,"byteIdentical":true}] },
  "exposure": { "mode":"locked", "ev100":0.0, "why":"PATCH-015-E" },
  "rule": { "rho":0.15, "rhoSource":"VISUAL_REL_MIN fx-look.js:66 — 확정 대기", "axesMin":2, "K":19, "KSource":"반그림자 유도 — 확정 대기",
            "contrastMin":0.15, "contrastFormula":"C_bg (확정 대기)", "orientations":["front","side"], "declaredPairs":"HDR byte-identical" },
  "identities": [ { "key":"tokki:default", "orient":"front", "H":2.00, "Hband":null, "clipTop":false, "W":[…], "Q":0.0,
                    "tip":{"x":0.05,"y":2.0,"invalid":false}, "areaPx":0, "sumBminusA":0.0,
                    "leak":{"regionPx":0,"regionValidPx":0,"earlyOutPx":0,"primSafePx":0,"violations":[],"predictedValidPx":0,"undecidable":false},
                    "jitter":[0,0], "frame":0, "rootPos":[-29.5,1.0,-11.5], "rootEqualsAnchor":true,
                    "contrast":{"bg":0.0,"same":0.0,"ring":0.0}, "fidelity":{"iou":0.0,"boundaryP95px":0.0,"predMeanAbs":0.0,"predP95":0.0} } ],
  "pairs": [ { "a":"jara:default", "b":"tokki:default", "orient":"front", "axes":["height","width","tip"],
               "rel":{"height":0.0,"width":0.0,"mass":0.0,"tip":0.0}, "invalid":[], "exempt":false, "byteIdentical":false, "ok":true } ],
  "team": { "ok":true, "problems":[] },
  "lineup": [ { "png":"courtyard_noon.png", "anchor":"actor_lineup_anchor", "camera":{"pos":[…],"target":[…],"fov":0},
                "exposure":{"mode":"free","ev100":0.0}, "actors":[ { "slot":0, "visiblePx":0, "chromaPx":0, "lanternDistM":null } ] } ],
  "aux": { "bStartMeanSrgb":0.0, "warnBelow30":false },
  "checks": { "anchor":true, "actorRoot":true, "camera":true, "reactsLantern":true, "reactsActor":true, "leakBstartBend":true,
              "leakRegion":true, "nonVacuous":true, "lineup":true },
  "problems": [], "testOverride": null }
```

### 8-12. CLI, 게이트 배치, 시간

- **CLI**: `node tools/silhouetteaudit.mjs [--out=DIR] [--state=FILE]`. 진단(보고 실행, testOverride 표식): `--stage-candidates`, `--reference-dummy`, `--orient-report diag`. 음성: `--test-clone A=B`, `--test-team-overlap`, `--test-anchor-shift m`, `--test-lineup-empty`(+ 축소 플래그). exit 0/1/2, 75는 `FPS_MAX_NEW_STATES`가 있을 때만.
- **gates.sh**: 현 자리표(`gates.sh:67`)는 CI 구간 밖이라 coverage MISSING이 난다(`gates.yml:34, 46`). `viewmodelaudit`(84) 뒤·`profile`(85) 앞으로 옮긴다.
  ```bash
  run silhouetteaudit    node tools/silhouetteaudit.mjs --out="$OUT/silhouette" --state="$OUT/silhouette.state"
  run paletteauditactors node tools/paletteaudit.mjs "$OUT/silhouette/lineup"
  ```
  이름은 `[a-z0-9]`만 쓴다. coverage 실패 줄 검사 `grep -qE '^[a-z0-9]+ exit=[1-9]'`(`gates.yml:173`)는 밑줄을 받지 않으므로 개정 1의 `paletteaudit_actors`가 실패해도 'FAILED STEP PRESENT'가 못 잡는다(재검토 #12). 규칙 확정 전에는 주석으로 두고(audioaudit 선례 `gates.sh:66`) P4B 종료 체인은 편입 뒤에만 돈다(결정 18). `navcheck`는 `npmtest`(74) 바로 뒤.
- **gates.yml**(재검토 #4): silhouette 구간을 **처음부터 잡 3개**로, post(:112-126)와 profilea(:128) 사이에 넣는다.

| 잡 | needs | 실행 | 산출물 |
|---|---|---|---|
| `silhouettea` | post | `FPS_MAX_NEW_STATES=5 GATES_FROM=silhouetteaudit GATES_TO=silhouetteaudit`, rc ∈ {0, 75}(baseline1a 선례 :58-61) | `$OUT/silhouette/`, `silhouette.state`, SUMMARY |
| `silhouetteb` | silhouettea | 산출물 복사 → `RESUME=1 FPS_MAX_NEW_STATES=5 …`, rc ∈ {0, 75} | 같음 |
| `silhouettec` | silhouetteb | 복사 → `RESUME=1 GATES_FROM=silhouetteaudit GATES_TO=paletteauditactors`(환경변수 없음 → 끝까지) | `paletteauditactors`가 같은 잡에서 라인업을 읽음 |

  profilea `needs`를 `silhouettec`으로. coverage(:159-179)는 `--list` 대조라 자동. 조각 크기 5(+ B_end_k)는 baseline 선례(잡당 6샷, 실측 ≈2.0–2.8 h) 여유를 따른 구현 파라미터이고 단계 11 실측 뒤 다시 정한다.
- **소요 시간 — 실측 기반**(재검토 #4 정정): baseline 샷 하나(`baseline.mjs:97-124`)는 감사 상태와 같은 절차다. 컨테이너 3 h 42 m/12(P4-LOG:38) → 상태당 ≈18.5분, CI 5 h 39 m·3 h 54 m/12(P4-LOG:56-57) → 19.5–28분. baseline은 샷마다 새 페이지를 부팅하므로(`:100`) 그만큼 과대이고, HANJI 원시 루프 비용(R1)은 빠져 있다(둘 다 미측정). 개정 1 추정 "상태당 4–12분"은 폐기한다.

| 실행 | 상태 수 | 컨테이너 | CI | 조각 |
|---|---|---|---|---|
| 게이트 | 14 + B_end_k 2 = 16 | ≈4.9 h | ≈5.2–7.5 h | CI 잡 3개 |
| 케이스 22 / 35(`--dpr 1`) | 6 / 1 | 미측정 | 미측정 | harnesstest 안 |
| 단계 11 **축소(추천)**: L0 게이트 동등 14 + diag 4 + 기준 더미 1 + B·C·D 각 (B + A front 4) | 34 | ≈10.5 h | — | 6(≤6상태 ≈1.9 h) |
| 단계 11 전체: 위 + 후보 side | 46 | ≈14.2 h | — | 8 |

  단계 11은 컨테이너 생존 창 2–4.5 h(P4-LOG:41) 안에 `--state` + `FPS_MAX_NEW_STATES`로 조각한다. Z는 등롱 off라 후보와 무관하므로 L0 Z를 공유하고, 후보 실행은 보고 전용이라 B_end를 생략한다(누설은 L0 실행이 판정). 축소안의 후보 side는 `silhouettepredict` 예측으로 대신하고, 발주자가 요청한 후보만 +4상태를 돈다. 실측 뒤 도구·케이스 타임아웃은 실측 × 2.5(HARNESS.md:270).

### 8-13. 숫자의 출처 (014-C 준수표)

| 숫자 | 쓰임 | 성격 | 출처 | 상태 |
|---|---|---|---|---|
| 2.5 m | 앵커·액터 루트–판 거리 | 계약 | P4-BRIEF §3-2, PATCH-008-B | 고정·단언 |
| 2축 | 쌍 통과 최소 축 | 계약 | P4-BRIEF §3-2 | 고정 |
| 0.15(대비) | 대비 하한 | 계약 | CONTRACT-NOTES:1632 | 고정(공식은 결정 5) |
| ρ 0.15 | 축 상대차 | 재사용 후보 | `VISUAL_REL_MIN` `fx-look.js:66` | 확정 대기 |
| o = 0.5 / o = 0 | 실루엣 경계 / 배경 | 정의 | `index.js:327-329` | 정의 |
| K, 침식 반폭 `soft·m/2`, 반그림자 반폭 | 폭 칸 수, 대비 core, 메시–판 일치 | 물리 유도(후보) | 반그림자 폭 | 확정 대기·정의·보고 |
| `> 0`(B−Z, Σ(B−A)) | 대조군 본 조건 | 정의(변화) | PATCH-016-A | 고정 |
| 30/255 | 대조군 보조 | 기존 보조 조건 | PATCH-016-A, 장부 #18 | 경고, 효력은 결정 5 |
| 누설 검사 영역 | 리그 누설 범위 | 정의(기여가 정확히 1.0: 조기 탈출 ∪ 원시 단위 `d − rad ≥ soft/2`, 판독 지터 네 모서리) | §4-4, GLSL smoothstep | 정의 |
| 바이트 동일 | 선언 예외 쌍 | 정의(시각 리그 동일의 귀결) | §2-2 | 정의 |
| ≥ 1 | 비공허(\|S\|, 배경, 누설 ∩ 유효, 라인업, 진입 파일·간선, 분리 접촉) | 하네스 규칙 | HARNESS.md:47 | 고정 |
| 1.5% / 25,000 | 라인업 팔레트 / 캐릭터 tris | 계약 | `paletteaudit.mjs:48` / PATCH-010-C | 고정(무기 포함은 결정 13) |
| 팀 대역 | 팀 색 | 후보 | 이 설계 | 확정 대기 |
| clearMax 0.34 / 0.42 | 클리어런스 상한 / 들어 올림 | 유도 / 기존 값 | `player.js:30-32` / `character.js:150-160` | 구현 |
| `H_up` | 내비 도달 상계 | 유도(jumpLadder·중력·스텝·반지름) | §5-2 4b | 구현(상계라 판정 무영향) |
| 24 m | 등롱 도달(④b 범위, 라인업 단언) | 기존 값 | `level.js:588, 601` | 사실 |
| 실측 × 2.5 | 도구·케이스 타임아웃 | 하네스 규칙 | HARNESS.md:270 | 고정 |
| 조각 크기 | CI 잡 분할 | 구현(baseline 잡당 6샷 선례) | `gates.yml` | 실측 뒤 조정 |
| ε 3 mm, 슬립 2e-4·60·720, vMax 25, 셀·청크·래더, 벌점, 이분 6회 | 구현 | 구현 파라미터 | 이 설계 | 게이트 아님 |

---

## 9. 노출 적응 동결

### 9-1. 동결 대상

`pipeline.js:51` `EXPOSURE_PARAMS` 7항과 셰이더 상수(하드 하한 오프셋 3.0 `exposure.js:85`, 목표식 계수 8 `:83`, 미터 64²·축소 8²·탭 4×4 `:25-26, 36`)를 한 객체로 묶는다: 범위 {evMin, evMax, kneeSlope, floorOffset}, 속도 {rateUp, rateDown}, 계량 {ec, centerWeight, k, meterN, reduceN, tapsPerAxis}. 계량이 바뀌면 같은 범위·속도라도 판독이 달라지므로 함께 묶는다(결정 11).

### 9-2. 방법 1 — 구조적 읽기 전용

```js
// src/render/exposure-contract.js — 동결 계약 파일. 단독 수정 금지(core/surfaces.js 머리주석 규약).
export const EXPOSURE_CONTRACT = deepFreeze({
  version: 1, status: 'provisional',                                   // 'contract' = 발주자 확정 후
  range:    { evMin: 1.0, evMax: 14.0, kneeSlope: 0.2, floorOffset: 3.0 },
  speed:    { rateUp: 3.0, rateDown: 1.5 },
  metering: { ec: 1.0, centerWeight: 0.35, k: 8, meterN: 64, reduceN: 8, tapsPerAxis: 4 },
  provenance: { values: 'pipeline.js:51 + exposure.js:25-26,36,83,85 (현재값)', evidence: ['CONTRACT-NOTES:707-712'], decided: null },
});
export function exposureContractHash() { /* FNV-1a(canonical JSON) */ }
```

- `EXPOSURE_PARAMS` 삭제(단일 출처). `ExposureMeter`의 `params` 인자 폐지(넘기면 throw, `exposure.js:112-118`). `this.params`는 frozen 뷰다. `window.__pipeline`(`main.js:368`)을 거친 대입은 호출자 코드(`page.evaluate`, 비엄격 문맥)에서 일어나므로 TypeError 없이 **조용히 무시되고** 그리기 값은 바뀌지 않는다(재검토 #11 정정). 유니폼 직접 쓰기는 `contractCheck`가 그리기 값으로 잡는다.
- `METER_FRAG`·`REDUCE_FRAG`·`ADAPT_FRAG`의 리터럴은 계약에서 템플릿으로 주입한다(값 동일, 체크포인트 ①).

### 9-3. 방법 2 — 런타임 일치 검사 (그리기 시점)

- `render()`는 매 프레임 `_applyContract()`로 계약(+ 활성 시 testOverride 층)을 유니폼에 쓴다. "조정 프로브가 params를 바꿀 수 있다" 경로(`exposure.js:155-160`)는 폐지한다.
- **그리기 시점 기록**: 드로우 직전에 그 드로우에 묶인 값을 `_drawn`에 복사한다. 미터는 `_blit(adaptMat)`·`_blit(reduceMat)` 직전(rateUp·rateDown·evMin·evMax·kneeSlope·centerWeight·잠금). **`ec`**는 미터가 아니라 블룸·출력에서 쓰이므로(`pipeline.js:489` `bloom.render(…, exposure.ec)`, `:496` `ou.ec.value`, `exposure.js:150`) 블룸·출력 드로우 직전 값을 `_drawn.ec.bloom`·`_drawn.ec.output`으로 기록한다(재검토 #11).
- `exposure.contractCheck() → {ok, version, hash, overrideActive, mismatches[]}`: 직전 프레임 `_drawn`과 **컴파일 대상 셰이더 문자열**의 템플릿 상수를 계약과 대조한다("현재 유니폼 대 계약"은 항등이라 의미가 없다, 검토 #15). testOverride 활성이면 `ok: false`.
- `getInvariants().exposure`·`__harness.getExposureContract()`로 노출. playtest `p4b_exposure_contract_ok`가 부팅 직후·resetState 후·P4B 절 스크립트 후 `ok`와 노드 해시 일치를 확인한다. baseline 사이드카에 version·hash.

### 9-4. 방법 3 — 음성

`test/exposure-contract.test.mjs`: 깊은 동결(대입 throw), 셰이더에 계약 유도 상수, 계약 키 근처 떠도는 리터럴 0(정규식 검출기 + 검출기 자체의 합성 음성), 계약 해시 = CONTRACT-NOTES 기록. playtest `--inject-exposure-drift --section p4b-exposure`: `_applyContract`를 감싸 계약을 쓴 직후 `rateUp = 9`로 바꿔 다음 드로우가 9로 그려지고 `_drawn.rateUp = 9`가 된다 → `ok = false` → exit 1 + testOverride + `mismatches ∋ rateUp`(케이스 30).

### 9-5. 측정용 잠금과 동결 훅 정리

`exposure.lock(ev)`/`unlock()`: `ADAPT_FRAG`에 `lockOn`·`lockEv` 유니폼(프로그램 수 불변), `exposure.reset()` = unlock + testOverride 해제 + snap. 잠근 도구는 `measurement = {exposure: 'locked', ev100}`를 남긴다(PATCH-015-E). `debugFreezeExposure`(`harness.js:501-504`, render no-op·리셋 불가·표식 없음·사용처 0)는 `lock(현재 EV)` + 표식으로 다시 구현한다. `debugExposureOverride(partial)`(fixed 전용)은 명시적 testOverride 층이고 `contractCheck`가 일부러 잡는다.

### 9-6. 플레이테스트 근거 (`tools/exposureprobe.mjs`, 보고 전용)

fixed 모드·계약 VIEW, 후보마다 새 페이지. E1 실루엣–노출 민감도(감사 리그, `evB` ±0.5·±1 EV 잠금에서 C·실루엣 화소). E2 실내외 전환(`lantern_night` 조명, 마당 → 내아 → 실내 EV(t) t50·t90). E3 판독 회복(밝은 마당 → `hanji_silhouette` 컷 뒤 자유 적응 C(t)가 0.15에 닿는 시간). E4 섬광·극단(트랜지언트 점광 1.5 s, `muzzleflash.js:21`, EV 하강·회복, S02 #4·S11 #5 클립·뭉개짐 비율). 후보는 현재값과 축별 변형(속도 ×0.5/×2, evMin ±1, evMax −2, kneeSlope ±0.1), 모두 testOverride. **숫자로 고르지 않고** 캡처·궤적을 본 발주자가 정한다.

### 9-7. 시점

CONTRACT-NOTES:2087("착수 전")은 구조를, P4-BRIEF:805("플레이테스트로")는 값을 말한다. ① 구현 1단계에 현재값으로 구조 동결(v1 provisional). ② **감사 리그가 생긴 뒤**(단계 11 산출물: `silhouetteAuditSetup`·`readSceneRect`·S 추출) E1–E4 실측(E1·E3은 리그가 필요, 재검토 #8). ③ **P4B 종료 전** 발주자 확정: 같으면 `'contract'`, 다르면 v2 + CONTRACT-NOTES + baseline 재기준 + **silhouetteaudit 재실행**(종료 체인 전제). P4C `spawnLight` 뒤 E4 재측정은 근거가 있을 때만 값 수정. 노출은 GPU 상태라 권위 판정에 쓰지 않는다는 원칙을 기록한다.

---

## 10. 하네스·게이트·계약 샷 영향

### 10-1. `core/harness.js`

- simSubstep·renderFrame·resetState·부팅 마감: §7-7.
- 신규 API(fixed·busy 가드): `getActorState()`(슬롯·액터 해시·래그돌·nav·occlusion·exposure), `getActorTriangles()`, `debugSpawnActor`·`debugDespawnActor`·`debugActorInput`·`debugKillActor`·`debugRayActors`, `debugNavPath`·`debugNavBlock`·`debugNavLink`·`debugNavRemove`, `silhouetteAuditSetup`·`readSceneRect(rect) → {data, w, h, jitter, frame, actorRoots}`·`renderObjectMask`·`lockExposure`/`unlockExposure`·`getExposureContract`·`debugExposureOverride`.
- `getInvariants`에 `actors.invariants()`·`exposure`, `getSceneTriangles.groupOf`(`harness.js:427-433`)에 `actor` 그룹·`byActor`, `_internal`(581)에 `actors`·`actorView`·`nav`·`ragdoll`·`occlusion`.
- compileLog 태그 수정: `598-601`의 `'SKINNING'` 탐색은 three 비트마스크 키(`WebGLPrograms.js:534`)와 맞지 않으므로 `ACTOR_` 재질 이름과 `program.name`으로 태그한다.

### 10-2. `main.js` 배선 순서

1. 재질: `createSurfaceMaterials` 안에서 `actor = createActorMaterials({synth, shared: {FABRIC, WOOD_COLUMN, EARTH_WALL, VM_POLYMER}})`를 `synth.dispose()` 전에 만들어 반환(`index.js:505-509` 선례, 재검토 #9). `main.js`(`:83`)는 `surfaceMaterials.actor` 각 재질에 `patchMaterial`과 albedo `extraMaterials` 등록만.
2. `buildWorld` → `bakeGroundAo` → `physics.build()`.
3. `NavWorld.load(...)`(파라미터·구조·클래스 throw, 기하 parity 기록), `physics.initRagdoll({slots: 6})` + 시각 리그별 `registerTemplate`.
4. `getRoster({materialKeys: Object.keys(ACTOR_RECIPES), weaponFamilies, …})`, `new ActorSim(...)`, 단언 `ACTOR_SLOTS + NON_ACTOR_OCCLUDERS_MAX ≤ HJ_SLOT_MAX && PRIMS_PER_ACTOR_MAX ≤ HJ_PRIM_MAX`.
5. `occlusion = new HanjiOcclusion()`(147-149 대체), 더미는 `addStaticCapsule`(9b에서 삭제), `actorView = new ActorView(...)`, `occlusion.addSource('actors', actorView.occluderSource)`, `createPerception(...)`.
6. `syncPaneUniforms`(~334) 뒤 `registerPane` × `hanjiPanes`(131-142), `assertPanesRegistered`.
7. `installDeathWiring(...)`(markBoot 전).
8. `applyShot`에 `shot.actors`(`auditStatic` 배치만, 즉시 포즈·원시·경계구, 샷 액션 실행기 중복 `main.js:246-253`/`harness.js:101-105`는 건드리지 않음)와 `intensityScale` 한 줄, `applyDefaultView`에 `actors.reset()`.
9. 프리웜 renderFrame(`:354`) sync 포함((a)). `:360` `applyDefaultView()` 뒤 `:363` 웜 렌더 앞 `prewarmAttach()`, `:364` `pipeline.reset()` 앞 `prewarmDetach()`((b)). `fx.prewarmSpawn`(`:339`) 옆에는 두지 않는다(환경광 없음·축소 전, 재검토 #2).
10. 부팅 마감 리셋(§7-7), `installHarness` ctx.

### 10-3. `world/level.js`, `tools/shots.js` (단계별)

- **9a**(결정 무관, 화소 불변): `Object3D 'silhouette_anchor'`(−29.5, 1.0, −11.5) 추가(더미 유지), 등롱 앵커 상대 L0 `{3.5, 2.0, 2.05}`, 세 등롱 `intensityScale = 1`, `actor_lineup_anchor`(마당 등롱 도달 안, §8-9).
- **9b**(결정 3): 더미 메시·FABRIC 콜라이더·정적 캡슐 제거. `hanji_silhouette.actors = [{slot: 0, character: 'tokki', team: 'ingan', anchor: 'silhouette_anchor', orient: 'front', pose: 'audit'}]`를 `applyShot`이 `auditStatic`으로 배치(루트·자세 고정 → 2.5 m가 계약 샷에서도 구성상 고정). audit 대상 → `{match: '^actor_s0_'}`(minAreaPct 0.5), 낡은 주석(30, 67) 정정, 재굽기.
- **12a**(결정 2): 등롱 B `{6.7, 2.0, 2.05}`, `lantern_light_na.intensityScale = 1.96`.

### 10-4. 프리웜과 프로그램

판정은 profile `compiledDuringPlayStrict`(`profile.mjs:336-345`) = 0과 playtest `p4b_actor_no_play_compile`(ready 뒤 모든 캐릭터를 띄워 렌더해도 compileLog Δ = 0). 9a에서 (b) 웜 렌더 편승만으로 통과해야 한다. 환경광이 확정된 풀해상도 웜 렌더(`main.js:360-363`)에서 컴파일하므로 설계대로 구현하면 성립한다(재검토 #2). programs 44 → ≈47(≤110), (a)·(b) 델타 실측.

### 10-5. 기존 도구 확장

| 도구 | 변경 | 음성 |
|---|---|---|
| playtest | `fullState`(249-259)에 `getActorState`. P4B 절(첫 resetState 뒤, 하위 절 `p4b-exposure`·`p4b-actor`·`p4b-ragdoll`·`p4b-nav`, 각 절은 resetState로 시작): `p4b_no_actors_at_boot`, `p4b_actor_move_finite/no_penetration/separation`(겹침 ≤1 mm, 접촉 필드·속도 불변), `p4b_actor_reset_byte_identical`, `p4b_ragdoll_final_pose`, `p4b_ragdoll_headless_parity`(보고), `p4b_nav_hash_parity`(보고), `p4b_hitbox_ray`, `p4b_occluder_pool`(6명 + 정적 캡슐 1, 초과 throw, 등록 순서 무관 바이트 동일), `p4b_nav_path`, `p4b_nav_overlay_restore`, `p4b_actor_no_play_compile`, `p4b_exposure_contract_ok`. `crates_exist = 3` 유지. **`--section <이름>`**(재검토 #3): `--inject-*`와 함께일 때만 허용, 없으면 exit 2(PATCH-001-C, silhouetteaudit 축소 플래그 규칙과 같음). 지정 절만 돌리고 testOverride 표식 | 30 `--inject-exposure-drift --section p4b-exposure`, 33 `--inject-ragdoll-rng --section p4b-ragdoll`·`--inject-actor-reset-leak --section p4b-actor`·`--inject-nav-overlay-leak --section p4b-nav`. 기존 26·28은 단계 10에서 절 의존을 확인해 가능하면 해당 절만, 의존이 있으면 전체 유지 |
| harnesstest | 새 케이스 22·30–35. **시간 조각**: `--state=FILE`(케이스별 사이드카) + `FPS_MAX_NEW_CASES=N`일 때만 exit 75(없으면 끝까지, `--state` 없이 주면 exit 2) | — |
| determinismaudit | 검사 3: §1-1 묶음별 허용 집합 + import 전이 폐포(`tools/lib/import-graph.mjs`) | 32 `--inject-sim-impurity=direct`(시뮬 파일에 three 직접), `=via-present`(시뮬 → present 간선) |
| surfaceaudit | 로스터 원시 surface ∈ SURFACES, DECAL 금지, meshgen 그룹 매핑(PATCH-010-C) | 34 `--inject-actor-unmapped` |
| shotaudit | 노드 `buildWorld`에 샷 `actors`를 `posedWorldPositions` 일반 Mesh(`actor_s0_tokki`)로, 대상 `{match: '^actor_s0_'}` | 기존 23 |
| profile | p3 예산 유지(결정 13), `byGroup.actor·byActor` 보고, 캐릭터별 ≤25,000 | — |
| baseline | 사이드카에 `actorsHash`, 노출 계약 version·hash | 기존 5 |
| distaudit | [3]에 `NAV_ASSETS`, nav parity 보고 | 기존 29 |
| chainaudit · coveraudit | 9b 더미 콜라이더 제거 뒤 재실행, 변화 기록 | — |
| pixelowner | `--hide-match <regex>`(`--hide`는 정확 일치, `pixelowner.mjs:149`) | — |
| navbake | `--check` = `navcheck` | 합성 음성은 npm test |
| HARNESS.md | 도구 표(40-54)·브라우저 표(65-66) 갱신 | — |

### 10-6. 단위 테스트 (`npm test` = `gates.sh:74`)

| 테스트 | 검사 |
|---|---|
| `actor-data` | v0 4종 + v1 4종 검증·JSON 왕복·roster 린트, src 내 id 리터럴 0, 합성 음성(미지 표면·DECAL·h<2r·r>0.34·원시 25·순환 외견·무효 identicalTo·`rigOf` 템플릿 불일치·`lookOf ≠ rigOf`·외견 팀 ≠ `rigOf` 진영·`identicalTo` 쌍 `rigOf` 불일치) |
| `actor-pose` | 결정성, NaN 0, 보행 위상 연속, dangle 결정성, `evalPose == sim 뼈`, three import 0 |
| `actor-mesh` | §3-9 |
| `actor-proxy` | ρ·K 무관 기하 불변식만: 단일 rc = 옛 캡슐 식, 합집합 이중 어둡힘 없음, `hjRcTaperMin` vs 무차별 ≤ 1e-6, 정점 \|sdf\| ≤ 1e-5, 메시 투영 경계 ⊂ 원시 투영의 ε 띠. 축 집합·IoU는 보고 |
| `hanji-occluders` | 패킹, 뷰 변환, 판 마스크 보수성(조기 탈출 정의 기준), 예약 슬롯 없음, 등록 순서 무관 바이트 동일, 초과 throw, GLSL 상수 공유, `earlyOut`·`primSafe` = 셰이더 정의. **조기 탈출 = 전체 계산은 rc 전용 레코드에서만**, el 혼합은 동일성만(재검토 #16). `primSafe` 광선에서 미러 V = 1.0 |
| `silhouette-metrics` | 합성 마스크 축 정답, `leakRegion`(네 모서리·지터·창살 제외·∩ 유효 0이면 실패), 동일 마스크 0축, clip, 창살 방향별 채움, 띠 H 구간, 미선언 동일쌍 실패, 선언쌍 바이트 동일만 면제, 비공허. ρ는 인자 주입 |
| `silhouette-predict` | v0 6쌍 × 2방향 예측 축 수(보고, 목표 ≥3), v1 28쌍, 흥부 선언쌍 원시 비트 동일(판정), 무기 제외, 정체별 누설 영역 ∩ 유효(L0·B·C·D, 보고), 조기 탈출 최대 계단(보고) |
| `team-color` | 대역 서로소·⊂ 팔레트·캐릭터 색·자기 색 ≥1, v0 실데이터 양성, 음성(겹침, 이세계 LACQUER, BRONZE 녹청 금속) |
| `actor-sim` | 이동, 분리(접촉 필드·`velocity` 바이트 불변, 접촉 ≥ 1), `auditStatic`(겹치는 정적 콜라이더 안에서도 90프레임 루트·뼈 불변, 분리 제외), 래그돌 총질량 = 진짜 `massKg`, 2회 해시 동일, reset = 신규 인스턴스, `viewFor` 은닉·변장, 브랜드 거부, `HIT_SHAPE_RULE` 두 값, 외견 A인 B 원시 = A 원시, 가짜·진짜 소스 구별 불가 |
| `actor-hitbox` | rc·el 진입/출구·노멀 vs 무차별, 구간 합집합 |
| `sim-purity` | 묶음별 허용 집합 + 전이 폐포, 합성 음성 두 벌(직접 three, sim → present) 검출·경로 출력, 진입·간선 ≥ 1 |
| `ragdoll` | §6-5 |
| `nav-calibration` | 합성 단차 0.30–1.20 m에서 클래스별 오라클 = CharacterController 실측 |
| `nav-synthetic` | 0.3/0.6/0.8 m 단(WALK/WALK/JUMP), 0.45 m 문지방·0.25 m 계단 WALK, DROP 단방향, VAULT 접두·능력 음성, CROUCH, 0.49 m 틈(r .34 차단/r .2 통과), 반지름 다른 두 클래스의 Δy 비트 차, 고체 내부 스팬 0, **내림 양자화**(0.336 m → 33 cm → r .34 차단, 양자화 점에서 측정), **상계 가지치기**(닿지 않는 경사 지붕 PRUNED, 상계 안 유지), 블로커·링크 추가·제거·복원, 블로커가 JUMP 링크·대각 간선 차단, 청크 순서 무관, 패딩 비트 동일, dangling, 힙 동률, 2프로세스 동일, 굽기 시간 기록 |
| `nav-gwana` | 산출물 structure·paramsHash, 기대값 파일(§5-8), 평탄 WALK + 클래스별 Δy > STEP_HEIGHT 층화 표본 오라클 재주행(고정 시드 mulberry32, 표본 크기는 리포트) |
| `nav-fresh` | 매니페스트 해시 ↔ 자산, `classes` ↔ 로스터 ∪ fixture 유도 표, paramsHash, structure ↔ 헤드리스(전체 재굽기는 `navcheck`) |
| `exposure-contract` | §9-4 |

### 10-7. harnesstest 케이스 (현 장부 순번 — 기존 1–21, 23–29)

| # | 내용 | 실행 범위 |
|---|---|---|
| 22 | silhouetteaudit `--test-clone tokki=kongjwi`(§8-10) | 6상태, `--dpr 1` |
| 30 | playtest `--inject-exposure-drift --section p4b-exposure` → exit 1 + 표식 + `mismatches ∋ rateUp` | 노출 절 |
| 31 | silhouetteaudit 정적 음성 2건 | 정적 |
| 32 | determinismaudit `--inject-sim-impurity=direct`·`=via-present` → 각각 exit 1 + 표식 + 위반 경로 | 노드 |
| 33 | playtest 액터 음성 3건(래그돌 rng / 리셋 누설 / 오버레이 누설), 각각 `--section` | 해당 절 |
| 34 | surfaceaudit `--inject-actor-unmapped` → exit 1 + 표식 + 원시 id | 노드 |
| 35 | silhouetteaudit `--test-lineup-empty --lineup-only --dpr 1` → exit 1 + 표식 + `visiblePx = 0` | 라인업 1상태 |

헤더 주석(`harnesstest.mjs:8-36`)과 CONTRACT-NOTES 총수 갱신, 브라우저 케이스 타임아웃은 단독 실측 × 2.5. **시간 예산**(재검토 #3): 현재 CI 2 h 42 m(P4-LOG:54, playtest 전체 음성 2회 포함). playtest 단독 ≈38분(HARNESS.md:270, `harnesstest.mjs:63`), CI ≈ 컨테이너 × 1.5(P4-LOG:59). 새 음성 4회를 전체로 돌리고 P4B 절이 26·28에 붙고 22·35가 더해지면 6.5–8 h로 360분을 넘는다. 그래서 ① 음성은 `--section`, ② `FPS_MAX_NEW_CASES` 조각, ③ 단계 10·11에서 케이스별 단독 소요를 실측해 넘치면 CI를 `harnesstesta`(1–21, 23–29)·`harnesstestb`(22, 30–35)로 나눈다.

### 10-8. 게이트 목록

새 게이트 줄은 셋: `silhouetteaudit`(P4-BRIEF §7), `paletteauditactors`(기존 도구를 라인업 입력으로, 도구 논리는 음성 12·20, 입력 공허는 라인업 단언·케이스 35가 덮는다, 이름은 coverage 정규식에 맞춤), `navcheck`(npm test 전체 재굽기의 자리 이동). 나머지는 기존 줄의 확장이고 체인은 순차다. 렌더 도구는 `git stash create` 스냅샷을 서빙하므로(`pinned.mjs:23, 63-64`) 렌더 게이트 전에 반드시 커밋한다.

### 10-9. 계약 샷 영향과 비트 동일 체크포인트

| 체크포인트 | 시점 | 기대 |
|---|---|---|
| ① | 노출 계약 구조화(단계 1) | 12샷 = 기준 |
| ② | 차폐 v2(단계 2, 더미 = 정적 캡슐 rc ra=rb=0.28) | 12샷 = 기준, programs 44. 깨지면 차이 샷·HDR 최대 차 보고 |
| ③ | 재질·풀·내비 배선(단계 8, 활성 0, 더미 유지) | 12샷 = 기준 |
| ③b | 통합 배선(9a: 앵커·라인업 앵커, 등롱 L0 상수, intensityScale 1, 웜 렌더 프리웜) | 12샷 = 기준 |
| ④a | 샷 3 교체(9b, 결정 3, L0) | `hanji_silhouette` 변경(승인). 11샷 = 기준, 바뀌면 imagediff 보고 |
| ④b | 조명(12a, 결정 2) | **`hanji_silhouette`만 변경**(승인), 11샷 = ④a. 24 m 컷오프라 `lantern_night` 무영향(§4-7, 재검토 #14) |

**측정 도구와 시간**(재검토 #4): 기준은 착수 커밋의 `baseline.mjs --resume` 산출물 1벌이다. 체크포인트마다 12샷을 찍어 `imagediff`(tol 0)로 기준과 비교하고 오디오 해시·programs도 대조한다. 12샷은 컨테이너 3 h 42 m(P4-LOG:38), CI 3 h 54 m–5 h 39 m(P4-LOG:56-57)이고, 생존 창 때문에 `FPS_MAX_NEW_SHOTS` 조각·`--resume`으로 돈다(CI면 baseline1a·b 구간). 실행은 기준 + ①②③③b④a④b = 7회(컨테이너 ≈26 h)다. 화소 불변이 기대인 이웃(①+②, ③+③b)은 뒤쪽 커밋에서 한 번만 재도 되고 실패하면 앞쪽에서 다시 재 원인을 가른다(5회, ≈18.5 h). ④a·④b는 합치지 않되, 결정 2·3이 함께 나오면 한 커밋으로 baseline 재기준을 한 번으로 줄일 수 있다. 샷 수 12 유지(`harnesstest.mjs:558`), 바뀐 샷은 발주자가 검토한다.

### 10-10. 예산 요약 (현재 → 예상, 추정)

| 지표 | 계약 | 현재 | 예상 |
|---|---|---|---|
| 캐릭터 1종 tris | ≤25,000 | — | 6.5–9k |
| `tris_scene` | ≤600k | 135,622 | 샷 3 +6.5k, 2:2 ≈166k |
| `tris_frame_p95` | ≤250k | 122,610 | ≤≈153k |
| programs | ≤110 | 44 | ≈47(+태그 2, 캡처 뒤) |
| 플레이 중 컴파일 | 0 | 0 | 0 |
| drawCalls | ≤900 | 480 | 액터당 ≤6 |
| boot_cpu | ≤3 s | — | 팀 변형 합성 ≈5종 + 내비 로드(수 ms) + meshgen(수십 ms), 웜 렌더 편승은 `warm_render+reset`으로 따로 — 실측 |
| cpuFrameMsP95 | 6 ms | 2.1 | 래그돌 4 × 2 서브스텝 + 차폐 CPU — 실측 |

---

## 11. 발주자 결정 사항 (추천안 포함, 014-C)

> **판정 기록 (2026-10-09)**: **#14 승인 · #1 승인** (추천안 그대로, `docs/CONTRACT-NOTES.md` 「P4B 착수 전 스캔」 아래 발주자 판정). 아래 표에서 이 두 결정이 '막는 단계'로 적힌 곳은 모두 풀렸다. 남은 막힘은 #3(9b) · #2(12a) · #4·#5·#7·#18·#20(12b) · #11(13)이다.

결정 대기 항목은 후보 상태로 넘긴다. "막는 단계" = 그 결정 없이 **병합·확정하면 안 되는** §13 단계(개발 브랜치 작업은 막지 않음), "막지 않는 단계" = 후보값으로 진행해도 되는 단계다. **막는 단계는 §13 선행 그래프의 전이 폐포로 셌다**(재검토 #8, 스크립트로 검산). 선행 그래프(X ← Y = Y가 먼저):

```
1←0  2←1  3a←0  3b←3a  3c←3a  3d←{2,3b,3c}  4←{3a,3b}  5←3a  6←{2,3a}  7←4
8←{3c,4,6}  9a←{4,5,7,8}  9b←9a  10←9a  11←{9a,3d}  12a←11  12b←11(12a가 있으면 그 뒤)
13(측정)←11  14←{9b,10,12a,12b,13}
```

직접 막는 관계: #1 → 2(병합)·8, #14 → 2(`src/actors/sim/occlusion-math.js`)·3a·3b·3c·4·8, #3 → 9b, #2 → 12a, #4·#5·#7·#18·#20 → 12b, #11 → 13(확정). 14는 최종 상태를 재므로 이 결정들이 모두 정해져야 한다(수용이든 반려든).

| # | 결정 | 추천안 | 근거 | 성격 | 막는 단계(전이 포함) | 막지 않는 단계 |
|---|---|---|---|---|---|---|
| 1 | 창호지 차폐 모델 개정(PATCH-008-B 확장) | rc/el 원시, 액터 내부 min 합집합, 풀 8 × 24 텍스처(예약 없음, 정체 무관 순서), 판별 마스크, 조기 탈출(정의의 일부), 초과 throw, 매 프레임 재구성, 메시 강체 스키닝, castShadow=false·프로그램 수 유지, 큐브맵 기각 | 불투명 판이라 프록시만 실루엣을 만든다(`hanji.js:34`). 같은 데이터라야 일치가 구성으로 보장된다. 큐브맵은 전 조명 키 변경(CONTRACT-NOTES:1151 번복). 고정 슬롯은 가짜 표식(P4-BRIEF:796) | 계약 구조 | 2(병합), 3d, 6, 8, 9a, 9b, 10, 11, 12a, 12b, 13, 14 | 0, 1, 3a, 3b, 3c, 4, 5, 7 |
| 2 | 조명 구성(P1 배치) | 후보 B(x −22.8, 판 뒤 9.2 m, 높이 2.0, `intensityScale` 1.96). L0·B·C·D 캡처를 나란히 보고 확정. 화소 변경 승인은 `hanji_silhouette` 한 장 | L0 대역 0.68–1.875라 귀·뿔이 잘린다. 깊이만이 폭·선명도를 함께 개선. 실루엣 ≈20% 축소 대가(008-B 1.7× 판단 갱신). 24 m 컷오프라 `lantern_night` 무영향(§4-7) | 후보(기하) | 12a(④b), 14 | 0–11, 12b(L0로 진행, B면 12a 뒤 재실측), 13. 개정 1에서는 L0 누설 영역 공집합 때문에 사실상 12b도 막았고(재검토 #1) §8-3으로 해소 |
| 3 | 샷 3 더미 → 액터 | 교체(P4-BRIEF:70 S03 #2). 더미 메시·콜라이더·정적 캡슐 제거, `silhouette_anchor`, `auditStatic` 배치, 토끼(가장 가는 돌출부) 정면. 대안 콩쥐 | baseline·shotaudit·chainaudit·coveraudit 재측정과 재굽기를 한 커밋으로 | 계약 샷 변경 | 9b(④a), 14 | 0–9a, 10, 11(리그가 더미를 숨김), 12a, 12b, 13 |
| 4 | 4축 정의·ρ·K·자세·방향·무기 | §8-5 정의, ρ = `VISUAL_REL_MIN` 0.15 재사용, K 반그림자 유도(B 19, L0 10), 자세 `low_ready`(무기 포함, 시각 리그 항목), 정면 + 측면 게이트, 45°는 단계 11 보고만, 무기 제외는 노드 보고 | 브리프는 축 이름만 정했다. 임계 발명은 014-C 오류 반복(CONTRACT-NOTES:1991-1998). 측면 없으면 등껍질·방망이를 놓친다 | 정의 + 재사용 후보 | 12b, 14 | 0–11(원값 보고, 케이스 22 0축은 ρ 무관), 12a, 13 |
| 5 | 대비 공식·해상도·기준선·30/255 효력 | C_bg(노출 잠금 명시), 계약 VIEW dpr 2, C_same·C_ring 병기, 기준선 008-B .315 + `--reference-dummy`, 0.15 계약값, 30/255는 경고 | 공식·해상도가 어디에도 없고 008-B 프로브는 미커밋. 016-A는 30/255의 판정 효력을 적지 않았다 | 공식 확정 | 12b, 14 | 0–11, 12a, 13 |
| 6 | 메시–판 일치를 게이트로? | 보고 전용(IoU, 경계 p95, 예측–실측), 후보 "p95 ≤ 반그림자 반폭" | 새 임계 | 새 임계 | 없음(게이트로 두면 12b에 줄 추가) | 전부 |
| 7 | 팀 대역·판정 단위·등껍질·무기 금속 | 이세계 [190°, 235°], 인간계 [355°, 10°], §8-9 규칙 3·4, 단청 팀 변형 2종, 등껍질 `ACTOR_BRONZE_ISEGYE`(≈200°) + 청 띠(대안 LACQUER 흑칠), 무기 `ACTOR_METAL` 무채(대안 팀별 금속 +2 합성) | LACQUER는 적 대역(4–8°), BRONZE 녹청 176–178°는 어느 팀 규칙도 불통(검토 #8), DANCHEONG은 청·적 혼재 | 후보 | 12b(`paletteauditactors` 편입), 14 | 0–11(6은 후보값), 12a, 13 |
| 8 | 반경 상한과 이동 클래스 | `radius ≤ 0.34` + 클래스별 오라클 비트(굽기 1회). 대안: 전원 0.34 단일 | 내아 동문 0.7425 m, 등반 한계 ≈0.42 + r(검토 #5). 클래스 방식이 단일 반경을 포함 | 재사용 + 구조 | 없음 | 전부 |
| 9 | 액터 탄도 표면 | v0 hitbox 전부 `FABRIC`, DECAL 금지, 새 표면 없음 | BRONZE(BLOCK)면 몸이 차단물(§4-1-C·D 충돌), `surfaces.js` 동결 | 후보 | 없음 | 전부 |
| 10 | FABRIC 직조 스케일(P3-DEBT 181-190) | 액터 `'uv'` 클론의 `tileMeters`, 셀 4/6/8 mm를 0.6·2.5 m 캡처로 | 공용 변경은 baseline·paletteaudit 파급 | 후보 | 없음(14 보고 전 확정 권장) | 전부 |
| 11 | 노출 동결 범위·값·시점 | 계량 포함 전항 구조 동결(v1 provisional), E1–E4 뒤 **P4B 종료 전** 확정(바뀌면 재기준·silhouetteaudit 재실행) | §9-7, 근거는 EC·무릎뿐(CONTRACT-NOTES:707-712) | 값 확정 | 13(확정), 14 | 0–12b, 13(측정) |
| 12 | P1 결함(객사 서측 0.49 m 틈, 누각 난간 `nu_rail_x_-1`, 관찰: 내아 동문) | 앞의 둘은 P1 미세 예외로 수정(주석 의도 '서측 진입' 372, '계단 개구부' 486), 수정 전 내비는 섬·JUMP 기록, 동문은 관찰 | 수정 시 재굽기·nav-expect 의도 갱신 | P1 판단 | 없음 | 전부 |
| 13 | 3인칭 무기의 25k 포함·profile phase | 포함(보수), 몸 ≤12k, p3 유지 + actor 보고 | PATCH-010-C·011-C 미명시 | 해석 | 없음(보수 해석) | 전부 |
| 14 | 디렉터리 소유권(ARCHITECTURE §1)·주입 | `src/actors/{data, sim, present}` 신설, `src/ai`·`physics/ragdoll.js`는 기존 행, 룩은 materials, 디렉터리 간 import 0·주입, `src/actors` 안은 하위 디렉터리 허용 집합 + 전이 폐포, 예외는 허용 간선 표 | §1 표에 `src/ai`·physics는 있고 액터 행만 없다(A1). §3 직접 import 금지(:155), 주입 선례 `audio/index.js:4` | 계약 구조 | 2, 3a, 3b, 3c, 3d, 4, 5(3a 경유), 6, 7(4 경유), 8, 9a, 9b, 10, 11, 12a, 12b, 13, 14 | 0, 1(단계 0에서 가장 먼저 요청) |
| 15 | 변장 규칙·히트 형상(P4D 전) | 외견 = 시각 리그(`rigOf`, 룩·감사 자세 포함, `lookOf = rigOf`), 진짜 = 캡슐·이동·발소리·총질량·체력·무기·스킬, 히트 `'apparent'`. 대안 `'true'` | 형상만 바꾸면 도깨비 윤곽이 안 나온다(검토 #1). 간파 단서를 브리프 목록(:482-486)으로 한정하려면 골격·보행·히트가 외견을 따라야 한다. 흥부 강화(:470)는 이동을 안 바꾼다 | 규칙 | 없음(두 규칙 모두 지원) | 전부 |
| 16 | 노드–크롬 비트 동등성을 게이트·부팅 throw로? | 보고만, 내비 기하 해시는 반복 일치 뒤 승격 검토, throw는 정수 지문·파라미터 해시만 | V8 마지막 비트(추정), 선례 없음 | 게이트 여부 | 없음 | 전부 |
| 17 | 오디오 우회 그래프 주입 시점 | P4B는 어댑터·테스트만, 주입은 P4C 청감 판정과 함께 | 오디오 해시 변경, audioaudit 판정 대기 | 시점 | 없음 | 전부 |
| 18 | 새 게이트 줄 편입 시점 | `silhouetteaudit`·`paletteauditactors`는 4·5·7 확정 직후 `gates.sh`·`gates.yml`(silhouette 잡 3개)에 편입, 종료 체인은 편입 뒤에만. `navcheck`는 단계 7 | 미확정 규칙의 체인 결과는 계약 판정이 아니다(audioaudit 선례) | 시점 | 12b, 14 | 0–11(7의 navcheck 포함), 12a, 13 |
| 19 | 기하 원천: 절차 vs 010-A 임포트 | P4B는 절차 원시. 에셋은 "원시 맞춤 + 투영 일치 보고" 조건 | §3-1과 010-A가 다르게 말한다 | 범위 | 없음 | 전부 |
| 20 | 판에 투영되지 않는 윤곽 특징(콩쥐 치마단) | 대역 안 퍼짐 경향(B 0.60–1.20 m, 0.32 → 0.62 m)으로 판정. 대안 (가) P1 머름·판 조정 (나) 재정의 (다) 측정 범위 | m > 1이면 발은 늘 판 아래(§4-7), 최대폭 0.84 m(바닥)는 투영 불가(검토 #20) | 계약 해석 | 12b, 14((가)면 12b에 레벨 변경·재굽기) | 0–11, 12a, 13 |

**요청 순서(추천)**: 단계 0에 #14·#1(막는 단계가 가장 많음), 9b 전에 #3, 단계 11 보고와 함께 #2·#4·#5·#7·#18·#20, 단계 13 측정 뒤 #11. 나머지는 후보로 진행하고 종료 보고에서 확인받는다.

---

## 12. 위험

| # | 위험 | 완화 |
|---|---|---|
| R1 | SwiftShader에서 HANJI 원시 루프(≤ 24 × texelFetch)가 샷 3·감사 시간을 늘린다 | 판 마스크·조기 탈출·0색 광원 건너뛰기, 실측 × 2.5, §4-6 폴백(보고) |
| R2 | 체크포인트 ②가 JIT 코드 생성 차이로 깨진다 | argmin 쌍 연산 형태 유지, 깨지면 차이 샷·HDR 최대 차 보고·승인 |
| R3 | 조명 이동 반려 시 대역이 0.68–1.875에 묶여 높이 축 포화(귀·뿔 clipTop) | 나머지 3축 중 2축 설계(데이터만 수정), clip 보고, 거리·카메라 불변. 누설 영역은 L0에서도 비지 않아(§8-3) 게이트 판정은 성립한다 |
| R4 | 4축이 v0를 실제로 가르는지 미측정(귀·뿔 모두 상단 돌출) | silhouettepredict 사전 확인(목표 ≥3축), 원값·오버레이 제출, 정의 자체가 검토 대상 |
| R5 | three 지연 생성(`computeBoneTexture`, 버퍼 업로드)으로 첫 스폰 시뮬 창 오류·히치 | 부팅 선호출 + 웜 렌더 편승 프리웜 + `p4b_actor_no_play_compile` |
| R6 | 프리웜 누락으로 플레이 중 컴파일(키에 `scene.environment` 포함, `fx.prewarmSpawn` 시점엔 환경광 없음, 재검토 #2) | 환경광 확정 뒤 풀해상도 웜 렌더 편승(`main.js:360-364`) + (a) sync, 놓치면 `applyShot(shots[0])` 뒤 훅, 재질 공장 단일화, compileLog 태그 수정, (a)(b) 분리 실측 |
| R7 | 풀 메시 상주 시 `tris_scene` 초과(비가시도 집계) | 스폰할 때만 add, 부팅 그룹 집계 0 단언 |
| R8 | 내비 산출물 낡음·비대 | 부팅 throw(구조 지문·파라미터 해시), `navcheck`(재굽기 바이트 동일), parity 보고, 청크 바이너리, P1 수정마다 재굽기 커밋 |
| R9 | 래그돌 CPU(4체 × 2 서브스텝 + 입자 raycast)가 `cpuFrameMsP95` 6 ms 압박 | `queryAabb` 1회, 빠른·강제 슬립, 실측, 필요하면 클램프 raycast를 변위 > 1 mm 입자로 한정(불변식 유지) |
| R10 | `movement.js`와 `player.js`가 갈라진다 | 같은 상수 데이터화, 오라클이 같은 함수 주입, P5에서 통합 |
| R11 | 시각 원시가 캡슐보다 넓은 캐릭터(자라 0.84, 도깨비 0.80, 콩쥐)가 좁은 개구에서 관통해 보이고 판 반대편에 비친다 | 돌출량 보고, 래그돌 초기 클램프, P4C 플레이테스트, 결정 12 관찰 |
| R12 | rc+el로 표현 못 하는 v1 윤곽 | v1 fixture로 지금 시험, 부족하면 원시 종류 추가를 보고 |
| R13 | 판 부착 가짜 실루엣의 **위치**, 판 뒤 액터의 **짝 없는 차폐 소스**로 가짜가 드러날 수 있다 | 슬롯 표식은 구조로 제거(§4-5), 차폐 소스는 별도 목록(§7-8), 나머지는 P5 가시성 컬링·P4C 배치 규칙 |
| R14 | 노드·Chromium V8 차이로 래그돌 해시 상이 | 보장 범위를 같은 엔진 재현성으로, 동등성은 보고(결정 16) |
| R15 | CI 시간: silhouette 16상태 ≈5.2–7.5 h, harnesstest 6.5–8 h 추정(360분 초과), statics(120분)에 npmtest·navcheck·playtest P4B 절 증분 | silhouette 잡 3개(§8-12), `--section`·`FPS_MAX_NEW_CASES`·잡 2개 분할(§10-7), 22·35는 `--dpr 1`, 단계 7 건식 집계, statics 타임아웃을 (기존 + 증분) × 2.5로 재산정하고 360분을 넘으면 조각(b7be613 선례) |
| R16 | 등롱 변경이 다른 계약 샷을 바꾼다는 우려 | 24 m 컷오프, `lantern_night` 시야 ≥ 47.5 m(§4-7). ④b 기대 = 샷 3만 변경, imagediff 확인 |
| R17 | 레시피 기준 팀 색 검사는 등롱 온색·AgX 뒤 실제 색을 못 본다 | 라인업 paletteaudit 1.5%(비공허 포함), 액터별 히스토그램, 한도 대신 색을 고친다 |
| R18 | P4C 런타임 표면(자라 GRANITE 벽)이 차폐에 미등록 | P4C에서 상자 원시·풀 소스 검토(`NON_ACTOR_OCCLUDERS_MAX` 재산정) |
| R19 | 범위 과대(새 시스템 5 + 차폐·노출 개정) | 체크포인트 6개, materials·render 단일 오너 순차, 노드 병렬 트랙(§13) |
| R20 | W1이 창살을 바꾸면 측정이 달라진다 | 창살을 레벨에서 읽음, 재실행 규칙(P4-BRIEF:50), 현 창살 기준 명시 |
| R21 | 변장 시각 리그와 진짜 캡슐 불일치(도깨비 2.05 m 대 흥부 캡슐) | 루트는 발 기준, `rigOf` 쌍 돌출 보고, R11과 같은 처분 |
| R22 | 클래스 수만큼 오라클 증가, 지붕 Δy 간선 폭증(재검토 #17) | 건식 집계 선보고, 도달 상계 가지치기(§5-2 4b), 굽기 실측을 R15에, 결정 8 대안은 클래스 축소 |
| R23 | 가로띠에 걸린 최고점·돌출부는 판정 불가로 축 감소 | 보수 구간 규칙, 띠 걸림 보고, 사전 예측 |
| R24 | 누설 영역 경계 화소에서 GPU float32와 미러 float64가 갈려 A ≠ B 거짓 실패 | 위반 화소마다 네 모서리 술어 여유값 출력, 정밀도 수준이면 조용히 넘기지 않고 보고(여유를 수치로 두면 새 임계라 하지 않음) |
| R25 | silhouette 조각 사이 HDR이 비트 동일하지 않음 | 조각마다 B_end_k 바이트 대조(어긋나면 exit 1), 컨테이너에서 무조각 대조 실행. 근거: 다른 러너의 base1·base2 imagediff 25행 비트 동일(P4-LOG:58), HDR 러너 간 동일성은 미측정 |
| R26 | P4C 런타임 링크가 PRUNED 스팬에 닿으면 Δy 비트가 없다 | PRUNED 수·분포 리포트, P4C `spawnSurface` 설계에서 재굽기·시드 추가 검토 |

---

## 13. 구현 순서 (병렬 가능 단위와 검증)

**병렬 규칙**: materials·render(1, 2, 6)는 단일 오너 순차(ARCHITECTURE:52-61). 노드 트랙(3a–3d, 4, 5, 7)은 의존이 허락하는 한 병렬. 렌더 도구 전에 반드시 커밋. 단계 11은 보고로 끝나고 12는 결정 뒤 시작한다(016-B). "막는 결정"은 §11과 같은 전이 폐포이고 **굵게** = 직접, 나머지 = 선행에서 물려받음(재검토 #8).

| 단계 | 내용(주요 파일) | 선행 | 막는 결정 | 검증 |
|---|---|---|---|---|
| 0 | 스캔 보고·결정 요청(#14·#1 먼저), ARCHITECTURE §1 개정안, 체크포인트 기준 baseline 1회 | — | — | 결정 기록 행, 기준 산출물 보관(§10-9) |
| 1 | 노출 계약 구조 동결, lock/unlock, 그리기 시점 기록(미터·블룸·출력 `ec`), testOverride, 동결 훅(`exposure-contract.js`, `exposure.js`, `pipeline.js`, `harness.js`, playtest `--inject-exposure-drift`·`--section`, 케이스 30) | 0 | 없음(11은 값만) | **①**(②와 합침 허용), 케이스 30 exit 1 + 그리기 시점 rateUp, 계약 해시 기록 |
| 2 | 차폐 v2(텍스처, 합집합, 테이퍼 최소, 판 마스크, 조기 탈출 정의, 풀·정렬, 정적 캡슐 = 더미, throw, 0색 건너뜀; `hanji-occluders.js`, `materials/index.js`, `main.js`, `src/actors/sim/occlusion-math.js`) | 1 | **1**(병합)·**14** | **②**, programs 44, 등록 순서 무관 바이트 동일, rc 조기 탈출 보수성 |
| 3a | 스키마(`rigOf`·`lookOf = rigOf`·외견 팀·auditPose)·limits·biped·v0 4종·roster·v1 fixture | 0 | **14** | 8종 검증, 음성 fixture throw, id 리터럴 0 |
| 3b | pose·rig·hitbox | 3a | **14** | 결정성, 무차별 대조, `evalPose == 뼈`, 외견 A인 B = A 비트 동일 |
| 3c | meshgen·삼각형 예산 | 3a | **14** | §3-9 |
| 3d | 실루엣 지표(창살·띠·누설 영역), silhouettepredict, 조명 후보 예측표 | 2·3b·3c | 1, 14 | 합성 정답, L0·B·C·D 예측표(보고), v1 28쌍, **정체별 누설 영역 ∩ 유효 > 0(L0 포함)**, 조기 탈출 계단 보고 |
| 4 | ActorSim(`auditStatic`), movement, separation + `slideHorizontal`(스냅샷·복원), controllers, fields, `import-graph.mjs` | 3a·3b | **14** | 분리 ≤1 mm·접촉 필드·속도 불변(접촉 ≥ 1), `auditStatic` 불변, 해시·reset 동일, 은닉, 전이 폐포(음성 2벌) |
| 5 | PBD 래그돌(초기 클램프, 질량 분율 + 진짜 massKg), 파사드, 사망 배선 | 3a(합성 템플릿으로 먼저 개발) | 14 | §6-5(슬립은 보고만), 총질량 = 진짜 |
| 6 | 액터 룩·팀 대역·매니페스트, `createSurfaceMaterials`의 `actor` 반환 | **2(단일 오너)·3a**(v0 실데이터 양성) | 1, 14(7은 후보로) | team-color 양성 + 음성, fxaudit 초록, boot_cpu 증분 |
| 7 | 내비 전체(클래스 오라클, 패리티 열, 들어 올린 캡슐, 내림 양자화, 상계 가지치기), 경내 굽기(더미 포함), `navcheck` | 4 | 14(8·12는 데이터) | **첫 작업: 건식 집계 보고**, navbake 리포트(섬·JUMP·VAULT 0·고체 내부 0·열린 메시·클래스·PRUNED·굽기 시간), nav 테스트, `navcheck` 소요 |
| 8 | meshbuild, ActorView, 풀, `prewarmAttach/Detach`, 차폐 소스, perception | 3c·4·6 | **1**·**14** | **③**(③b와 합침 허용), 부팅 actor 그룹 0, `getErrors` 비어 있음 |
| 9a | 통합 배선(simSubstep·renderFrame·프리웜 (a)(b)·resetState·부팅 마감·디버그 훅), 앵커·라인업 앵커·등롱 L0 상수·intensityScale 1, shotaudit·surfaceaudit, playtest P4B 절(하위 절 4) | 4·5·7·8 | 1, 14 | **③b**, playtest exit 0, (b)만으로 컴파일 0, (a)(b) 델타·`warm_render+reset` 증분 기록 |
| 9b | 샷 3 액터(L0, `auditStatic`), 더미 제거 → 재굽기, baseline·shotaudit·chainaudit·coveraudit 재측정 | 9a | **3**, 1, 14 | **④a**, navcheck·nav-fresh, nav-expect 갱신 |
| 10 | determinismaudit 검사 3(폐포), surfaceaudit, playtest 음성 `--section`, harnesstest 시간 조각(32·33·34) | 9a | 1, 14 | 음성 exit 1 + 표식 + 증거, 케이스별 단독 소요 실측, 26·28 절 의존 결과, CI 분할 여부 결정 |
| 11 | silhouetteaudit 리그·도구(누설 영역, 루트 가드, 실패 수집, 조각 규칙), `--stage-candidates`·`--reference-dummy`·diag, 케이스 22·31·35, 1차 실측(축소 계획 34상태) → **정지·보고** | 9a·3d | 1, 14 | 정적 단계 통과(L0 누설 영역 ∩ 유효 > 0), 016-A 대조군, B_end(조각마다), 누설 비트 동일, 루트 = 앵커, 라인업 비공허, 22(L0 쌍 0축)·31·35 exit 1, 캡처·o 맵·원값 제출(숫자로 고르지 않음), 상태당 소요 → 조각 크기 확정 |
| 12a | 등롱 B·intensityScale 1.96 → 재실측 | 11 + 결정 | **2**, 1, 14 | **④b**(샷 3만 변경, 11샷 imagediff), 루트 2.5 m |
| 12b | 규칙 반영(SILHOUETTE_RULE, 팀 대역, 대비 공식, 콩쥐) → 재실측, 체인·CI 편입(silhouette 잡 3개) | 11(12a가 있으면 그 뒤) | **4·5·7·18·20**, 1, 14 | 양성 exit 0(6쌍 × 2방향 ≥2축, 대비 ≥0.15, 루트 2.5 m), 실패 시 데이터·조명 재검토(거리 불변), `--list`·coverage 이름 일치, 라인업 ≤1.5%, 타임아웃 실측 × 2.5 |
| 13 | 노출 E1–E4 → 발주자 값 → status/version | 측정 **11**(감사 리그 필요), 확정은 12와 병렬 | **11**, 1, 14 | 제출 → 반영, 바뀌면 재기준 + silhouetteaudit 재실행, 케이스 30 exit 1 유지 |
| 14 | 종료 체인·보고 | 9b·10·12a·12b·13 | **1·2·3·4·5·7·11·14·18·20** 모두 정해짐 | 고정 스냅샷 ALL GREEN(coverage 포함), baseline 2회 비트 동일, 보고(구별도·대비, 노출 근거, v1 결과, 한계 R11·R13·R21·R24·R26, 계약 모호 신규분), 실 GPU 1회 실측 요청 |

---

## 부록 R — 검토 반영표

### R-1. 개정 2: 재검토 17건

모두 코드·계약 원문으로 확인하고 반영했다(완전 반박 0). #10의 필드 분리 제안은 대안을 택했다. 지적의 줄 번호 중 현행과 어긋난 것은 보정했다(#2, #11).

| # | 등급 | 조치(확인 근거) | 위치 |
|---|---|---|---|
| 1 | 치명 | 지적값 재현(L0 R 0.95 0.45%, R ≥ 1.0 0%; B R 1.0 14.07%, 1.1 6.84%). 누설 영역 = 경계구 조기 탈출 ∪ 원시 단위 보수 술어 `primSafe`(모든 원시 `d − rad ≥ soft(s)/2` → smoothstep 정확히 1), 판독 프레임 지터의 네 모서리. 굵은 근사(캡슐 r 0.25·2 m)로도 L0 60.6%·B 73.1%(계산). 비공허 = 영역 ∩ 유효 ≥ 1. (s3) 같은 정의, 보고 실행은 "판정 불가". `readSceneRect`가 지터·프레임 반환(setup 반환에서 제거). 브라우저 실패 수집 뒤 exit. R3·결정 2 갱신 | §0-7, §1-2, §2-6, §4-8, §8-1, §8-3, §8-6, §8-10, §8-11, §8-13, §10-6, §11 #2, R3·R24, §13 3d·11 |
| 2 | 중대 | 확인 `main.js:339`(fx.prewarmSpawn) < `:343`(축소), 환경광 `renderer.js:57-62` → `sky/index.js:149, 290`, `prewarm.js:41-44`, `fx/index.js:109-116`(지적의 :341·:345·:364·:365 → 현행 :339·:343·:363·:364). (b)를 `:360` 뒤 `:363` 웜 렌더 편승(`prewarmAttach`, `frustumCulled=false`) → `:364` 전 detach, 렌더 호출 증가 0, 폴백 훅, (a)(b) 분리 실측 유지 | §0-10, §1-2, §3-8, §7-7, §10-2·10-4·10-10, R5·R6, §13 8·9a |
| 3 | 중대 | 확인 P4-LOG:54·59, HARNESS.md:270, `harnesstest.mjs:63`. playtest `--section`(`--inject-*` 동반만, 아니면 exit 2, PATCH-001-C), 30·33은 해당 절만, harnesstest `--state`·`FPS_MAX_NEW_CASES` 조각, 실측 뒤 harnesstesta/b 분할, 26·28 절 적용 검토 | §0-10, §10-5, §10-7, R15, §13 1·10 |
| 4 | 중대 | 확인 `baseline.mjs:97-124`(:100 샷마다 부팅), P4-LOG:38·41·56-57, gates.sh 머리주석 75 규칙. 상태당 컨테이너 ≈18.5분·CI 19.5–28분(게이트 16상태 ≈4.9 h / 5.2–7.5 h), silhouette CI 잡 3개·산출물 전달, `FPS_MAX_NEW_STATES`일 때만 75, B_end_k, diag는 게이트 밖, 단계 11 계획표(34/46), 체크포인트 도구·시간표 | §0-10, §8-2, §8-12, §8-13, §10-9, R15·R25, §13 0·11 |
| 5 | 중대 | 확인 `character.js:146, 177`, `level.js:355-365`. 슬롯 모드 `auditStatic`(정본 = 감사 앵커, 컨트롤러 주차, update·postPhysics·포즈 시간 진행 제외, 포즈 고정), 루트 = 앵커 비트 동일·`\|root.x − pane.x\| = 2.5` 단언·JSON 기록, 샷 3 액터도 `auditStatic` | §0-3·6, §7-1, §7-7, §8-1, §8-11, §10-3, §10-6, §13 4·9b·11 |
| 6 | 중대 | 보충: `bvh.js:24`·`physics/index.js:8`·`rigidbody.js:16`도 three를 import하므로 physics-sim 진입점은 `ragdoll.js`·`character.js`만, `StaticWorld`는 주입. 묶음별 허용 집합, 시뮬 진입 파일 전부의 import 전이 폐포 금지 목록, 경로 출력, 비공허(진입·간선 ≥ 1), `import-graph.mjs`, 케이스 32 두 벌(direct·via-present) | §0-6, §1-1, §1-2, §7-6, §10-5·10-6·10-7, §13 4 |
| 7 | 경미 | 확인 `character.js:224, 279, 283-284, 288-302`. `_slide` 무변경 + 접촉 필드 8종·velocity·`_planeCount`·`lastMoveBlocked` 스냅샷·복원(Player 비트 동일), 테스트 접촉 ≥ 1. R-2 #21 정정 | §0-6, §1-2, §7-3, §10-5·10-6 |
| 8 | 경미 | 선행 그래프 명시·전이 폐포 재계산(스크립트 검산): 6 ← 3a, 13 측정 ← 11(§9-7 정정), 8의 막는 결정 {1, 14}, #14가 2를 막음, #1·#14의 막지 않는 단계 정정, #2의 개정 1 상태 기록 | §9-7, §11, §13 |
| 9 | 경미 | 확인 `materials/index.js:505-509`, `main.js:83`. `createSurfaceMaterials` 안에서 `actor` 생성·반환, main.js는 patchMaterial·extraMaterials만 | §1-2, §3-6, §10-2, §13 6 |
| 10 | 경미 | (1) `auditPose`를 시각 리그 항목으로(`rigOf` 해석), `identicalTo` 쌍 `rigOf` 일치 검증. (2) 템플릿은 질량 분율, `activate(…, massKg, …)`가 진짜 질량으로 `invMass`, `ragdollSeed → {rigKey, massKg}`. (3) `lookOf = rigOf` 제한 + 외견 팀 = `rigOf` 진영, 공개 필드 `apparentRigId` 하나(분리하면 늘 같은 두 값이라 중복. 독립 룩은 slot 호환 검증·재질 교체와 함께 스키마 v2로) | §0-1, §1-2, §2-2, §2-5, §3-8, §6-1·6-2·6-4·6-5, §7-1, §7-8, §10-6, §11 #15 |
| 11 | 경미 | 확인 `pipeline.js:489, 496`, `exposure.js:150`(지적의 :478-479·:485 → 현행). 블룸·출력 드로우 직전 `ec`를 `_drawn`에, TypeError 문장을 "비엄격 문맥에서 조용히 무시, 그리기 값 불변"으로 정정 | §0-9, §9-2, §9-3, §13 1 |
| 12 | 경미 | 확인 `gates.yml:173`. 이름을 `paletteauditactors`로(기존 이름 규칙, CI 스크립트 무변경) | §0-10, §8-9, §8-12, §10-8, §11, §13 12b |
| 13 | 경미 | 확인 `harness.js:18`(360프레임 = 720 서브스텝). playtest는 `h1 === h2`·steps·forced만 판정, sleeping 보고. ragdoll.test "720 안 슬립" 삭제, `steps < 720`·forced 보고 | §6-5, §13 5 |
| 14 | 경미 | 확인 `level.js:601`, `shots.js` lantern 값·`:23`·`:110`. 계산 ≥ 47.5 m(카메라 ≈54 m). ④b = 샷 3만 변경·11샷 imagediff, 결정 2 승인 범위 축소 | §0-3·10, §4-7, §8-13, §10-9, §11 #2, R16, §13 12a |
| 15 | 경미 | 확인 `level.js:568-593`, `shots.js:110-112`. `actor_lineup_anchor`(9a, 화소 불변, 등롱 도달 안), (s5) 거리·투영 단언, 카메라·노출(자유 적응) JSON 기록, 케이스 35는 페이지 단계에서만 공허 주입 | §8-1, §8-9, §8-10, §8-11, §10-3, §13 9a·11 |
| 16 | 경미 | el 1차 SDF가 하한임을 확인(볼록 1-동차). 조기 탈출을 셰이더 정의로 명시, 보수성 테스트는 rc 전용, el은 동일성만, 최대 계단 보고, 반경 확대는 계단이 보일 때만. CPU 마스크가 정의에 대해 보수적(`softB ≤ soft_max`) | §0-2, §4-4, §4-5, §10-6 |
| 17 | 경미 | 확인 `kit.js:703, 732`, `level.js:148`. 단계 7 첫 작업 건식 집계, `ground` 시드에서 `H_up` 상계로 PRUNED 가지치기, spanClear·edgeClear·spanHead 내림 + 대표점 선양자화, 부팅 paramsHash = `NAV_CONFIG` + 매니페스트 classes, 로스터 ⊂ classes, fixture 일치는 nav-fresh | §0-4, §5-1, §5-2, §5-3, §8-13, §10-6, R22·R26, §13 7 |

### R-2. 개정 1: 검토 23건 · 추가 정정 7건(요지, 괄호는 개정 2 변화)

| # | 조치 요지 |
|---|---|
| 1 | 외견 = 시각 리그(`rigOf`), 진짜 값 닫힌 목록, 선언쌍 바이트 동일(룩·auditPose 포함, `lookOf = rigOf`) |
| 2 | 대조군을 변화에(`B−Z > 0`, `Σ(B−A) > 0`), 30/255는 경고 |
| 3 | 누설 영역을 광선별 술어로(L0 공집합 문제를 원시 단위 술어 합집합으로 재수정, 재검토 #1) |
| 4 | 들어 올린 클리어런스 캡슐, clearMax 0.34(내림 양자화) |
| 5 | 클래스별 오라클 비트 |
| 6 | 프리웜 (b) 주 경로 + (a) sync((b)를 환경광 확정 뒤 웜 렌더로, 재검토 #2) |
| 7 | 부팅 throw는 정수 지문·파라미터 해시, 기하 해시는 보고(클래스 출처 = 매니페스트) |
| 8 | `ACTOR_METAL` 무채, v0 실데이터 양성 |
| 9 | 일반 풀·정체 무관 순서·별도 목록 |
| 10 | 전부 주입(하위 디렉터리 허용 집합 + 전이 폐포, 재검토 #6) |
| 11 | 9a/9b/12a 분리, 단계 11 정지·보고 |
| 12 | 라인업 비공허, 케이스 35(이름 `paletteauditactors`, 배치 확정) |
| 13 | 창살 방향별 채움·띠 구간 규칙 |
| 14 | 의존 보강(전이 폐포로 재계산) |
| 15 | 그리기 시점 `_drawn` 대조, `_applyContract` 감싸기 음성(`ec` 포함) |
| 16 | npm test는 ρ 무관 기하 불변식만 |
| 17 | 래그돌 부모→자식 초기 클램프 |
| 18 | 블로커 간선·링크 선분 검사 |
| 19 | 교차 패리티, 고체 내부 스팬 0 |
| 20 | 콩쥐 퍼짐 경향 사실 보충, 결정 20 |
| 21 | 분리 전용 `slideHorizontal`. **정정(재검토 #7)**: 개정 1의 "`_slide`만 실행, 상태 갱신 없음"은 틀렸다 → 스냅샷·복원 |
| 22 | public에 bones·dangleState, `actor_s0_tokki`, pixelowner `--hide-match` |
| 23 | navcheck 분리, 굽기 실측, statics 재산정(건식 집계·가지치기, silhouette·harnesstest 분할) |
| A1–A7 | 결정 14 근거 정정(`src/actors`만 신설), sweep 단축 폐지, 선언쌍 바이트 동일, (a)는 9b 전 무효 → (b) 주 경로(웜 렌더 편승), 9b 전 더미 처리(콜라이더 문제는 `auditStatic`으로 해소), 지터 투영(판독 프레임 지터 반환), VM_GUNMETAL 제외 |

---

## 부록 R2 — 2차 독립 재검토 (2026-10-08, 조건부 승인: 치명 0 · 중대 4 · 경미 9)

조건부 승인. 치명 0, 중대 4, 경미 9건이다. 개정 2는 재검토 17건을 실질적으로 닫았다. 다음 다섯 가지는 코드로 재확인했고 맞다. - 누설 영역 (나) 술어의 정확성: argmin 원시가 자기 s로 만족하면 smoothstep이 정확히 1이다. pane은 HANJI_BASE_OPACITY 1.0·transparent라 A의 배경이 dst×0으로 사라진다. sceneRT는 GTAO·안개·TAA 앞이다. - 태양항: hanji_silhouette의 태양은 azim 300이라 hjBack=0이다. 그래서 o=1−V가 정확하다. - rc 조기 탈출의 보수성: 사영은 1-립시츠라 |s−sb|·len ≤ h ≤ R이다. - 프리웜 줄 번호와 웜 렌더 편승 위치, gates.yml 잡 구조와 coverage 정규식. - 24 m 컷오프 때문에 lantern_night는 영향이 없다.  남은 결함은 다섯 묶음이다. 1. 9b 추천(토끼)이 기존 shotaudit 최소 면적 가드에 걸린다. 더미를 헤드리스로 재 보니 0.71%였고, 토끼는 추정 ≈0.4%다. 2. 내아 동문의 r .34 통과가 대표점 동률 선택에 달려 있다. A-2가 구조적으로 닫히지 않았다. 3. silhouetteaudit의 새 브라우저 단계 검사(대조군·누설·B_end·루트)와 새 게이트 줄 navcheck에 harnesstest 음성이 없다(P2A-BRIEF §0-1, PATCH-015 §1). 4. paletteauditactors는 프레임 전체 비율이라, 액터 색에 반응한다는 증거가 없다(PATCH-010-B). 5. 경미 9건: 청크 단위 도달 가지치기, 로스터 기준 임계, 컨트롤러 재사용 잔류 상태, 상태별 노출 잠금 누락, 잘린 조각의 미검증 상태, 유효 화소 정의, L0 비공허 근거의 전제 오류, 014-C 표 누락, 단계 10/11 순서.  중대 4건은 해당 단계를 시작하기 전에 설계서에 반영해야 한다. 1은 결정 3 요청 전, 2는 단계 7 전, 3과 4는 단계 11·12b 전이다.

각 항목은 **표의 '반영 시점' 단계를 시작하기 전에** 본문에 반영한다(재검토 권고). 반영하면 이 표의 해당 행에 커밋을 적는다.

| # | 등급 | 절 | 문제 | 고칠 방법 | 반영 시점 |
|---|---|---|---|---|---|
| R2-1 | 중대 | §10-3 9b · §11 결정 3 · §13 9b(④a) | 9b에서 샷 3 감시 대상을 더미에서 토끼로 바꾸면서 shotaudit 최소 면적 0.5%를 더미 값 그대로 옮겼다. 그런데 추천 캐릭터 토끼는 이 가드를 넘지 못할 가능성이 높다. 그러면 ④a 체크포인트에서 게이트가 빨간불이 되거나, 실측 없이 임계를 고치는 쪽(014-C 위반)으로 몰린다. | 3c 직후 posedWorldPositions로 4종의 hanji_silhouette areaPct를 헤드리스로 미리 잰다(브라우저 불필요). 그 표를 결정 3 요청에 붙인다. 토끼를 유지하려면 minAreaPct를 roofline_distant 선례처럼 '실측 X% — 회귀 가드 바닥'으로 재등록하는 것도 결정 3에 포함해 발주자에게 묻는다. 숫자는 고르지 않고 실측과 기능(차폐 검출)만 제시한다. 아니면 추천을 콩쥐로 바꾼다. --grid 128x84 보고값도 함께 적어 앨리어싱 폭을 보인다. | 결정 3 요청 전(3c 직후 4종 면적 헤드리스 실측표) |
| R2-2 | 중대 | §5-1 spanRep/spanClear · §5-2 ③⑤ · §5-8 내아 동문 · 심사 A-2 처분 | 대표점은 상한(clearMax)에서 잘린 클리어런스의 최댓값으로 고른다. 그래서 좁은 문 앞 셀에서 동률이 여러 개 생긴다. 어느 동률점이 뽑히느냐에 따라 문을 가로지르는 평탄 간선이 r 0.34로 막히거나 열린다. v0 넷 중 셋(자라·도깨비·콩쥐)이 r 0.34이고, nav-expect는 '동문 r .34 통과'를 기대값으로 고정한다. 그런데 설계에는 그것을 보장하는 장치가 없다. A-2('격자 양자화가 좁은 문 오판')가 대표점 동률 선택으로 자리만 옮겼다. | 대표점 선택은 상한 없는 클리어런스(또는 선택 전용 상한 2·clearMax)의 최댓값으로 한다. 동률은 셀 중심 거리, 그다음 사전순으로 가른다. 저장할 때만 clearMax로 내림한다. 평탄 간선이 r = clearMax로 막히면 양 셀 후보점 쌍(각 3×3) 가운데 sweep 클리어런스가 가장 큰 쌍으로 edgeClear를 정하고, 그 쌍을 간선 오프셋으로 저장해 경로 꺾임점으로 쓴다. nav-synthetic에는 0.7425 m 틈을 셀 격자에 대해 오프셋 {0, .03, .06, .09, .125} m로 놓은 케이스를 추가한다. 모든 오프셋에서 r .34는 통과하고 r .38은 불통이어야 한다(비공허: 간선 ≥ 1). | 단계 7 착수 전 |
| R2-3 | 중대 | §8-10 음성 · §10-7 케이스 표 · §10-5 navbake 행 · §8-2 대조군 | silhouetteaudit 브라우저 단계에 새로 생긴 검사에 음성 테스트가 없다. 해당 검사는 대조군(reactsLantern·reactsActor), 누설 영역 비트 동일, B_start = B_end(조각별 B_end_k), 액터 루트 2.5 m 가드다. 새 게이트 줄 navcheck도 harnesstest 음성 없이 npm test 합성 음성만 둔다. 검사가 끝내 발화하지 않는 구현 버그와 '통과'를 구별할 수 없다. | harnesstest에 silhouetteaudit 음성 묶음을 추가한다. 실행은 `--only <1정체> --orient front --dpr 1`로 묶고 단독 소요를 실측한다. 각 하위 실행은 exit 1, 표식, 해당 check=false를 증거로 낸다. - `--test-occluder-off`: A 상태에서 풀 레코드 제출을 막는다 → Σ(B−A)=0 → '리그가 대상에 반응하지 않음'. - `--test-lantern-stuck`: Z에서도 등롱을 켠다 → B−Z=0. - `--test-leak`: A 상태에만 경계구 밖 정적 캡슐 1개를 둔다 → 누설 영역 A≠B. - `--test-root-shift 0.1`: 페이지 단계에서만 루트를 옮긴다. - `--test-bend-drift`: B_end 직전에만 debugDrift를 건다.  navcheck에는 `navbake --check --inject-stale`(자산 1바이트 변조) 케이스를 추가한다. 12b 체크리스트에 '새 check마다 음성 ≥ 1'… | 단계 11 착수 전 |
| R2-4 | 중대 | §8-9 라인업 · §10-8 paletteauditactors · PATCH-010-B | paletteauditactors는 기존 paletteaudit을 라인업 PNG에 그대로 돌린다. 그런데 paletteaudit은 프레임 전체 화소 대비 위반율로 판정한다. 라인업에서 액터 화소가 프레임의 1.5%보다 적으면 액터 색이 전부 팔레트 밖이어도 통과한다. 개정 1 검토 #12의 처분(액터별 가시 ≥ 1 화소)은 액터가 찍혔다는 것만 보이고, 게이트가 액터 색에 반응한다는 것은 보이지 않는다. 그래서 PATCH-010-B '캐릭터 포함 상태에서 한도 유지'의 증거가 되지 못한다. | 감도를 음성으로 증명한다. harnesstest에 `--inject-actor-offpalette`(예: ACTOR_ACCENT_* 레시피 색상을 300°로, testOverride)를 넣은 라인업 입력을 추가하고, paletteauditactors가 반드시 exit 1이 되게 한다. 이 음성이 성립하도록 라인업 카메라 자세(액터가 프레임을 채우는 근접 구도)를 고정한다. 숫자 임계를 새로 세우지 않고 '음성이 실패하는 구도'로 정한다. 보고에는 액터 마스크 안 위반율과 액터 화소 비율을 함께 싣는다. 판정은 계약 1.5% 그대로다. | 단계 12b 착수 전 |
| R2-5 | 경미 | §5-2 4b 도달 상계 가지치기 · §10-6 nav-synthetic | 4b 가지치기는 '청크마다(패딩 1.0 m 포함)' 단계 목록 안에 있다. 그런데 바닥 시드에서 닿는지는 전역 성질이다. 다른 청크를 거쳐야만 닿는 스팬(이음선을 걸친 단상·누각형 데크)은 그 청크 안에서 PRUNED가 되고, 그 스팬의 ⑤–⑧이 생략되어 간선이 사라진다. 그러면 '상계라 실제로 닿는 스팬은 가지치지 않는다(판정 무영향)'는 주장이 청크화와 함께 성립하지 않는다. 현 경내에서 확인한 사례(누각 (−30, 28)은 한 청크 안, gate_loft_floor는 양쪽 담 갓에서 도달)는 우연히 맞을 뿐이다. 한양 확장(P4-BRIEF §3-3)에서는 드러난다. | 4b를 두 단계로 나눈다. ① 전 청크 열 샘플 뒤에 상계 그래프(청크 간 이음 후보 포함)로 전역 도달 집합을 계산한다. ② 그 결과를 PRUNED로 고정한 뒤 청크별 ⑤–⑧을 돈다. 도시 규모에서는 청크별 상계 그래프를 만든 뒤 이음선 경계 노드로 시드를 전파하는 고정점으로 한다. nav-synthetic에 '이웃 청크 계단으로만 닿는 단상' 케이스를 추가한다(PRUNED 0, 간선 ≥ 1). | 단계 7 |
| R2-6 | 경미 | §5-1 minHeadroom · §5-2 ④ · §5-5 'P4D 재굽기 불필요' · §1-1 ai 허용 … | 이동 클래스는 '로스터 ∪ v1 fixture'로 굽는다. 그런데 스팬 폐기 기준(minHeadroom = 로스터 최소 crouchHeight)과 막힘 기준(nodeClear < 로스터 최소 반지름)은 로스터만으로 정한다. fixture에 로스터보다 작은 crouch나 반지름이 있으면 그 클래스의 스팬이 잘못 버려지거나 막힌다. P4D에서 v1을 로스터로 옮기면 minHeadroom이 바뀌어 NAV_CONFIG와 paramsHash가 바뀌므로 재굽기가 강제된다. 그래서 'P4D 편입에 재굽기 불필요'와 모순된다. 또 config.js가 로스터에서 값을 유도하면 ai → actors 직접 import가 되어 §1-1 허용 집합 {ai, src/core}에 어긋난다. | 두 기준을 매니페스트 classes(로스터 ∪ fixture)의 최솟값에서 navbake가 유도한다. 그 값을 매니페스트와 paramsHash에 정수로 기록한다. config.js에는 로스터 의존을 두지 않는다. nav-fresh에 'classes 최솟값 = 기준값'을 단언한다. | 단계 7 |
| R2-7 | 경미 | §7-1 컨트롤러 재사용 · §7-7 ⑥b actors.reset · §10-6 actor-sim 'rese… | 슬롯 컨트롤러는 부팅 때 하나만 만들어 세션마다 재사용한다. reset은 '주차'만 하고, 스폰은 configure → teleport다. teleport·probeGround는 공중 스폰(접지 프로브 0.06 m 밖)일 때 groundNormal·groundSurface·groundObject를 갱신하지 않는다. 그래서 직전 세션 값이 남아 '리셋 = 신규 인스턴스' 동등성(p4b_actor_reset_byte_identical·actor-sim)이 잠재적으로 깨진다. 지금 플레이어는 SPAWN y 0.05로 접지 스폰이라 우연히 드러나지 않는다. | configure()가 접촉·지면 필드 전부를 생성자 기본값으로 되돌리게 한다. 또는 슬롯별 부팅 스냅샷 resetToBoot()를 두고 actors.reset에서 부른다. 테스트는 세션 1에서 비기본 표면에 접지한 뒤 reset, 세션 2에서 공중 스폰한 상태를 신규 인스턴스와 바이트로 대조한다. | 단계 4 |
| R2-8 | 경미 | §8-2 상태 절차 · §7-7 ⑫ exposure.reset · §4-8 ② 후보 캡처 | 상태 절차 'resetState → setShot → silhouetteAuditSetup → stepFrames(90) → readSceneRect → capturePng'에 노출 잠금 단계가 없다. resetState의 ⑫는 exposure.reset()(unlock + snap)이므로, '2. 이후 lockExposure(evB)'를 한 번만 걸면 Z·B_start·A·B_end가 자유 적응으로 찍힌다. 대비 C_bg는 AgX 뒤 표시 PNG에서 재므로 노출에 의존한다(PATCH-015-E, 016-C 사유 1). 후보 B·C·D 실행에는 B0가 없어서 어느 EV로 잠그는지도 정해지지 않았다. | silhouetteAuditSetup에 `exposure: {lock: ev}` 인자를 두어 매 상태 resetState 뒤 잠근다. 상태마다 JSON에 그리기 시점 `_drawn` 기준의 `{mode, ev100}`를 남기고 evB와 같은지 단언한다. 후보 실행은 후보별 B0를 1상태 추가해 각자 evB로 잠그거나, L0 evB로 고정한다. 어느 쪽인지 정해 JSON에 기록한다(비교 조건 명시). | 단계 11 |
| R2-9 | 경미 | §8-2 이어 받기·시간 조각 · R25 | B_end_k는 조각이 exit 75로 정상 종료할 때만 그려진다. 컨테이너 회수처럼 조각이 도중에 잘리면, 그 페이지에서 저장된 A 상태 사이드카는 같은 페이지의 B_end 검증 없이 다음 조각에 '이어 받은 상태(resumed)'로 들어간다. 조각을 둔 목적이 컨테이너 생존 창이므로 이 경로가 주된 위험이다. | 사이드카는 '대기(pending)'로 쓰고, 그 조각의 B_end_k가 통과할 때 일괄 확정한다. 확정되지 않은 상태는 재개 때 다시 그린다. 재개한 새 페이지 첫 상태로 B_start 재렌더 대조(B_begin_k)를 하나 더 두면 조각 간 비결정도 앞에서 잡는다. | 단계 11 |
| R2-10 | 경미 | §8-3 누설 영역 비공허 · §8-4 유효 화소 · §8-7 bg · §10-6 nav-gwana | '유효 화소'를 판 rect에서 창살만 뺀 것으로 정의했다. 그래서 판 가장자리에 걸친 기둥처럼 판이 아닌 화소가 섞인다. castShadow=false 등롱이 이 화소의 옆면을 비추면 B−Z > 0이면서 A == B가 자명하다. 그러면 (1) '정체마다 누설 영역 ∩ 유효 ≥ 1' 비공허 조건을 판이 아닌 화소가 채울 수 있고, (2) C_bg의 bg(o = 0)에 목재 화소가 섞인다. 창살을 뺀 근거('A == B가 자명')가 기둥에도 그대로 적용되는데 기둥은 빠지지 않았다. 또 nav-gwana의 층화 표본 오라클 재주행은 '표본 크기는 리포트'뿐이라 층이 비어도 통과한다. | 유효 화소 = renderObjectMask({match: '^na_w_-3_hanji$'}) ∖ 팽창 창살로 정의한다(판 자신의 가시 화소만). 누설 영역, bg, 비공허를 모두 이 집합 위에서 센다. nav-gwana는 클래스 × 층마다 표본 ≥ 1을 판정 조건으로 둔다. | 단계 11(nav-gwana 는 7) |
| R2-11 | 경미 | §8-3 영역 크기 계산 · §8-1 (s3) · §0-7 · R3 | L0 비공허의 근거로 '몸보다 굵은 근사(수직 캡슐 r 0.25·2 m)로도 L0 60.6%'를 들었다. 그런데 r 0.25(폭 0.5 m)는 v0 몸보다 가늘다. 자라 등껍질 0.84 m, 도깨비 0.80 m, 콩쥐 치마 0.84 m이므로 이 값은 영역의 하한이 아니다. 또 (s3)는 '§8-3과 같은 정의(무지터 화소 중심)'라고 했지만, §8-3은 판독 프레임 지터의 네 모서리로 정의한다. 실제로 같은 정의가 아니다. 지터는 프레임 번호로 결정되어(90프레임 → JITTER[2]) 미리 계산할 수 있으므로 굳이 다르게 둘 이유가 없다. | L0·B 비공허는 v0 4종 × front/side 실제 원시로 silhouettepredict가 계산한 값으로 바꿔 적는다(3d 산출물). 그 전까지는 '미측정'으로 표기한다. (s3)는 frame 90의 지터와 네 모서리 술어를 그대로 써서 브라우저 정의와 일치시킨다. | 단계 3d·11 |
| R2-12 | 경미 | §8-13 숫자의 출처(014-C 준수표) · §8-4 · §8-1 · §8-5 | 판정에 영향을 주는 숫자 일부가 준수표에서 빠졌다. 창살 마스크 2 px 팽창은 유효/미지 화소와 채움 규칙을 거쳐 W·H·P 값을 움직인다. 루트·앵커 거리 단언의 ±1e-6은 exit 1 조건이다. K는 '대역 / soft_actor'로 유도했다면서 실제로는 자기 구간 [h0, H]를 K등분한다. 그러면 칸 폭이 유도 근거(반그림자 폭)와 맞지 않는다. | 표에 2 px(구현 파라미터, 1/2/3 px에서 축 원값 민감도 보고), ±1e-6(정의: anchor.x·pane.x가 리터럴이므로 정확히 2.5, 허용을 0으로 줄일 수 있음)을 올린다. K는 칸 폭 = soft_actor(정체별 K = floor((H − h0)/soft_actor))로 정의를 맞추거나, 대역 기준 고정 칸으로 바꾼다. 어느 쪽이든 결정 4에 명시한다. | 단계 11·결정 4 요청 |
| R2-13 | 경미 | §13 단계 10·11 · §10-7 시간 예산 | 단계 10의 검증에 'CI 분할 여부 결정'(harnesstesta/b)이 있다. 그런데 분할의 주된 원인인 케이스 22·35는 단계 11에서 만들어진다. 선행 그래프상 10은 11에 의존하지 않으므로, 10에서는 22·35의 단독 소요를 잴 수 없다. 두 단계를 병렬로 돌리면 harnesstest.mjs(시간 조각·헤더 주석·케이스 표)를 동시에 고치는 충돌도 생긴다. | 'CI 분할 여부 결정'을 단계 11 뒤(또는 12b의 CI 편입 행)로 옮긴다. 선행에 12b ← {10, 11}을 명시하고, harnesstest.mjs는 단일 오너가 10 → 11 순차로 편집한다고 적는다. | 단계 10·11 순서 |

---

## 부록 R3 — 구현 중 확정한 차이 (발주자 수용, 2026-10-09 UTC)

단계 5(PBD 래그돌, `p4b/ragdoll`) 구현이 설계서와 다르게 한 점을 독립 검증 뒤 발주자가 수용했다. 본문 해당 절보다 이 표가 우선한다.

| # | 절 | 설계서 | 구현(확정) | 근거 |
|---|---|---|---|---|
| D1 | §6-3 ⑤·⑥ (`:589-590`) | ⑤ 중심 클램프 → ⑥ 마찰 | **마찰 → 중심 클램프**. 클램프가 서브스텝의 마지막 위치 쓰기(`ragdoll.js` `_stepSlot`) | "매 서브스텝 입자 중심이 어떤 삼각형도 건너지 않는다"가 구성으로 성립하려면 클램프 뒤에 위치를 바꾸는 단계가 없어야 한다. 독립 검증이 위치 쓰기 순서를 추적해 클램프가 마지막임을 확인했다 |
| D2 | §6-1 `wake()` (`:570`) | 카운터 처리 정의 없음 | `wake()`가 `steps`·`forced`·`still`을 0으로 되돌린다 | 되돌리지 않으면 깨운 직후 강제 슬립 상한(720)에 다시 걸린다. 반복해서 깨우면 강제 슬립이 미뤄지므로 9a에서 호출처를 둘 때 다시 확인한다 |
| D3 | §6-5 "헤드리스 경내 4종" (`:606`) | v0 4종 데이터로 헤드리스 실행 | 3a 병합 전에는 **합성 템플릿을 경내 4곳**(내아 판 앞·마당·동헌 기단 가장자리·동헌 창살)에 놓아 실행 | §13 행 5 "3a(합성 템플릿으로 먼저 개발)". 3a 병합 뒤 `biped.js` 기반 템플릿으로 바꿔 끼우고 다시 돌린다. **교체 완료**: `src/actors/sim/ragdoll-rig.js` `compileRagdollRig(시각 리그)`(반지름 = 뼈별 몸 원시 최솟값, 없으면 들어오는 막대 — 구현 파라미터)로 v0 4종 템플릿을 만들어 경내 4곳에 1종씩 둔다(`test-fixtures/ragdoll/roster-rigs.mjs`) |
