#!/usr/bin/env node
/**
 * tools/audioaudit.mjs — 오디오 오클루전 · 잔향 · 결정성 게이트 (P4-BRIEF §2-5 · §2-6, TAB-B-AUDIO).
 *
 * fxaudit 와 같은 패턴: 표가 아니라 실행을 믿는다.
 *
 *  [0] 차폐 표면 목록 — surfaces.js + 월드에서 **기계적으로** 도출 (판정 1-3)
 *      - DECAL(penClass) 제외: 동결 계약이 audio:null "하부재를 따름"
 *      - 지면 판 제외: 월드의 모든 배치 윗면 ≤ GROUND_PLANE_TOP_M — 음원과 청자 사이에 벽으로 설 수 없다
 *      도출 결과가 런타임(src/audio/occlusion.js isPassThrough)과 다르면 exit 1
 *  [1] 차폐 표면 전수에 오클루전 프로파일, 레이가 맞을 수 있는 표면 전수에 흡음계수
 *  [2] OfflineAudioContext(48 kHz) 렌더: 같은 시험 음원을 표면 한 겹(refCm) 너머로 → 4축 측정
 *      (차단 주파수 · 감쇠 · 잔향 결합 · 지연). 판정은 **들리는 축**만 센다(지연은 보고 전용, measure.js).
 *      - 관통 등급이 다른 쌍: 들리는 축 2개 이상, 아니면 exit 1
 *      - 같은 등급 쌍: 보고만 (비슷하게 들리는 게 물리적으로 맞으면 차이를 지어내지 않는다)
 *      - ROOF_SOIL vs EARTH_WALL: 등급 무관 2개 이상 (PATCH-003-B 3항)
 *  [3] BRONZE 공명 (§2-3): bronze_resonate 렌더 T60 ≥ 3 s
 *  [4] 공간 잔향 (§2-4): 마당 · 대청 · 방 · 회랑을 월드 레이로 측정 — 6쌍 전부 RT60(중역) 또는
 *      확산 수준에서 15% 초과 상이
 *  [5] 결정성 (§2-6): 고정 시나리오와 시험 음원 집합을 **독립 페이지 2개**에서 렌더 → SHA-256 동일.
 *      해시는 머신 · 브라우저 빌드 단위로 보장한다(판정 1-10). baseline.mjs 편입은 병합 시 A 탭
 *
 * 음성 훅 (HARNESS §0 · 케이스 21 — 번호는 병합 시 A 탭이 부여):
 *   --test-clone <A>=<B>  A 표면 프로파일을 B 의 사본으로 바꾼 입력. 반드시 exit 1, 출력에 testOverride.
 *   게이트 판정 경로의 기본값은 바꾸지 않는다.
 *
 * 출력: JSON (stdout). --out <file> 이면 같은 JSON 을 파일에도 쓴다.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { SURFACES, PenClass } from '../src/core/surfaces.js';
import { PhysicsWorld, MASK } from '../src/physics/index.js';
import { collectRayChain } from '../src/physics/raychain.js';
import { buildWorld } from '../src/world/level.js';
import {
  OCCLUSION_PROFILES, GROUND_PLANE_TOP_M, isPassThrough, occluderSurfaces,
} from '../src/audio/occlusion.js';
import { ABSORPTION, probeSpace } from '../src/audio/reverb.js';
import { measureProfile, distinctAxes, AXES, AUDIBLE_AXES, DISTINCT } from '../src/audio/measure.js';
import { impactBuffer, measureT60 } from '../src/audio/synth.js';
import { TARGET_RATE } from '../src/audio/assets/manifest.js';
import { startServer } from './lib/server.mjs';
import { launchBrowser } from './lib/browser.mjs';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const CLONE = typeof args['test-clone'] === 'string' ? args['test-clone'] : null;
const problems = [];
const report = {};

let profiles = OCCLUSION_PROFILES;
if (CLONE) {
  const [a, b] = CLONE.split('=');
  if (!OCCLUSION_PROFILES[a] || !OCCLUSION_PROFILES[b]) {
    console.error(`--test-clone: unknown surface in "${CLONE}"`);
    process.exit(2);
  }
  profiles = { ...OCCLUSION_PROFILES, [a]: { ...OCCLUSION_PROFILES[b] } };
  report.testOverride = `clone ${a}=${b} — 케이스 21 전용, 계약 판정 무효`;
}

/* ---------------------------------------------------------------- [0] 차폐 표면 도출 */
const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);
physics.build();
scene.updateMatrixWorld(true);

