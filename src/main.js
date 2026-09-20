/**
 * src/main.js — 부팅 시퀀스와 메인 루프.
 *
 * URL 파라미터:
 *   mode=fixed     하네스 캡처 모드. 자체 프레임 루프 없음 — stepFrames만 진행
 *   mode=realtime  기본. rAF 루프 + 고정 물리 서브스텝
 *   seed=<uint32>  전역 RNG 시드 (기본 DEFAULT_SEED)
 *   dpr=<number>   렌더 픽셀 비율 강제 (기본 devicePixelRatio)
 *
 * 부팅 순서: 씬·월드·BVH → 플레이어 → 프리웜(모든 샷 1프레임) →
 * 기본 뷰 복원 → ready. 프리웜이 ready에 선행하므로 플레이 중 컴파일 0이
 * 부팅 조건이 된다.
 */

import * as THREE from 'three';
import { clock, PHYSICS_DT, MAX_FRAME_DT } from './core/clock.js';
import { armCaptureDeterminism, markSimWindow } from './core/determinism.js';
import { bus } from './core/events.js';
import { setGlobalSeed, resetAllStreams, DEFAULT_SEED } from './core/rng.js';
import { installHarness } from './core/harness.js';
import { prewarmShaders } from './core/prewarm.js';
import { StatsRecorder } from './core/stats.js';
import { createRenderer, createCamera, createLighting, applySunConfig, handleResize } from './render/renderer.js';
import { RenderPipeline } from './render/pipeline.js';
import { SkySystem } from './sky/index.js';
import { OpacityApplier } from './render/opacity.js';
import { setupAlbedoAudit } from './render/audit-cards.js';
import { createTagMask } from './render/tagmask.js';
import { bakeGroundAo } from './render/groundao.js';
import { PhysicsWorld } from './physics/index.js';
import { collectRayChain } from './physics/raychain.js';
import { buildWorld, HANJI_LATTICE, hanjiLatticeCount } from './world/level.js';
import { createSurfaceMaterials, finalizeSurfaceShaders, LANTERN_EMISSIVE, applyHanjiTransmit, HANJI_TRANSMIT } from './materials/index.js';
import { PlayerInput } from './player/input.js';
import { Player } from './player/player.js';
import { FireControl } from './weapons/firecontrol.js';
import { Viewmodel, setupViewmodelAudit } from './weapons/viewmodel.js';
import { VIEWMODEL_MATERIAL_MAP } from './materials/viewmodel-look.js';
import { HanjiState } from './materials/hanji.js';
import { HanjiOccluders } from './materials/hanji-occluders.js';
import { FxSystem } from './fx/index.js';
import { SHOTS, SHOTS_BY_NAME, DEFAULT_VIEW } from '../tools/shots.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'fixed' ? 'fixed' : 'realtime';
const seed = params.get('seed') ? Number(params.get('seed')) >>> 0 : DEFAULT_SEED;
const dprParam = params.get('dpr') ? Number(params.get('dpr')) : undefined;

// PATCH-004-B: Math.random 구조 트랩 — 월드·파이프라인 생성 전, **두 모드 모두** 장착.
// HARNESS §2-2가 게임 코드의 Math.random을 금지하므로 진난수 소비자는 정의상 없고,
// 동일 시드 수열이면 realtime 픽셀 == capture 픽셀이 구조적으로 성립한다 (C2 검토:
// fixed 전용 장착은 실플레이 게이트(profile)가 난수 소비를 못 보는 사각지대였다)
armCaptureDeterminism();

setGlobalSeed(seed);
clock.setMode(mode);

const canvas = document.getElementById('game');
const renderer = createRenderer({
  canvas,
  dpr: dprParam,
  // fixed 모드: stepFrames 종료 후 스크린샷까지 캔버스 내용이 보존돼야 한다
  preserveDrawingBuffer: mode === 'fixed',
});
const camera = createCamera();
const scene = new THREE.Scene();
const lighting = createLighting(scene);
// P3 C1: HDR·CSM·GTAO·TAA·MB·AgX 파이프라인 — 태양은 CSM이 소유
const pipeline = new RenderPipeline({ renderer, scene, camera });
lighting.pipeline = pipeline;
// C2: 하늘 서브시스템 — 스카이돔·PMREM 환경광·world:tod/weather 발행·안개 구성 소유
const skySystem = new SkySystem({ scene, renderer, bus });
lighting.sky = skySystem;
pipeline.sky = skySystem;

