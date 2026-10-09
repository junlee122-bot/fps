/**
 * test-fixtures/ragdoll/worlds.mjs — 래그돌 시험 장면 (합성 + 헤드리스 경내). `test/` 밖(HANDOFF §4-3).
 *
 * 합성: 바닥, 0.6 m 단, 0.3 mm 창호지 판(HANJI), 24 mm 창살(WOOD_LATTICE) — 설계서 §6-5.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../../src/physics/index.js';
import { buildWorld } from '../../src/world/level.js';

/** 축 정렬 상자 → 바깥 노멀 CCW 삼각형 12개 (Float32Array, 9 float/tri) */
export function boxTris(cx, cy, cz, hx, hy, hz) {
  const v = (sx, sy, sz) => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
  const quads = [
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)],
    [v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), v(-1, -1, -1)],
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)],
    [v(-1, -1, 1), v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1)],
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)],
    [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)],
  ];
  const out = new Float32Array(12 * 9);
  let k = 0;
  for (const [a, b, c, d] of quads) {
    for (const p of [a, b, c, a, c, d]) { out[k++] = p[0]; out[k++] = p[1]; out[k++] = p[2]; }
  }
  return out;
}

/** 합성 장면 상수 */
export const SYNTH = Object.freeze({
  paneZ: -2,              // 판 중심 z (두께 0.3 mm, x ∈ [−1.5, 1.5], y ∈ [0, 2.5] — 바닥까지 막아 판 아래로 지나가는 경로가 없다)
  paneHalfT: 0.00015,
  latticeX: 6,            // 창살 패널 x 중심, 살은 z = latticeZ 평면
  latticeZ: -2,
  stepZ0: 3,              // 0.6 m 단: z ∈ [3, 8]
});

export function buildSynthetic(physics = new PhysicsWorld()) {
  const S = physics.static;
  S.addTriangles(boxTris(0, -0.5, 0, 20, 0.5, 20), 12, 'GRANITE', 1, 'floor');
  S.addTriangles(boxTris(0, 0.3, 5.5, 3, 0.3, 2.5), 12, 'WOOD_PLANK', 1, 'step_0.6');
  S.addTriangles(boxTris(0, 1.25, SYNTH.paneZ, 1.5, 1.25, SYNTH.paneHalfT), 12, 'HANJI', 1, 'pane');
  // 24 mm 창살: 세로 0.16 m 간격 + 가로 3
  for (let i = -6; i <= 6; i++) {
    S.addTriangles(boxTris(SYNTH.latticeX + i * 0.16, 1.45, SYNTH.latticeZ, 0.012, 1.0, 0.012), 12, 'WOOD_LATTICE', 1, `lat_v_${i}`);
  }
  for (const y of [0.8, 1.45, 2.1]) {
    S.addTriangles(boxTris(SYNTH.latticeX, y, SYNTH.latticeZ, 1.0, 0.012, 0.012), 12, 'WOOD_LATTICE', 1, `lat_h_${y}`);
  }
  physics.build();
  return physics;
}

export function buildCompound() {
  const physics = new PhysicsWorld();
  buildWorld(new THREE.Scene(), physics);
  physics.build();
  return physics;
}
