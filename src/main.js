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
import { setGlobalSeed, DEFAULT_SEED } from './core/rng.js';
import { installHarness } from './core/harness.js';
import { prewarmShaders } from './core/prewarm.js';
import { StatsRecorder } from './core/stats.js';
import { createRenderer, createCamera, createLighting, applySunConfig, handleResize } from './render/renderer.js';
import { PhysicsWorld } from './physics/index.js';
import { buildGreybox } from './world/greybox.js';
import { PlayerInput } from './player/input.js';
import { Player } from './player/player.js';
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
const world = buildGreybox(scene, physics);
const bvhInfo = physics.build();
console.info(`[boot] bvh tris=${bvhInfo.tris} nodes=${bvhInfo.nodes} build=${bvhInfo.buildMs.toFixed(1)}ms`);

const input = new PlayerInput();
if (mode === 'realtime') input.attach(canvas);
const player = new Player(physics, input);

const stats = new StatsRecorder(renderer);

/** 샷 구성 적용 — 카메라 + 태양 + 등롱 (world:tod 이벤트는 P3 sky 소유) */
function applyShot(shot) {
  camera.position.set(...shot.cam.pos);
  camera.lookAt(...shot.cam.target);
  camera.fov = shot.cam.fov;
  camera.updateProjectionMatrix();
  applySunConfig(lighting, shot.sun, shot.hemi);
  for (const l of world.lanternLights) l.intensity = shot.lantern;
}

function applyDefaultView() {
  applySunConfig(lighting, DEFAULT_VIEW.sun, DEFAULT_VIEW.hemi);
  for (const l of world.lanternLights) l.intensity = DEFAULT_VIEW.lantern;
  camera.fov = 70;
  camera.updateProjectionMatrix();
  player.applyCamera(camera);
}

handleResize(renderer, camera);

let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

const harness = installHarness({
  renderer, scene, camera, player, input, physics, world,
  stats, shotsByName: SHOTS_BY_NAME, applyShot, applyDefaultView,
  readyPromise, mode,
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

clock.markBootDone();
console.info(`[boot] ready in ${clock.bootMs.toFixed(0)}ms mode=${mode} seed=${seed}`);
readyResolve();

/* --------------------------------------------------------- 메인 루프 */
if (mode === 'realtime') {
  const MAX_SUBSTEPS = 5;
  let accum = 0;
  const loop = (ts) => {
    requestAnimationFrame(loop);
    clock.tickRealtime(ts);
    harness._internal.scriptTick();
    accum += clock.dt;
    let steps = 0;
    while (accum >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      player.update(PHYSICS_DT);
      physics.step(PHYSICS_DT);
      accum -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accum = 0; // 백로그 폐기 — 나선 방지
    harness._internal.renderFrame();
  };
  requestAnimationFrame(loop);
}
// fixed 모드는 루프 없음 — __harness.stepFrames()만 시간을 전진시킨다