const physics = new PhysicsWorld();
// 부팅 단계 계측 (PATCH-004-A 분해 — 프리웜 밖의 비용도 보고한다)
const bootPhases = []; let _phaseT = clock.wallNowMs();
const phase = (name) => { const t = clock.wallNowMs(); bootPhases.push({ phase: name, ms: Math.round(t - _phaseT) }); _phaseT = t; };
phase('renderer+pipeline+sky');
// P3 C3: 절차 재질 세트 — 부팅 시 GPU 합성(이미지 에셋 0). 소요는 프리웜 분해에 편입(PATCH-004-A)
const surfaceMaterials = createSurfaceMaterials({ renderer });
phase('materials_synth');
const world = buildWorld(scene, physics, surfaceMaterials);
phase('world_build');
// R4 접지 음영 맵 — 정적 월드에서 1회 베이크 (render/groundao.js). 상향면 재질(지면·마루·기단)이 월드 XZ 로 샘플
const groundAo = bakeGroundAo(world.group);
console.info(`[boot] groundAo occluders=${groundAo.occluders} bake=${groundAo.ms}ms`);
phase('ground_ao');
const bvhInfo = physics.build();
console.info(`[boot] bvh tris=${bvhInfo.tris} nodes=${bvhInfo.nodes} build=${bvhInfo.buildMs.toFixed(1)}ms`);
console.info(`[boot] instanced: ${world.instanced.map((i) => `${i.key}×${i.count}`).join(' ')}`);

const input = new PlayerInput();
if (mode === 'realtime') input.attach(canvas);
const player = new Player(physics, input);

const stats = new StatsRecorder(renderer);

/* ------------------------------------------------- P2A 무기·HANJI 배선 */
// 카메라가 씬에 있어야 카메라 자식(뷰모델)이 월드 조명으로 렌더된다 (§3 리그)
scene.add(camera);

const fire = new FireControl(
  (ox, oy, oz, dx, dy, dz, maxDist) => collectRayChain(physics.static, ox, oy, oz, dx, dy, dz, maxDist),
  (ox, oy, oz, dx, dy, dz, maxDist) => physics.raycastBodies(ox, oy, oz, dx, dy, dz, maxDist),
);
const viewmodel = new Viewmodel(camera);
viewmodel.setVisible(mode === 'realtime'); // 캡처는 샷 데이터가 명시할 때만 표시

// [R4 작업 1 / 등급 A] 뷰모델 룩 배선 — 기하는 weapons(P2), 재질은 materials(P3) 소유다(CARRYOVER-AUDIT #6).
// weapons 가 만든 회색 카드(VM_GREY_*)를 건메탈·폴리머로 교체한다. viewmodel.js 는 건드리지 않는다.
// pipeline.patchScene() 보다 **앞**에서 교체해야 새 재질도 CSM 패치를 받는다.
const viewmodelMaterials = surfaceMaterials.viewmodel; // materials 가 같은 합성기로 만들어 반환한다
{
  const swapped = new Set();
  viewmodel.root.traverse((o) => {
    if (!o.isMesh) return;
    const key = VIEWMODEL_MATERIAL_MAP[o.material?.name];
    if (!key) throw new Error(`뷰모델 재질 매핑 없음: ${o.material?.name} (${o.name})`); // PATCH-001-D: 조용한 무시 금지
    o.material = viewmodelMaterials[key];
    swapped.add(key);
  });
  if (swapped.size !== Object.keys(viewmodelMaterials).length) {
    throw new Error(`뷰모델 재질 미사용분: ${Object.keys(viewmodelMaterials).filter((k) => !swapped.has(k))}`);
  }
}