const placement = new Map(); // surface → { count, maxTop }
{
  const box = new THREE.Box3(), m = new THREE.Matrix4();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const s = o.userData?.surface;
    if (!s) return;
    o.geometry.computeBoundingBox();
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++) {
      box.copy(o.geometry.boundingBox);
      if (o.isInstancedMesh) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); } else m.copy(o.matrixWorld);
      box.applyMatrix4(m);
      const e = placement.get(s) ?? { count: 0, maxTop: -Infinity };
      e.count++; e.maxTop = Math.max(e.maxTop, box.max.y);
      placement.set(s, e);
    }
  });
}
const derivedExcluded = {};
for (const s of Object.keys(SURFACES)) {
  if (SURFACES[s].penClass === PenClass.DECAL) derivedExcluded[s] = 'DECAL — surfaces.js audio:null "하부재를 따름" (동결 계약)';
  else if (placement.has(s) && placement.get(s).maxTop <= GROUND_PLANE_TOP_M) {
    derivedExcluded[s] = `지면 판 — 월드 배치 ${placement.get(s).count}개 전부 윗면 ≤ ${GROUND_PLANE_TOP_M} m (최고 ${placement.get(s).maxTop.toFixed(2)} m)`;
  }
}
const derivedOccluders = Object.keys(SURFACES).filter((s) => !(s in derivedExcluded));
const runtimeOccluders = occluderSurfaces();
report.excluded = derivedExcluded;
report.occluders = derivedOccluders;
report.placement = Object.fromEntries([...placement].map(([k, v]) => [k, { count: v.count, maxTopM: +v.maxTop.toFixed(3) }]));
if (derivedOccluders.join() !== runtimeOccluders.join()) {
  problems.push(`[0] 차폐 표면 불일치 — 월드 도출 [${derivedOccluders}] ≠ 런타임 [${runtimeOccluders}]`);
}

/* ---------------------------------------------------------------- [1] 프로파일 · 흡음 전수 */
for (const s of derivedOccluders) if (!profiles[s]) problems.push(`[1] 오클루전 프로파일 없음: ${s}`);
for (const s of Object.keys(SURFACES)) {
  if (SURFACES[s].penClass === PenClass.DECAL) continue;
  if (!ABSORPTION[s]) problems.push(`[1] 흡음계수 없음: ${s}`);
}
for (const s of Object.keys(profiles)) if (isPassThrough(s)) problems.push(`[1] 통과 표면에 프로파일이 있음(거짓 구별 위험): ${s}`);

/* ---------------------------------------------------------------- 브라우저 렌더 */
const server = await startServer();
const browser = await launchBrowser();

