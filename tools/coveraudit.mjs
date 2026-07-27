#!/usr/bin/env node
/**
 * tools/coveraudit.mjs — §5 레벨 규칙 자동 검증 (P1-BRIEF §4).
 *
 *   "플레이어가 서 있는 어떤 지점에서도, 관통 불가 엄폐물까지 2초 이동 이내"
 *
 * 1. 이동 가능 영역을 1m 그리드로 샘플링 (다층: 마루·기단·누각 데크 포함)
 * 2. 스폰에서 도달 가능한 셀만 평가 (벽 너머·지붕 위는 대상 아님)
 * 3. VERTICAL_COVER_SURFACES(GRANITE·BRONZE) 수직면 인접 셀을 다중 소스로
 *    Dijkstra — **경로** 거리 (직선 아님. 벽을 뚫고 갈 수 없다)
 * 4. 최대 속도(질주 6.7 m/s) × 2s = 13.4m 초과 셀을 히트맵 PNG로 출력
 * 5. 위반 셀이 도달 가능 셀의 2%를 초과하면 exit 1
 *
 * 위반은 레벨 수정으로 해결한다. 임계값을 올리지 마라.
 */

import * as THREE from 'three';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { VERTICAL_COVER_SURFACES } from '../src/core/surfaces.js';
import { PhysicsWorld, MASK, surfaceName } from '../src/physics/index.js';
import { buildWorld } from '../src/world/level.js';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const OUT = resolve(args.out ?? 'tmp/coveraudit.png');

const GRID = 1.0;                    // m
const HALF = 43;                     // 담장 안쪽 평가 범위
const SPRINT = 6.7;                  // m/s — player.js SPRINT_SPEED와 일치해야 함
const LIMIT_S = 2.0;
const MAX_DIST = SPRINT * LIMIT_S;   // 13.4m
const VIOLATION_LIMIT_PCT = 2.0;
const STEP_UP = 1.0;                 // 셀 간 허용 단차 (점프 최고 ~1.15m)
// 인접 판정 거리: 1m 그리드에서 플레이어는 셀 중심에서 ~0.7m까지 벗어날 수 있다.
// 1.8 = 팔 닿는 엄폐 1.1 + 셀 내 도달 0.7. 방향 16개 — 8개로는 소단면 프롭
// (정료대 샤프트 0.55m)이 각도 사이로 빠진다 (실측 디버그로 확인).
const COVER_PROBE = 1.8;
const COVER_DIRS = 16;
const SPAWN = { x: 0, z: 24 };

const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);
physics.build();
const S = physics.static;

// 셀 중심을 0.5 오프셋 — 정수 좌표에 놓인 박스 면(기단 전면 z=-18 등)과
// 레이 시작점이 정확히 겹치는 경계 퇴화를 피한다
const N = HALF * 2; // 86
const cellX = (i) => -HALF + 0.5 + i * GRID;
const cellZ = (j) => -HALF + 0.5 + j * GRID;

/* ---------------- 1. 다층 레벨 샘플링 ---------------- */
// 위에서 아래로 멀티히트 레이 → 후보 지면들 → 캡슐이 서지는 레벨만
const hit = physics._hit;
function groundLevels(x, z) {
  const levels = [];
  let y = 30;
  for (let k = 0; k < 8; k++) {
    if (!S.raycast(x, y, z, 0, -1, 0, y + 2, MASK.CHARACTER, hit)) break;
    const gy = hit.py;
    if (hit.ny > 0.64) { // 걷기 가능 경사 (cos 50°)
      // 캡슐 여유 검사 (r=0.30, h=1.78 — 플레이어보다 살짝 관대)
      const p0y = gy + 0.05 + 0.30;
      const p1y = gy + 0.05 + 1.72 - 0.30;
      const n = S.overlapCapsule(x, p0y, z, x, p1y, z, 0.30, MASK.CHARACTER, 0);
      if (n === 0) levels.push(+gy.toFixed(3));
    }
    y = gy - 0.05;
    if (y < 0) break;
  }
  return levels;
}