// HANJI 판 등록: 가시 판(_hanji) ↔ 콜라이더(_hanji_col) 쌍의 가시 쪽
const hanjiPanes = new Map();
scene.traverse((o) => {
  if (o.isMesh && o.visible && o.userData.surface === 'HANJI' && o.name.endsWith('_hanji')) {
    hanjiPanes.set(o.name, o);
  }
});
const hanji = new HanjiState();
for (const [id, paneMesh] of hanjiPanes) {
  const g = paneMesh.geometry.parameters;
  hanji.register(id, g.width, g.height); // 구멍 반지름이 m 단위 — 판 크기가 상태에 필요하다 (PATCH-013-B)
}
const opacityApplier = new OpacityApplier(hanjiPanes, hanjiLatticeCount, HANJI_LATTICE.bands.length);
// R1 F: 창호지 역광 투과 유니폼 묶음 (패치는 CSM 패치 뒤 — 아래 finalize 직후). 샷 태양 강도 × T
const hanjiTransmitUniforms = [];
// [PATCH-008-B] 점광 투과의 해석적 캡슐 차폐 — 등록 캡슐(실루엣 더미; P4 적 캡슐)을 프레임마다 뷰 공간 유니폼으로
const hanjiOccluders = new HanjiOccluders();
{ const d = scene.getObjectByName('silhouette_dummy'); if (d) hanjiOccluders.setFromMesh('silhouette_dummy', d); }
pipeline.beforeRender.push((cam) => hanjiOccluders.update(cam.matrixWorldInverse));
const setHanjiTransmit = (sunIntensity) => { for (const u of hanjiTransmitUniforms) u.uHanjiTransmit.value = sunIntensity * HANJI_TRANSMIT; };

// P2B FX — 기와 낙하 강체는 콜백 주입 (fx는 physics를 import하지 않는다)
const debrisGeo = new THREE.BoxGeometry(0.18, 0.024, 0.13);
// 킷 GREY_DARK와 동일 파라미터 — 같은 프로그램 순열 (컴파일 0 유지)
// C3: 낙하 기와는 지붕 기와 재질(텍스처 공유·같은 셰이더 모드) — 프로그램 공유로 컴파일 0 유지
const debrisMaterial = surfaceMaterials.mats.ROOF_TILE.clone();
debrisMaterial.userData.albedoLum = surfaceMaterials.mats.ROOF_TILE.userData.albedoLum;
debrisMaterial.userData.surfaceOpts = surfaceMaterials.mats.ROOF_TILE.userData.surfaceOpts;
debrisMaterial.name = 'FX_DEBRIS_TILE';
// CSM 패치 — 런타임 스폰 재질은 patchScene 순회 밖이라 미패치 상태로 첫 파편 스폰
// 프레임에 프로그램 +1(플레이 중 컴파일)과 3중 직사광 과노출을 냈다 (C2 검토 진범)
pipeline.patchMaterial(debrisMaterial);
// 파편 메시 풀 — Object3D 생성(UUID → Math.random)이 시뮬 창에서 일어나지 않게 부팅에
// 선할당. 씬에는 스폰 시에만 add/remove (tris_scene 불변)
const DEBRIS_POOL = [];
for (let i = 0; i < 24; i++) {
  const m = new THREE.Mesh(debrisGeo, debrisMaterial);
  m.name = 'fx_debris_tile'; m.castShadow = false; m.receiveShadow = false;
  DEBRIS_POOL.push(m);
}
const fx = new FxSystem(scene, {
  spawnBody: (opts) => {
    const mesh = DEBRIS_POOL.pop();
    if (!mesh) throw new Error('debris pool exhausted — fx DEBRIS_CAP과 풀 크기 불일치'); // PATCH-001-D 계열: 조용한 축소 금지
    mesh.userData.surface = opts.surface;
    scene.add(mesh);
    return physics.addRigidBody({
      shape: 'box',
      halfExtents: opts.halfExtents,
      position: opts.position,
      velocity: opts.velocity,
      angularVelocity: opts.angularVelocity,
      mass: opts.mass,
      surface: opts.surface,
      object3D: mesh,
    });
  },
  despawnBody: (body) => {
    physics.rigid.remove(body);
    if (body.object3D) { body.object3D.parent?.remove(body.object3D); DEBRIS_POOL.push(body.object3D); }
  },
});