async function renderSet() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}/__audioaudit`); // 같은 출처 문서 (404 본문) — 모듈 import 용
  const out = await page.evaluate(async ({ surfaces, profiles }) => {
    const m = await import('/src/audio/render.js');
    const toArr = (f) => Array.from(f);
    const probes = { __ref: toArr(await m.renderProbe(null, { profiles })) };
    for (const s of surfaces) probes[s] = toArr(await m.renderProbe(s, { profiles }));
    const [L, R] = await m.renderScenario();
    const bytes = new Uint8Array(L.length * 8);
    bytes.set(new Uint8Array(L.buffer), 0);
    bytes.set(new Uint8Array(R.buffer), L.length * 4);
    const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const scenarioHash = hex(await crypto.subtle.digest('SHA-256', bytes));
    let peak = 0;
    for (const x of L) peak = Math.max(peak, Math.abs(x));
    for (const x of R) peak = Math.max(peak, Math.abs(x));
    return { probes, scenarioHash, scenarioPeak: peak };
  }, { surfaces: derivedOccluders, profiles });
  await ctx.close();
  if (errors.length) problems.push(`렌더 페이지 오류: ${errors.join(' | ')}`);
  const h = createHash('sha256');
  for (const k of Object.keys(out.probes).sort()) h.update(Buffer.from(new Float32Array(out.probes[k]).buffer));
  out.probeHash = h.digest('hex');
  return out;
}

let run1, run2;
try {
  run1 = await renderSet();
  run2 = await renderSet();
} finally {
  await browser.close();
  await server.close();
}

/* ---------------------------------------------------------------- [2] 4축 측정 · 쌍 판정 */
const ref = Float32Array.from(run1.probes.__ref);
const measured = {};
for (const s of derivedOccluders) {
  const m = measureProfile(ref, Float32Array.from(run1.probes[s]), TARGET_RATE);
  measured[s] = {
    cutoffHz: +m.cutoffHz.toFixed(0), attenuationDb: +m.attenuationDb.toFixed(2),
    couplingRatio: +m.couplingRatio.toFixed(4), delayMs: +m.delayMs.toFixed(3),
  };
}
report.axes = AXES;
report.criteria = DISTINCT;
report.measured = measured;
report.audibleAxes = AUDIBLE_AXES;
const pen = (s) => SURFACES[s].penClass;
const KEY_PAIR = new Set(['EARTH_WALL|ROOF_SOIL', 'ROOF_SOIL|EARTH_WALL']);
const pairs = [];
for (let i = 0; i < derivedOccluders.length; i++) {
  for (let j = i + 1; j < derivedOccluders.length; j++) {
    const a = derivedOccluders[i], b = derivedOccluders[j];
    const ax = distinctAxes(measured[a], measured[b]);
    const gated = pen(a) !== pen(b) || KEY_PAIR.has(`${a}|${b}`);
    const ok = !gated || ax.length >= DISTINCT.minAxes;
    pairs.push({ a, b, penClass: [pen(a), pen(b)], gated, axes: ax, n: ax.length, ok });
    if (!ok) problems.push(`[2] ${a}(${pen(a)}) vs ${b}(${pen(b)}): 들리는 축 ${ax.length}개 [${ax}]`);
  }
}
report.pairCount = pairs.length;
report.gatedPairCount = pairs.filter((p) => p.gated).length;
report.samePenReportOnly = pairs.filter((p) => !p.gated).map((p) => `${p.a}/${p.b}: [${p.axes}]`);
report.pairs = pairs;
{
  const ax = distinctAxes(measured.ROOF_SOIL, measured.EARTH_WALL);
  report.roofSoilVsEarthWall = { axes: ax, ROOF_SOIL: measured.ROOF_SOIL, EARTH_WALL: measured.EARTH_WALL, ok: ax.length >= DISTINCT.minAxes };
  if (!report.roofSoilVsEarthWall.ok) problems.push(`[2] ROOF_SOIL vs EARTH_WALL 구별 실패 (PATCH-003-B 3항) — [${ax}]`);
}

/* ---------------------------------------------------------------- [3] BRONZE 공명 */
{
  const t60 = measureT60(impactBuffer('bronze_resonate', TARGET_RATE), TARGET_RATE);
  report.bronzeT60s = +t60.toFixed(2);
  if (!(t60 >= 3)) problems.push(`[3] bronze_resonate T60 ${t60.toFixed(2)} s < 3 s (§2-3)`);
}

/* ---------------------------------------------------------------- [4] 공간 잔향 */
{
  const raycast = (o, d, maxDist) => {
    const ch = collectRayChain(physics.static, o[0], o[1], o[2], d[0], d[1], d[2], maxDist, MASK.BULLET);
    const L = ch.layers.find((l) => SURFACES[l.surface].penClass !== PenClass.DECAL);
    return L ? { dist: L.entryT, surface: L.surface, normal: L.normal } : null;
  };
  // 위치: level.js 앵커 — 동헌(0,-24) 마루 상면 1.0, 내아(-27,-10) 마루 1.0, 회랑 x=38..40.2 마루 0.55, 남측 마당
  const SPACES = {
    마당: [0, 1.6, 8],
    대청: [0, 2.6, -24],
    방: [-27, 2.6, -10],
    회랑: [39.1, 2.15, -6],
  };
  const spaces = {};
  for (const [name, p] of Object.entries(SPACES)) {
    const s = probeSpace(p, raycast);
    spaces[name] = {
      pos: p, volumeM3: +s.volume.toFixed(0), areaM2: +s.area.toFixed(0), open: +s.openFraction.toFixed(2),
      rt60: s.rt60.map((x) => +x.toFixed(2)), wetRatio: +s.wetRatio.toFixed(3), predelayMs: +(s.predelayS * 1000).toFixed(1),
    };
  }
  report.spaces = spaces;
  const names = Object.keys(spaces);
  const rel = (x, y) => Math.abs(x - y) / Math.max(x, y);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const A = spaces[names[i]], B = spaces[names[j]];
    if (!(rel(A.rt60[1], B.rt60[1]) > 0.15 || rel(A.wetRatio, B.wetRatio) > 0.15)) {
      problems.push(`[4] 공간 잔향 구별 실패: ${names[i]} vs ${names[j]}`);
    }
  }
}

/* ---------------------------------------------------------------- [5] 결정성 */
report.hash = {
  scenario: [run1.scenarioHash, run2.scenarioHash],
  probes: [run1.probeHash, run2.probeHash],
  identical: run1.scenarioHash === run2.scenarioHash && run1.probeHash === run2.probeHash,
  scenarioPeak: +run1.scenarioPeak.toFixed(4),
};
if (!report.hash.identical) problems.push('[5] 오디오 해시 2회 불일치 (§2-6)');
if (!(run1.scenarioPeak > 1e-4)) problems.push('[5] 시나리오 렌더가 무음 — 해시가 아무것도 증명하지 않는다');

report.ok = problems.length === 0;
report.problems = problems;
const json = JSON.stringify(report, null, 2);
console.log(json);
if (typeof args.out === 'string') writeFileSync(args.out, json);
process.exit(report.ok ? 0 : 1);
