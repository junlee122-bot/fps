#!/usr/bin/env node
/**
 * tools/shotaudit.mjs — 샷 감시 대상 관측 검사 (CONTRACT-PATCH-009-B, P4 편입 · R4 캡처 전 12샷 1회 실행).
 *
 * 배경: HARNESS.md §3 이 샷마다 감시 대상을 선언하지만, 대상이 실제로 프레임에 관측되는지는 아무도 검사하지 않았다 —
 * 팔작 반전(기와 상면이 어떤 샷에도 없음)·샷 3(광원 모델 + 더미가 카메라 축 중앙 기둥 뒤) 등 12샷 중 2샷이 선언 대상을 관측하지
 * 못하고 있었다(PATCH-004-D 패턴 5번째 사례). 이 도구는 그 선언을 **기계 검사**한다.
 *
 * 노드 헤드리스(buildWorld + three Raycaster) — 렌더·브라우저·GPU 무관, 결정적. 샷마다 `tools/shots.js` 의 `audit` 등록
 * (그룹 1개 또는 배열 — 그룹마다 독립 판정, 샷 = 전 그룹 통과):
 *   audit: { targets: [ {name:'mesh'} | {match:'regex'} | {surface:'ROOF_TILE'} ], minAreaPct: N, note?: '…' } | [ …그룹… ]
 * 검사 3종 (하나라도 실패 → 샷 실패 → exit 1, 사유·차폐 오브젝트 이름 출력):
 *   [1] 절두체 — 대상 오브젝트(들)의 월드 AABB 가 카메라 절두체와 교차
 *   [2] 가시성 — 대상 AABB 의 화면 투영 사각형 안 격자 레이 중 하나라도 첫 히트(반투과 비대상은 통과)가 대상이면 통과. 전부 불투명체에 막히면
 *       실패("완전히 가려짐")이고 그 사각형 안 최다 차폐 오브젝트 이름을 기록. AABB 중심 레이는 정보로만 실음(창살 뒤 창호지·거대한 지면처럼 중심
 *       한 점이 대표하지 못하는 대상이 있다 — 첫 실행 실측)
 *   [3] 최소 면적 — 절두체를 덮는 격자 레이(GRID) 중 첫 불투명 히트(반투과는 대상이 아니면 통과시켜 다음 히트)가 대상인 비율 ≥ minAreaPct
 * 한계(표에 명시): 카메라 부착 대상(뷰모델·총구화염)과 런타임 스폰(낙하 기와 파편)은 헤드리스 씬에 없다 — 그 샷은 배경 대상(실내 벽·바닥·타격 지붕면)을
 * 등록한다. `audit` 미등록 샷은 **실패**(등록 강제).
 *
 * 음성 훅 (HARNESS.md §0): --inject-occluder — 첫 등록 샷의 카메라와 대상 사이에 불투명 상자를 세운 입력 → 반드시 exit 1 + testOverride (harnesstest 케이스 23).
 * --report — 샷별 격자 레이 상위 커버리지 오브젝트 목록 출력(대상 등록용), 판정 없이 exit 0.
 * --root <dir> — 다른 트리의 src/world/level.js·tools/shots.js 로 검사 (구 샷 정의 대조용). --audit-from <shots.js> — 등록(audit)만 다른 파일에서.
 *
 *   node tools/shotaudit.mjs [--report] [--inject-occluder] [--root DIR] [--audit-from FILE] [--grid 64x42] [--shots a,b]
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const ROOT = resolve(args.root ?? resolve(import.meta.dirname, '..'));
const REPORT = args.report === true;
const INJECT = args['inject-occluder'] === true;
const [GW, GH] = String(args.grid ?? '64x42').split('x').map(Number);
const { PhysicsWorld } = await import(pathToFileURL(resolve(ROOT, 'src/physics/index.js')).href);
const { buildWorld } = await import(pathToFileURL(resolve(ROOT, 'src/world/level.js')).href);
const { SHOTS: SHOTS_RAW, VIEW } = await import(pathToFileURL(resolve(ROOT, 'tools/shots.js')).href);
let SHOTS = SHOTS_RAW;
if (args['audit-from']) {
  const { SHOTS: REG } = await import(pathToFileURL(resolve(String(args['audit-from']))).href);
  SHOTS = SHOTS_RAW.map((s) => ({ ...s, audit: REG.find((r) => r.name === s.name)?.audit ?? s.audit }));
}
const groupsOf = (shot) => (shot.audit ? (Array.isArray(shot.audit) ? shot.audit : [shot.audit]) : null);
const { SURFACES } = await import(pathToFileURL(resolve(ROOT, 'src/core/surfaces.js')).href);
const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : SHOTS.map((s) => s.name);

const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);
scene.updateMatrixWorld(true);

const meshes = [];
scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible && !o.userData.auditOnly && o.geometry?.attributes?.position) meshes.push(o); });
for (const m of meshes) m.geometry.computeBoundingBox();
const isTranslucent = (o) => !!SURFACES[o.userData.surface]?.translucent || !!o.material?.transparent;

/** 오브젝트(인스턴스 포함) 월드 AABB */
const _bb = new THREE.Box3(); const _m = new THREE.Matrix4();
function worldBoxes(o) {
  if (o.isInstancedMesh) { const out = []; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); out.push(new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(_m)); } return out; }
  return [new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)];
}