// surface:damage → HANJI 상태 어댑터 (콜라이더 이름 → 판 이름, 월드 → 판 로컬 UV)
const _uvVec = new THREE.Vector3();
bus.on('surface:damage', (e) => {
  if (e.surfaceType !== 'HANJI') return;
  const paneId = e.surfaceId.endsWith('_col') ? e.surfaceId.slice(0, -4) : e.surfaceId;
  const mesh = hanjiPanes.get(paneId);
  if (!mesh) throw new Error(`HANJI surface:damage 대상 판 없음: ${e.surfaceId}`); // PATCH-001-D
  _uvVec.set(e.worldPos[0], e.worldPos[1], e.worldPos[2]);
  mesh.worldToLocal(_uvVec);
  const { width, height } = mesh.geometry.parameters;
  hanji.registerHit(paneId, [_uvVec.x / width + 0.5, _uvVec.y / height + 0.5], e.weapon);
});

/**
 * 샷 구성 적용 — 카메라 + 태양 + 등롱 (world:tod 이벤트는 P3 sky 소유).
 * P2A: 샷 데이터의 viewmodel(표시·무기·ADS)과 actions(결정적 사격)도 여기서
 * 해석한다. actions는 opts.runActions=true(하네스 setShot 경로)에서만 실행 —
 * 프리웜의 applyShot이 부팅 중 사격 상태를 오염시키지 않게 한다.
 */
/**
 * 감사 리그 전용 원시 조명 — P2A 캘리브레이션 보존 (C2):
 * 반구광 무스케일 + PMREM 환경광 차단 + 스카이 미적용. 감사 수치는 자체
 * 조명의 순수 함수여야 하며 하늘 도입에 불변이다.
 */
function applySunRawForAudit(sun, hemi) {
  pipeline.setSun(sun);
  lighting.hemi.intensity = hemi;
  skySystem.setEnvironmentEnabled(false);
  // 안개 인스캐터는 가산 오프셋이라 암카드 휘도를 들어 비율을 무너뜨린다
  // (C2 실측: L018/L004 4.37→2.63 — 밀도 0.0022×14m ≈ +0.010 리니어와 일치)
  skySystem.fog = { density: 0, heightFalloff: 0.12, baseY: 0 };
  setHanjiTransmit(0); // 감사 수치는 자체 조명의 순수 함수 (R1 F)
}

function applyShot(shot, opts = {}) {
  camera.position.set(...shot.cam.pos);
  camera.lookAt(...shot.cam.target);
  camera.fov = shot.cam.fov;
  camera.updateProjectionMatrix();
  applySunConfig(lighting, shot.sun, shot.hemi, shot.fog);
  setHanjiTransmit(shot.sun.intensity);
  for (const l of world.lanternLights) l.intensity = shot.lantern;
  // C4: 등롱 발광은 점등 상태에 종속 (materials LANTERN_EMISSIVE 주석) — 유니폼 값이라 프로그램 순열 불변
  if (surfaceMaterials.mats.LANTERN) surfaceMaterials.mats.LANTERN.emissiveIntensity = shot.lantern > 0 ? LANTERN_EMISSIVE.lit : LANTERN_EMISSIVE.unlit;

  viewmodel.setVisible(!!shot.viewmodel);
  if (shot.viewmodel) {
    fire.switchTo(shot.viewmodel.weapon);
    fire.current.adsBlend = shot.viewmodel.ads ?? 0;
  }
  viewmodel.update(fire.current);

  if (opts.runActions && shot.actions) {
    for (const act of shot.actions) {
      if (Number.isInteger(act.atFrame) && act.atFrame > 0) continue; // 지연 액션은 하네스 stepFrames가 실행 (P2B)
      if (act.type !== 'fire') throw new Error(`unknown shot action: ${act.type}`);
      fire.switchTo(act.weapon);
      for (let i = 0; i < (act.rounds ?? 1); i++) fire.fire(act.eye);
    }
  }
}

function applyDefaultView() {
  applySunConfig(lighting, DEFAULT_VIEW.sun, DEFAULT_VIEW.hemi);
  setHanjiTransmit(DEFAULT_VIEW.sun.intensity);
  for (const l of world.lanternLights) l.intensity = DEFAULT_VIEW.lantern;
  camera.fov = 70;
  camera.updateProjectionMatrix();
  player.applyCamera(camera);
  viewmodel.setVisible(mode === 'realtime'); // 샷 적용(프리웜 포함)이 남긴 표시 상태 복원
  viewmodel.update(fire.current);
}

