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
import { clock, PHYSICS_DT } from './core/clock.js';
import { bus } from './core/events.js';
import { setGlobalSeed, DEFAULT_SEED } from './core/rng.js';
import { installHarness } from './core/harness.js';
import { prewarmShaders } from './core/prewarm.js';
import { StatsRecorder } from './core/stats.js';
import { createRenderer, createCamera, createLighting, applySunConfig, handleResize } from './render/renderer.js';
import { OpacityApplier } from './render/opacity.js';
import { PhysicsWorld } from './physics/index.js';
import { collectRayChain } from './physics/raychain.js';
import { buildWorld } from './world/level.js';
import { PlayerInput } from './player/input.js';
import { Player } from './player/player.js';
import { FireControl } from './weapons/firecontrol.js';
import { Viewmodel, setupViewmodelAudit } from './weapons/viewmodel.js';
import { HanjiState } from './materials/hanji.js';
import { FxPlaceholder } from './fx/placeholder.js';
import { SHOTS, SHOTS_BY_NAME, DEFAULT_VIEW } from '../tools/shots.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'fixed' ? 'fixed' : 'realtime';
const seed = params.get('seed') ? Number(params.get('seed')) >>> 0 : DEFAULT_SEED;
const dprParam = params.get('dpr') ? Number(params.get('dpr')) : undefined;

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

const physics = new PhysicsWorld();
const world = buildWorld(scene, physics);
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

const fire = new FireControl((ox, oy, oz, dx, dy, dz, maxDist) =>
  collectRayChain(physics.static, ox, oy, oz, dx, dy, dz, maxDist));
const viewmodel = new Viewmodel(camera);
viewmodel.setVisible(mode === 'realtime'); // 캡처는 샷 데이터가 명시할 때만 표시

// HANJI 판 등록: 가시 판(_hanji) ↔ 콜라이더(_hanji_col) 쌍의 가시 쪽
const hanjiPanes = new Map();
scene.traverse((o) => {
  if (o.isMesh && o.visible && o.userData.surface === 'HANJI' && o.name.endsWith('_hanji')) {
    hanjiPanes.set(o.name, o);
  }
});
const hanji = new HanjiState();
for (const id of hanjiPanes.keys()) hanji.register(id);
const opacityApplier = new OpacityApplier(hanjiPanes);
const fx = new FxPlaceholder(scene);

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
  hanji.registerHit(paneId, [_uvVec.x / width + 0.5, _uvVec.y / height + 0.5]);
});

/**
 * 샷 구성 적용 — 카메라 + 태양 + 등롱 (world:tod 이벤트는 P3 sky 소유).
 * P2A: 샷 데이터의 viewmodel(표시·무기·ADS)과 actions(결정적 사격)도 여기서
 * 해석한다. actions는 opts.runActions=true(하네스 setShot 경로)에서만 실행 —
 * 프리웜의 applyShot이 부팅 중 사격 상태를 오염시키지 않게 한다.
 */
function applyShot(shot, opts = {}) {
  camera.position.set(...shot.cam.pos);
  camera.lookAt(...shot.cam.target);
  camera.fov = shot.cam.fov;
  camera.updateProjectionMatrix();
  applySunConfig(lighting, shot.sun, shot.hemi);
  for (const l of world.lanternLights) l.intensity = shot.lantern;

  viewmodel.setVisible(!!shot.viewmodel);
  if (shot.viewmodel) {
    fire.switchTo(shot.viewmodel.weapon);
    fire.current.adsBlend = shot.viewmodel.ads ?? 0;
  }
  viewmodel.update(fire.current);

  if (opts.runActions && shot.actions) {
    for (const act of shot.actions) {
      if (act.type !== 'fire') throw new Error(`unknown shot action: ${act.type}`);
      fire.switchTo(act.weapon);
      for (let i = 0; i < (act.rounds ?? 1); i++) fire.fire(act.eye);
    }
  }
}

function applyDefaultView() {
  applySunConfig(lighting, DEFAULT_VIEW.sun, DEFAULT_VIEW.hemi);
  for (const l of world.lanternLights) l.intensity = DEFAULT_VIEW.lantern;
  camera.fov = 70;
  camera.updateProjectionMatrix();
  player.applyCamera(camera);
  viewmodel.setVisible(mode === 'realtime'); // 샷 적용(프리웜 포함)이 남긴 표시 상태 복원
  viewmodel.update(fire.current);
}

handleResize(renderer, camera);

let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

const harness = installHarness({
  renderer, scene, camera, player, input, physics, world,
  stats, shotsByName: SHOTS_BY_NAME, applyShot, applyDefaultView,
  readyPromise, mode,
  // P2A 배선
  fire, viewmodel, hanji, fx,
  viewmodelAuditHook: ({ boost }) => setupViewmodelAudit({
    scene, camera, boost,
    // 순수 태양만 — applyDefaultView는 카메라도 움직여 카드 투영이 깨진다
    applySun: () => applySunConfig(lighting, DEFAULT_VIEW.sun, DEFAULT_VIEW.hemi),
  }),
});

/* ------------------------------------------------------------- 부팅 */
const warm = await prewarmShaders({
  renderer, scene, camera,
  shots: SHOTS,
  applyShot,
  restoreDefault: applyDefaultView,
});
console.info(`[boot] prewarm programs=${warm.programsAfter} (+${warm.compiled}) ${warm.ms}ms`);
window.__prewarm = warm;

fire.reset();             // 프리웜의 applyShot(viewmodel 샷)이 만진 무기 상태를 부팅 초기로
physics.markBootBodies(); // 부팅 로스터 스냅샷 — resetState가 런타임 스폰만 걷어낸다 (감사 A1)
bus.markBoot();           // 구독 스냅샷 (감사 A4)
clock.markBootDone();
console.info(`[boot] ready in ${clock.bootMs.toFixed(0)}ms mode=${mode} seed=${seed}`);
readyResolve();

/* --------------------------------------------------------- 메인 루프 */
if (mode === 'realtime') {
  const MAX_SUBSTEPS = 5;
  let accum = 0;
  const loop = (ts) => {
    requestAnimationFrame(loop);
    const cpuT0 = clock.wallNowMs(); // CPU 프레임 시간(GPU 제외) 계측 시작
    clock.tickRealtime(ts);
    harness._internal.scriptTick();
    accum += clock.dt;
    let steps = 0;
    while (accum >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      harness._internal.simSubstep(); // player + fire + physics — fixed 경로와 동일 배선
      accum -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accum = 0; // 백로그 폐기 — 나선 방지
    harness._internal.renderFrame(cpuT0);
  };
  requestAnimationFrame(loop);
}
// fixed 모드는 루프 없음 — __harness.stepFrames()만 시간을 전진시킨다
