#!/usr/bin/env node
/**
 * tools/fxaudit.mjs — 표면 fx 프로파일 15종 전수·구별성 게이트 (P2B-BRIEF §2).
 *
 * PATCH-003-B 3항("관측 불가능한 표면은 새 재료가 아니라 자유변수다")의 검증:
 *  1. surfaces.js fx 키 15종 전부에 프로파일이 등록되어 있는가 (null·미등록 → exit 1)
 *  2. 모든 쌍이 5축(입자 수·초기 속도·수명·크기·중력 계수) 중 최소 2축에서
 *     상대차 15% 초과로 구별되는가 — 특히 ROOF_SOIL vs EARTH_WALL
 *  3. 방출 실측: 15종 표면 합성 월드에 실제 사격 → 방출 입자의 파라미터가
 *     해당 표면 프로파일과 일치하는가 (배선 검증 — 표가 아니라 실행을 믿는다)
 *
 * 음성 훅 (HARNESS.md §0): --test-clone <fxA>=<fxB> 는 A 프로파일을 B의
 * 사본으로 바꾼 입력 — 반드시 exit 1이어야 하며 출력에 testOverride가 박힌다.
 * 게이트 판정 경로의 기본값은 바꾸지 않는다.
 */

import * as THREE from 'three';
import { SURFACES, PenClass } from '../src/core/surfaces.js';
import {
  FX_PROFILES, DISTINCT_AXES, DISTINCT_AXES_MIN, DISTINCT_REL_MIN,
  axisScalar, checkDistinctness,
} from '../src/fx/profiles.js';
import { PhysicsWorld } from '../src/physics/index.js';
import { collectRayChain } from '../src/physics/raychain.js';
import { FireControl } from '../src/weapons/firecontrol.js';
import { FxSystem } from '../src/fx/index.js';
import { setGlobalSeed, DEFAULT_SEED } from '../src/core/rng.js';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const CLONE = typeof args['test-clone'] === 'string' ? args['test-clone'] : null;

/** 검사 대상 프로파일 집합 — 음성 훅이 지정되면 사본으로 오염시킨 복제본 */
let profiles = FX_PROFILES;
let testOverride;
if (CLONE) {
  const [a, b] = CLONE.split('=');
  if (!FX_PROFILES[a] || !FX_PROFILES[b]) {
    console.error(`--test-clone: unknown fx key in "${CLONE}"`);
    process.exit(2);
  }
  profiles = { ...FX_PROFILES, [a]: { ...FX_PROFILES[b] } };
  testOverride = `clone ${a}=${b} — harnesstest 전용, 계약 판정 무효`;
}

const report = { ok: true, tool: 'fxaudit', ...(testOverride ? { testOverride } : {}) };
const problems = [];

/* ---- 1. 전수 등록 ---- */
const fxKeys = [...new Set(Object.values(SURFACES).map((s) => s.fx).filter(Boolean))];
report.surfaceFxKeys = fxKeys.length;
for (const k of fxKeys) {
  const p = profiles[k];
  if (!p) problems.push(`프로파일 미등록: ${k}`);
  else {
    for (const ax of DISTINCT_AXES) {
      if (axisScalar(p, ax) == null || Number.isNaN(axisScalar(p, ax))) {
        problems.push(`프로파일 ${k}: 축 ${ax} 값 없음`);
      }
    }
  }
}
const extra = Object.keys(profiles).filter((k) => !fxKeys.includes(k));
if (extra.length) problems.push(`surfaces.js에 없는 잉여 프로파일: ${extra.join(',')}`);

/* ---- 2. 전 쌍 구별성 ---- */
const dist = checkDistinctness(profiles);
report.pairs = dist.pairs.length;
report.pairsFailed = dist.pairs.filter((p) => !p.ok).map((p) => ({ a: p.a, b: p.b, axes: p.axes }));
if (!dist.ok) {
  for (const p of report.pairsFailed) {
    problems.push(`구별 불가 쌍: ${p.a} vs ${p.b} (상이 축 ${p.axes.length}개 < ${DISTINCT_AXES_MIN})`);
  }
}
// 핵심 쌍 명시 보고 (PATCH-003-A 승인 근거)
const soilPair = dist.pairs.find(
  (p) => (p.a === 'soil_puff' && p.b === 'dust_burst') || (p.a === 'dust_burst' && p.b === 'soil_puff'),
);
report.roofSoilVsEarthWall = { axes: soilPair.axes, ok: soilPair.ok };

/* ---- 3. 방출 실측 — 15종 표면 합성 월드 사격 ---- */
setGlobalSeed(DEFAULT_SEED);
const surfaceIds = Object.keys(SURFACES);
const scene = new THREE.Scene();
const physics = new PhysicsWorld();
const SPACING = 8;
surfaceIds.forEach((sid, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.4));
  m.name = `target_${sid}`;
  m.position.set(i * SPACING, 1.5, -6);
  m.updateMatrixWorld(true);
  physics.addStaticMesh(m, sid);
});
physics.build();

const fxSystem = new FxSystem(scene, {
  spawnBody: () => ({ id: -1 }),  // 기와 낙하는 이 감사의 관심사 아님 — 스텁
  despawnBody: () => {},
});
const fire = new FireControl((...a) => collectRayChain(physics.static, ...a));
// 방출 실측이 오염된 프로파일 집합을 쓰도록 — 파티클 풀은 프로파일 테이블을
// emit 시점에 조회하므로, 음성 훅에서는 데이터 검사(1·2)가 게이트를 수행한다.

const emission = {};
for (let i = 0; i < surfaceIds.length; i++) {
  const sid = surfaceIds[i];
  const before = fxSystem.particles.active;
  const beforeEmitted = fxSystem.particles.emittedTotal;
  fire.fire({ pos: [i * SPACING, 1.5, 0], yaw: 0, pitch: 0 });
  const expected = FX_PROFILES[SURFACES[sid].fx];
  const emitted = fxSystem.particles.emittedTotal - beforeEmitted;
  // 첫 레이어(대상 박스)의 방출 수는 프로파일 count와 일치해야 한다.
  // 관통 시 뒤 표면(없음 — 8m 간격 단일 박스)이 추가 방출할 수 있으나 배치상 없음.
  const newIdx = [];
  for (let k = before; k < fxSystem.particles.active; k++) newIdx.push(k);
  const profs = new Set(newIdx.map((k) => fxSystem.particles.profileOf[k]));
  emission[sid] = {
    fx: SURFACES[sid].fx,
    emitted,
    expectedCount: expected.count,
    profilesSeen: [...profs],
  };
  if (!emitted || emitted % expected.count !== 0) {
    problems.push(`방출 실측 불일치: ${sid} — ${emitted}개 방출 (기대 ${expected.count}의 배수)`);
  }
  if (!profs.has(SURFACES[sid].fx)) {
    problems.push(`방출 프로파일 불일치: ${sid} — ${[...profs].join(',')} (기대 ${SURFACES[sid].fx})`);
  }
}
report.emission = emission;

report.ok = problems.length === 0;
report.problems = problems;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