handleResize(renderer, camera, (r) => pipeline.setSize(r.domElement.width, r.domElement.height));

let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

const tagMask = createTagMask({ renderer, scene, camera, pipeline });
const harness = installHarness({
  renderer, scene, camera, player, input, physics, world, pipeline,
  stats, shotsByName: SHOTS_BY_NAME, applyShot, applyDefaultView,
  readyPromise, mode,
  // P2A 배선
  fire, viewmodel, hanji, fx,
  hanjiPanes, // C2 §8: HANJI 반투과 화면 면적 → overdraw_estimate 편입
  opacityApplier, // resetState 방어선 — hanji.reset()은 더럽혀진 판만 이벤트를 쏜다 (PATCH-013-B)
  hanjiOccluders, // PATCH-008-B: 프로브가 더미 이동 후 재등록
  tagMaskHook: () => tagMask.render(), // PATCH-007-C: 자발광 태그 마스크 (캡처 뒤 호출)
  viewmodelAuditHook: ({ boost }) => setupViewmodelAudit({
    scene, camera, boost,
    patchMaterial: (m) => pipeline.patchMaterial(m), // CSM — 미패치 카드는 3중 수광
    // 순수 태양만 — applyDefaultView는 카메라도 움직여 카드 투영이 깨진다
    applySun: () => applySunRawForAudit(DEFAULT_VIEW.sun, DEFAULT_VIEW.hemi),
  }),
  albedoAuditHook: ({ scaleAlbedo }) => setupAlbedoAudit({
    scene, camera, renderer, scaleAlbedo,
    patchMaterial: (m) => pipeline.patchMaterial(m),
    extraMaterials: [debrisMaterial], // 런타임 스폰 전용 — 씬 순회에 안 잡힌다
    applySunRaw: (sun, hemi) => applySunRawForAudit(sun, hemi),
  }),
});

/* ------------------------------------------------------------- 부팅 */
pipeline.patchScene();   // CSM 재질 패치 — 클론·fx 포함 전 재질 (C1)
// C3: 표면 셰이더(트라이플래너·POM·마모)는 CSM 훅을 체인하므로 CSM 패치 다음에 적용
finalizeSurfaceShaders({ ...surfaceMaterials.mats, FX_DEBRIS_TILE: debrisMaterial }, { groundAo });
// R1 F: 창호지 역광 투과 — 원본 HANJI + 판별 클론(HANJI@id) 모두 패치 (CSM 패치 뒤, 프로그램 공유). materials 주석 참조
{
  const seen = new Set();
  const patchHanji = (m) => {
    if (!m || seen.has(m) || !(m.name === 'HANJI' || m.name.startsWith('HANJI@'))) return;
    seen.add(m); hanjiTransmitUniforms.push(applyHanjiTransmit(m, pipeline.sunTravelDirection, pipeline.sunColor, hanjiOccluders));
  };
  patchHanji(surfaceMaterials.mats.HANJI);
  scene.traverse((o) => { if (o.isMesh) patchHanji(o.material); });
  // 판별 기하 유니폼은 이 패치가 유니폼 객체를 갈아끼운 **뒤** 넣어야 한다 (opacity.js 주석)
  opacityApplier.syncPaneUniforms();
}
window.__materials = surfaceMaterials.synth; // { ms, breakdown } — 부팅 분해 계측 (profile 편입)
window.__bootPhases = bootPhases; // 부팅 단계별 ms (렌더러·합성·월드·프리웜·웜렌더) — clock.markBootDone 직전까지
fx.prewarmSpawn(camera); // fx 머티리얼 전 종 컴파일 보증 (P2B §6)
// 프리웜은 저해상도로 — 프로그램 컴파일은 해상도 무관, 부팅 예산(§7 ≤4s)의
// 지배 비용이 풀해상도 파이프라인 렌더 11회였다 (실측 7.1s → 축소로 회수)
const _pw = renderer.getSize(new THREE.Vector2());
renderer.setSize(192, 120, false);
pipeline.setSize(renderer.domElement.width, renderer.domElement.height);
pipeline.setShadowMapSize(256); // 그림자 해상도도 축소 — 프로그램 동일, 2048²×3 렌더 비용만 회수
skySystem.prewarmSkipPmrem = true; // 커버리지 전용 — PMREM은 첫 1회만 (sky.js 주석)
phase('wiring_to_prewarm');
const warm = await prewarmShaders({
  renderer, scene, camera,
  compileTarget: pipeline.sceneRT, // 뷰티 패스와 같은 타깃 바인딩으로 컴파일 (캔버스 키의 사장 프로그램 방지)
  shots: SHOTS,
  applyShot,
  restoreDefault: applyDefaultView,
  renderFrame: () => pipeline.render(), // HDR 타깃·CSM 캐스케이드·후처리 순열까지 (P3 §7)
});
skySystem.prewarmSkipPmrem = false;
renderer.setSize(_pw.x, _pw.y, false);
pipeline.setSize(renderer.domElement.width, renderer.domElement.height);
pipeline.setShadowMapSize(2048);
applyDefaultView(); // 기본 뷰 환경광(PMREM) 전체 재생성 — 부팅 상태 확정
// 그림자 맵(2048²×3)·지연 RT 재할당을 부팅에서 소진 — 시뮬 창은 무할당이어야
// PATCH-004-B 트립와이어(창 내 Math.random=오류)가 순수하게 유지된다
pipeline.render();
pipeline.reset();
console.info(`[boot] prewarm programs=${warm.programsAfter} (+${warm.compiled}) ${warm.ms}ms`);
phase('prewarm');
window.__prewarm = warm;
window.__pipeline = pipeline; // 디버그·결정성 이분 전용 — 게이트 도구는 __harness만 쓴다
window.__lighting = lighting; // C4 조정 프로브 전용 (hemiScale)