const cells = []; // {i, j, levels: [y...]}
const levelIndex = new Map(); // "i,j,li" → node id
const nodes = []; // {i, j, y}
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const ls = groundLevels(cellX(i), cellZ(j));
    for (let li = 0; li < ls.length; li++) {
      levelIndex.set(`${i},${j},${li}`, nodes.length);
      nodes.push({ i, j, li, y: ls[li] });
    }
    cells.push({ i, j, levels: ls });
  }
}
const cellLevels = (i, j) => (i >= 0 && j >= 0 && i < N && j < N) ? cells[i * N + j].levels : [];

/* ---------------- 2. 인접 그래프 (시야 아님 — 통행) ---------------- */
function passable(x1, y1, z1, x2, y2, z2) {
  const base = Math.max(y1, y2);
  for (const h of [0.45, 1.35]) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (S.raycastAny(x1, base + h, z1, dx / len, 0, dz / len, len, MASK.CHARACTER)) return false;
  }
  return true;
}

const adj = nodes.map(() => []);
const DIRS = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2]];
for (let ni = 0; ni < nodes.length; ni++) {
  const a = nodes[ni];
  for (const [di, dj, cost] of DIRS) {
    const lvls = cellLevels(a.i + di, a.j + dj);
    for (let li = 0; li < lvls.length; li++) {
      if (Math.abs(lvls[li] - a.y) > STEP_UP) continue;
      const nj = levelIndex.get(`${a.i + di},${a.j + dj},${li}`);
      if (nj === undefined) continue;
      const b = nodes[nj];
      if (!passable(cellX(a.i), a.y, cellZ(a.j), cellX(b.i), b.y, cellZ(b.j))) continue;
      adj[ni].push([nj, cost]);
      adj[nj].push([ni, cost]);
    }
  }
}