/** 대상 매처 → 매치 오브젝트 집합 */
function matchTargets(targets) {
  const set = new Set();
  for (const t of targets) {
    for (const o of meshes) {
      if (t.name && o.name === t.name) set.add(o);
      else if (t.match && new RegExp(t.match).test(o.name)) set.add(o);
      else if (t.surface && o.userData.surface === t.surface) set.add(o);
    }
  }
  return set;
}

/** 레이 첫 유효 히트: 반투과(대상 아님)는 통과 → { object, instanceId, distance } | null */
const ray = new THREE.Raycaster(); ray.far = 200;
function firstHit(origin, dir, candidates, targetSet) {
  ray.set(origin, dir);
  const hits = ray.intersectObjects(candidates, false);
  for (const h of hits) {
    if (targetSet.has(h.object)) return { object: h.object, instanceId: h.instanceId, distance: h.distance, target: true };
    if (isTranslucent(h.object)) continue;
    return { object: h.object, instanceId: h.instanceId, distance: h.distance, target: false };
  }
  return null;
}

function auditShot(shot) {
  const cam = new THREE.PerspectiveCamera(shot.cam.fov, VIEW.width / VIEW.height, 0.05, 300);
  cam.position.set(...shot.cam.pos); cam.lookAt(...shot.cam.target); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  // 절두체 안 후보만 레이캐스트 대상 (비용 절감)
  const candidates = meshes.filter((o) => worldBoxes(o).some((b) => frustum.intersectsBox(b)));
  const groups = groupsOf(shot);
  const gridRays = []; { const dir = new THREE.Vector3(); const ndc = new THREE.Vector3(); for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const nx = ((i + 0.5) / GW) * 2 - 1, ny = 1 - ((j + 0.5) / GH) * 2; ndc.set(nx, ny, 0.5).unproject(cam); gridRays.push({ nx, ny, dir: dir.copy(ndc).sub(cam.position).normalize().clone() }); } }
  const total = gridRays.length;
  /** 격자 커버리지 — targetSet 기준 (반투과 비대상은 통과). rect(NDC) 안 레이의 대상/차폐 집계 포함 */
  const coverage = (targetSet, rect = null) => {
    const cover = new Map(); const inRect = new Map(); let targetRays = 0, rectTarget = 0, rectTotal = 0;
    for (const r of gridRays) {
      const h = firstHit(cam.position, r.dir, candidates, targetSet);
      const within = rect && r.nx >= rect[0] && r.nx <= rect[2] && r.ny >= rect[1] && r.ny <= rect[3];
      if (within) rectTotal++;
      if (!h) continue;
      const key = h.object.name || h.object.type; cover.set(key, (cover.get(key) ?? 0) + 1);
      if (h.target) { targetRays++; if (within) rectTarget++; } else if (within) inRect.set(key, (inRect.get(key) ?? 0) + 1);
    }
    return { cover, areaPct: +((100 * targetRays) / total).toFixed(2), rectTarget, rectTotal, rectOccluder: [...inRect.entries()].sort((a, b) => b[1] - a[1])[0] ?? null };
  };
  /** 대상 집합의 화면 투영 사각형 (NDC, 절두체 안 AABB 8모서리) */
  const screenRect = (objs) => { let r = [Infinity, Infinity, -Infinity, -Infinity]; const v = new THREE.Vector3(); const v4 = new THREE.Vector4(); for (const o of objs) for (const b of worldBoxes(o)) { if (!frustum.intersectsBox(b)) continue; for (let k = 0; k < 8; k++) { v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z); v4.set(v.x, v.y, v.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); if (v4.w <= 0) return [-1, -1, 1, 1]; /* 카메라 뒤 모서리(지면 같은 거대 AABB) → 전 화면 */ const nx = v4.x / v4.w, ny = v4.y / v4.w; r = [Math.min(r[0], nx), Math.min(r[1], ny), Math.max(r[2], nx), Math.max(r[3], ny)]; } } return r[0] === Infinity ? null : [Math.max(-1, r[0]), Math.max(-1, r[1]), Math.min(1, r[2]), Math.min(1, r[3])]; };
  const topOf = (cover, n = 15) => [...cover.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, k]) => ({ name, pct: +((100 * k) / total).toFixed(2) }));
  if (REPORT || !groups) { const { cover } = coverage(new Set()); return { shot: shot.name, watch: shot.watch, registered: !!groups, ok: false, top: topOf(cover), ...(groups ? {} : { reason: 'audit 미등록 — shots.js 에 targets·minAreaPct 를 등록하라' }) }; }
  const groupResults = groups.map((reg, gi) => {
    const targetSet = matchTargets(reg.targets ?? []);
    const checks = []; const matched = [...targetSet];
    checks.push({ name: '[0] 대상 존재', ok: matched.length > 0, got: matched.length ? `${matched.length}개` : '매치 0 — 등록 이름/표면 확인' });
    const inFrustum = matched.filter((o) => worldBoxes(o).some((b) => frustum.intersectsBox(b)));
    checks.push({ name: '[1] 절두체 포함', ok: inFrustum.length > 0, got: `${inFrustum.length}/${matched.length} 절두체 교차` });
    const rect = screenRect(inFrustum);
    const { cover, areaPct, rectTarget, rectTotal, rectOccluder } = coverage(targetSet, rect);
    // 정보: 첫 절두체 안 AABB 중심 레이
    let centerInfo = 'n/a';
    for (const o of inFrustum) { const b = worldBoxes(o).find((bb) => frustum.intersectsBox(bb)); if (!b) continue; const c = b.getCenter(new THREE.Vector3()); const d = c.clone().sub(cam.position); const dist = d.length(); d.normalize(); const h = firstHit(cam.position, d, candidates, targetSet); centerInfo = !h ? '히트 없음' : h.target ? `대상 ${h.object.name}` : `${h.object.name}${h.instanceId != null ? `#${h.instanceId}` : ''} (${h.distance.toFixed(2)} m, 대상 ${dist.toFixed(2)} m)`; break; }
    // 가시성 = 격자 레이 중 대상 도달 ≥ 1 (도달 레이가 있으면 그 자리가 곧 대상의 화면 영역). 0 이면 대상 투영 사각형 안 최다 차폐물 보고
    const reached = Math.round((areaPct / 100) * total);
    checks.push({ name: '[2] 가시성 (격자 레이 중 대상 도달 ≥ 1, 반투과 통과)', ok: reached > 0, got: reached > 0 ? `도달 ${reached}/${total} (중심 레이: ${centerInfo})` : `완전히 가려짐 — 최다 차폐: ${rectOccluder ? `${rectOccluder[0]} (${rectOccluder[1]}/${rectTotal})` : '히트 없음'} (중심 레이: ${centerInfo})` });
    const minArea = reg.minAreaPct ?? 1;
    checks.push({ name: `[3] 최소 면적 ≥ ${minArea}%`, ok: areaPct >= minArea, got: `${areaPct}% (격자 ${GW}×${GH})${areaPct < minArea && rectOccluder ? ` — 대상 영역 최다 차폐: ${rectOccluder[0]} (${rectOccluder[1]}/${rectTotal})` : ''}` });
    const ok = checks.every((c) => c.ok);
    return { group: gi, targets: reg.targets, note: reg.note, minAreaPct: minArea, areaPct, ok, checks, ...(ok ? {} : { failed: checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.got}`) }), top: topOf(cover, 6) };
  });
  const ok = groupResults.every((g) => g.ok);
  return { shot: shot.name, watch: shot.watch, registered: true, ok, groups: groupResults, ...(ok ? {} : { failed: groupResults.flatMap((g) => (g.failed ?? []).map((f) => `g${g.group}: ${f}`)) }) };
}

// 음성 훅: 첫 등록 샷의 카메라→대상 사이에 불투명 상자 — 반드시 [2]·[3] 실패
let testOverride = null;
if (INJECT) {
  const shot = SHOTS.find((s) => wanted.includes(s.name) && s.audit);
  if (shot) {
    const cam = new THREE.Vector3(...shot.cam.pos); const set = matchTargets(groupsOf(shot)[0].targets);
    const bb = new THREE.Box3(); for (const o of set) for (const b of worldBoxes(o)) bb.union(b);
    const c = bb.getCenter(new THREE.Vector3()); const p = cam.clone().lerp(c, 0.5); const size = Math.max(4, cam.distanceTo(c) * 0.8);
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.2), new THREE.MeshBasicMaterial()); box.name = 'harnesstest_occluder';
    box.position.copy(p); box.lookAt(cam); box.updateMatrixWorld(true); box.userData.surface = 'GRANITE';
    scene.add(box); meshes.push(box); box.geometry.computeBoundingBox();
    testOverride = `inject-occluder(${shot.name} 대상 앞 불투명 상자) — harnesstest 전용, 계약 판정 무효`;
  }
}

const results = SHOTS.filter((s) => wanted.includes(s.name)).map(auditShot);
const ok = !REPORT && results.every((r) => r.ok);
const out = { ok, root: ROOT, mode: REPORT ? 'report' : 'audit', grid: `${GW}x${GH}`, ...(testOverride ? { testOverride } : {}), shots: results };
console.log(JSON.stringify(out, null, 2));
process.exit(REPORT ? 0 : ok ? 0 : 1);
