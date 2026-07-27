#!/usr/bin/env node
/**
 * tools/surfaceaudit.mjs — 표면 전수 매핑 감사 (PATCH-001-D / P1-BRIEF §4).
 *
 * 월드 씬그래프를 Node에서 직접 빌드해 전수 순회한다.
 * - 표면 태그(userData.surface)가 없거나 SURFACES에 없는 메시가 1개라도 있으면 exit 1
 * - BRONZE 배치 수가 COVER_PLACEMENT_LIMITS.BRONZE를 초과하면 exit 1 (PATCH-001-A)
 *
 * 기본 표면이 금지(PATCH-001-D)이므로 이 툴이 유일한 안전망이다.
 */

import * as THREE from 'three';
import { SURFACES, COVER_PLACEMENT_LIMITS } from '../src/core/surfaces.js';
import { PhysicsWorld } from '../src/physics/index.js';
import { buildWorld } from '../src/world/level.js';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();

const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);

// harnesstest 전용 훅 (P1.5-BRIEF §3 케이스 6): 미매핑 메시를 인위 주입해
// 이 감사가 실제로 잡아내는지 검증한다. 실사용 경로에서는 쓰지 않는다.
if (args['inject-unmapped']) {
  const rogue = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  rogue.name = 'harnesstest_rogue_untagged';
  scene.add(rogue);
}

const unmapped = [];
const surfaceCounts = new Map();
let meshCount = 0;
const _box = new THREE.Box3();

scene.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  meshCount++;
  const s = o.userData?.surface;
  const instances = o.isInstancedMesh ? o.count : 1;
  if (s === undefined || s === null || !(s in SURFACES)) {
    // 경로 구성
    const path = [];
    let p = o;
    while (p) { path.unshift(p.name || p.type); p = p.parent; }
    let bbox = null;
    try {
      _box.setFromObject(o);
      bbox = {
        min: _box.min.toArray().map((v) => +v.toFixed(2)),
        max: _box.max.toArray().map((v) => +v.toFixed(2)),
      };
    } catch { /* 빈 지오메트리 */ }
    unmapped.push({ name: o.name || '(unnamed)', type: o.type, path: path.join('/'), surface: s ?? null, bbox });
  } else {
    surfaceCounts.set(s, (surfaceCounts.get(s) ?? 0) + instances);
  }
});

const limitViolations = [];
for (const [surf, limit] of Object.entries(COVER_PLACEMENT_LIMITS)) {
  const n = surfaceCounts.get(surf) ?? 0;
  if (n > limit) limitViolations.push({ surface: surf, placed: n, limit });
}

const ok = unmapped.length === 0 && limitViolations.length === 0;
console.log(JSON.stringify({
  ok,
  meshesChecked: meshCount,
  unmappedCount: unmapped.length,
  unmapped,
  placementLimits: Object.fromEntries(
    Object.entries(COVER_PLACEMENT_LIMITS).map(([s, l]) => [s, { placed: surfaceCounts.get(s) ?? 0, limit: l }])
  ),
  limitViolations,
  surfaceCounts: Object.fromEntries([...surfaceCounts.entries()].sort()),
}, null, 2));
process.exit(ok ? 0 : 1);