fire.reset();             // 프리웜의 applyShot(viewmodel 샷)이 만진 무기 상태를 부팅 초기로
fx.reset();               // 프리웜 대표 fx 인스턴스 정리 (부팅 = 무상태)
resetAllStreams();        // 프리웜이 소비한 fx 스트림 위상 원점 복원 — 부팅 상태 ≡ resetState 상태 (P2B 감사)
physics.markBootBodies(); // 부팅 로스터 스냅샷 — resetState가 런타임 스폰만 걷어낸다 (감사 A1)
bus.markBoot();           // 구독 스냅샷 (감사 A4)
phase('warm_render+reset');
clock.markBootDone();
console.info(`[boot] ready in ${clock.bootMs.toFixed(0)}ms mode=${mode} seed=${seed}`);
readyResolve();

/* --------------------------------------------------------- 메인 루프 */
if (mode === 'realtime') {
  // 서브스텝 상한 = 프레임 dt 상한을 온전히 소화하는 수(0.1s/(1/120)=12). 종전 5는
  // 24fps 아래에서 시뮬 이동 시간을 버려(≤10fps에서 42%) 스크립트 동선이 fps 의존으로
  // 짧아졌다(C2 검토 실측: profile 동선이 담장에 못 미침). 나선 방지는 dt 상한이 담당한다.
  const MAX_SUBSTEPS = Math.ceil(MAX_FRAME_DT / PHYSICS_DT);
  let accum = 0;
  const loop = (ts) => {
    requestAnimationFrame(loop);
    const cpuT0 = clock.wallNowMs(); // CPU 프레임 시간(GPU 제외) 계측 시작
    clock.tickRealtime(ts);
    markSimWindow(true); // 시뮬 창 개방 — realtime 프레임도 Math.random 소비를 계측 (PATCH-004-B)
    harness._internal.scriptTick();
    accum += clock.dt;
    let steps = 0;
    const subT0 = clock.wallNowMs();
    while (accum >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      harness._internal.simSubstep(); // player + fire + physics — fixed 경로와 동일 배선
      accum -= PHYSICS_DT;
      steps++;
    }
    const substepMs = clock.wallNowMs() - subT0;
    if (steps === MAX_SUBSTEPS) accum = 0; // 백로그 폐기 — 나선 방지
    harness._internal.renderFrame(cpuT0, { substeps: steps, substepMs });
    markSimWindow(false);
  };
  requestAnimationFrame(loop);
}
// fixed 모드는 루프 없음 — __harness.stepFrames()만 시간을 전진시킨다