/* ---------------- 3. 스폰 도달 가능 집합 ---------------- */
function nearestNode(x, z) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < nodes.length; k++) {
    const d = Math.hypot(cellX(nodes[k].i) - x, cellZ(nodes[k].j) - z) + Math.abs(nodes[k].y) * 0.01;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
const spawnNode = nearestNode(SPAWN.x, SPAWN.z);
const reachable = new Uint8Array(nodes.length);
{
  const q = [spawnNode];
  reachable[spawnNode] = 1;
  while (q.length) {
    const n = q.pop();
    for (const [m] of adj[n]) if (!reachable[m]) { reachable[m] = 1; q.push(m); }
  }
}

/* ---------------- 4. 엄폐 소스 판정 ---------------- */
const coverIdx = new Set(VERTICAL_COVER_SURFACES.map((s) => {
  // surface-registry의 인덱스 공간으로 변환
  let idx = -1;
  for (let k = 0; k < 16; k++) if (surfaceName(k) === s) { idx = k; break; }
  return idx;
}));

/**
 * 엄폐면 판정: 두 높이(0.40 / 0.55) 모두에서 같은 방향의 엄폐 표면 수직면에
 * 닿아야 한다. 기단(0.6m — 계약상 '주 엄폐물')은 잡히고, 그보다 낮은
 * 초석(0.3m)·턱은 잡히지 않는다 (판정 근거는 README P1 절에 기록).
 */
function isCoverAdjacent(x, y, z) {
  for (let d = 0; d < COVER_DIRS; d++) {
    const a = (d / COVER_DIRS) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let both = true;
    for (const h of [0.40, 0.55]) {
      if (!S.raycast(x, y + h, z, dx, 0, dz, COVER_PROBE, MASK.CHARACTER, hit) ||
          !coverIdx.has(hit.surface) || Math.abs(hit.ny) >= 0.5) {
        both = false;
        break;
      }
    }
    if (both) return true;
  }
  return false;
}

/* ---------------- 5. 다중 소스 Dijkstra (경로 거리) ---------------- */
const dist = new Float64Array(nodes.length).fill(Infinity);
const isCover = new Uint8Array(nodes.length);
// 단순 이진 힙
const heap = [];
function push(d, n) {
  heap.push([d, n]);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}
function pop() {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}
for (let k = 0; k < nodes.length; k++) {
  if (!reachable[k]) continue;
  if (isCoverAdjacent(cellX(nodes[k].i), nodes[k].y, cellZ(nodes[k].j))) {
    isCover[k] = 1;
    dist[k] = 0;
    push(0, k);
  }
}
while (heap.length) {
  const [d, n] = pop();
  if (d > dist[n]) continue;
  for (const [m, c] of adj[n]) {
    if (!reachable[m]) continue;
    const nd = d + c * GRID;
    if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
  }
}

/* ---------------- 6. 판정 + 히트맵 ---------------- */
let reachCount = 0, violCount = 0;
const worst = [];
for (let k = 0; k < nodes.length; k++) {
  if (!reachable[k]) continue;
  reachCount++;
  if (dist[k] > MAX_DIST) {
    violCount++;
    worst.push({ x: cellX(nodes[k].i), z: cellZ(nodes[k].j), y: nodes[k].y, dist: +(dist[k] === Infinity ? -1 : dist[k].toFixed(1)) });
  }
}
worst.sort((a, b) => (b.dist === -1 ? 1e9 : b.dist) - (a.dist === -1 ? 1e9 : a.dist));
const violPct = reachCount ? (violCount / reachCount) * 100 : 100;

// 히트맵: 셀당 최저 레벨 기준 (다층은 최악값)
const SCALE = 8;
const png = new PNG({ width: N * SCALE, height: N * SCALE });
function put(i, j, r, g, b) {
  for (let dy = 0; dy < SCALE; dy++) {
    for (let dx = 0; dx < SCALE; dx++) {
      const p = (((N - 1 - j) * SCALE + dy) * N * SCALE + i * SCALE + dx) * 4;
      png.data[p] = r; png.data[p + 1] = g; png.data[p + 2] = b; png.data[p + 3] = 255;
    }
  }
}
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const ls = cells[i * N + j].levels;
    let cls = 'void', worstD = -1;
    for (let li = 0; li < ls.length; li++) {
      const k = levelIndex.get(`${i},${j},${li}`);
      if (k === undefined || !reachable[k]) continue;
      if (isCover[k]) { if (cls === 'void') { cls = 'cover'; } continue; }
      const d = dist[k];
      cls = 'walk';
      worstD = Math.max(worstD, d === Infinity ? 1e9 : d);
    }
    if (cls === 'void') put(i, j, 40, 42, 46);
    else if (cls === 'cover') put(i, j, 70, 110, 200);
    else if (worstD > MAX_DIST) put(i, j, 220, 50, 50);
    else {
      const t = Math.min(1, worstD / MAX_DIST);
      put(i, j, Math.round(60 + 160 * t), Math.round(200 - 90 * t), 60);
    }
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, PNG.sync.write(png));

const ok = violPct <= VIOLATION_LIMIT_PCT;
console.log(JSON.stringify({
  ok,
  rule: `모든 도달 가능 지점 → ${VERTICAL_COVER_SURFACES.join('/')} 수직 엄폐까지 경로 ≤ ${MAX_DIST}m (질주 ${SPRINT}m/s × ${LIMIT_S}s)`,
  nodes: nodes.length,
  reachable: reachCount,
  coverSources: [...isCover].reduce((a, v) => a + v, 0),
  violations: violCount,
  violationPct: +violPct.toFixed(2),
  limitPct: VIOLATION_LIMIT_PCT,
  heatmap: OUT,
  worst: worst.slice(0, 20),
}, null, 2));
process.exit(ok ? 0 : 1);
