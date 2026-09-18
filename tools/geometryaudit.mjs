#!/usr/bin/env node
/**
 * tools/geometryaudit.mjs — 구조 불변식 정적 감사 (CONTRACT-PATCH-005-C).
 *
 * 왜: 팔작지붕 프로파일 반전(처마 8.2 m > 용마루 5.9 m)이 P1.5 종료 게이트·C3·픽셀 게이트를 전부 통과했다.
 * 픽셀 확인으로는 잡히지 않는 구조 불변식을 씬그래프에서 **정적으로** 검사한다 (브라우저·렌더 없음 — chainaudit과 같이
 * node에서 buildWorld로 조립). 픽셀 게이트가 아니므로 해상도·GPU와 무관하다.
 *
 * 불변식 (패치 최소 항목):
 *  1. 모든 지붕: 용마루(중심선) 높이 > 처마(외곽) 높이 — 덮개 정점의 내측 띠 평균 y > 외측 띠 평균 y, 덮개 최고점 ≤ 용마루 갓
 *  2. 모든 지붕: 외부에서 보이는 면(외피)의 법선이 위·바깥을 향함 — 외피 삼각형 면적 가중 법선의 y>0, 수평 성분이 용마루선에서 멀어지는 방향
 *  3. 기단 상면 > 마당 지면
 *  4. 레이어 순서: 기와 상면 > ROOF_SOIL 상면 > 서까래 상면 (처마 외곽 기준)
 *  5. 담장 하부(GRANITE) 높이 < 담장 상부(ROOF_TILE 갓) 높이
 *  6. 모든 건물의 바운딩박스가 담장(±44) 내부 (담장·남문루·지면 제외)
 *
 * 음성 훅 (harnesstest 케이스 19): --inject-flip-roof — 팔작 셸 정점 y를 평균 기준으로 뒤집은 입력 → 반드시 exit 1 + testOverride.
 * 출력: JSON { ok, checks[], testOverride? }, exit 0/1.
 *
 * 전제(기록): 셸 지오메트리(kit.shellGeometry)는 정점 배열 앞 절반이 외피, 뒤 절반이 내피다. 지붕은 `${prefix}_ridge` 상자로 식별하고
 * 덮개는 `${prefix}_hip_main_*`·`${prefix}_hip_side_*`(팔작 셸)·`${prefix}_roof_*`(맞배 슬래브)다. 담장 반폭 44는 level.js P0 앵커.
 */
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/index.js';
import { buildWorld } from '../src/world/level.js';
import { T } from '../src/world/kit.js';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const INJECT_FLIP = args['inject-flip-roof'] === true;
const WALL = 44;

const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);
scene.updateMatrixWorld(true);

const meshes = [];
scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
const byName = new Map(meshes.map((m) => [m.name, m]));

/** 월드 정점 배열 (Vector3[]) — InstancedMesh는 인스턴스 원점만 */
const _v = new THREE.Vector3();
function worldVerts(m, half = 'all') {
  const pos = m.geometry.attributes.position;
  const n = pos.count;
  const [a, b] = half === 'top' ? [0, n / 2] : half === 'bottom' ? [n / 2, n] : [0, n];
  const out = [];
  for (let i = a; i < b; i++) out.push(_v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
  return out;
}
function worldBox(m) { return new THREE.Box3().setFromObject(m); }

// ---- 음성 훅: 팔작 셸 정점 y 반전 (평균 기준) — 지오메트리 복제 후 교체
if (INJECT_FLIP) {
  for (const m of meshes) {
    if (!/_hip_(main|side)_/.test(m.name)) continue;
    const g = m.geometry.clone(); const pos = g.attributes.position; let sum = 0;
    for (let i = 0; i < pos.count; i++) sum += pos.getY(i);
    const mean = sum / pos.count;
    for (let i = 0; i < pos.count; i++) pos.setY(i, 2 * mean - pos.getY(i));
    pos.needsUpdate = true; g.computeVertexNormals(); m.geometry = g;
  }
}

const checks = [];
const push = (name, ok, got) => checks.push({ name, ok: !!ok, got });

/* ---------------------------------------------------------- 지붕 그룹 */
const ridges = meshes.filter((m) => /_ridge$/.test(m.name) && !m.name.startsWith('wall_'));
const roofs = [];
for (const r of ridges) {
  const prefix = r.name.slice(0, -'_ridge'.length);
  const box = worldBox(r); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  const axis = size.x >= size.z ? 'x' : 'z';
  const halfLen = (axis === 'x' ? size.x : size.z) / 2;
  const covers = meshes.filter((m) => m.name.startsWith(`${prefix}_hip_main_`) || m.name.startsWith(`${prefix}_hip_side_`) || m.name.startsWith(`${prefix}_roof_`));
  if (!covers.length) continue;
  roofs.push({ prefix, ridge: r, axis, center: c, halfLen, ridgeTop: box.max.y, covers });
}
push('지붕 그룹 식별 (용마루 상자 + 덮개)', roofs.length >= 3, roofs.map((r) => `${r.prefix}:${r.covers.length}`));

/** 용마루 선분까지의 수평 거리와 바깥 방향 */
function ridgeDist(roof, p) {
  const { axis, center, halfLen } = roof;
  const along = axis === 'x' ? p.x - center.x : p.z - center.z;
  const across = axis === 'x' ? p.z - center.z : p.x - center.x;
  const beyond = Math.max(0, Math.abs(along) - halfLen);
  const d = Math.hypot(across, beyond);
  const dir = new THREE.Vector2(axis === 'x' ? Math.sign(along) * beyond : across, axis === 'x' ? across : Math.sign(along) * beyond); // (x,z)
  if (dir.lengthSq() > 1e-9) dir.normalize();
  return { d, dir };
}
function isShell(m) { return /_hip_(main|side)_/.test(m.name); }

for (const roof of roofs) {
  const surfOf = (m) => m.userData.surface;
  const topVerts = [];
  for (const m of roof.covers) for (const v of worldVerts(m, isShell(m) ? 'top' : 'all')) topVerts.push({ v, surf: surfOf(m) });
  const ds = topVerts.map((t) => ridgeDist(roof, t.v).d).sort((a, b) => a - b);
  const q25 = ds[Math.floor(ds.length * 0.25)], q75 = ds[Math.floor(ds.length * 0.75)];
  const inner = topVerts.filter((t) => ridgeDist(roof, t.v).d <= q25), outer = topVerts.filter((t) => ridgeDist(roof, t.v).d >= q75);
  const mean = (arr) => arr.reduce((s, t) => s + t.v.y, 0) / Math.max(1, arr.length);
  const innerY = mean(inner), outerY = mean(outer), maxY = Math.max(...topVerts.map((t) => t.v.y));
  // 1. 용마루 > 처마
  push(`[1] ${roof.prefix}: 중심선 띠 평균 y > 외곽 띠 평균 y (+0.3) 및 덮개 최고점 ≤ 용마루 갓`,
    innerY > outerY + 0.3 && maxY <= roof.ridgeTop + 0.05,
    { innerY: +innerY.toFixed(2), outerY: +outerY.toFixed(2), coverMaxY: +maxY.toFixed(2), ridgeTop: +roof.ridgeTop.toFixed(2) });
  // 2. 외피 법선: 위 + 바깥 (셸은 외피 삼각형 면적 가중, 슬래브는 로컬 +y)
  const normalChecks = [];
  for (const m of roof.covers) {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, wsum = 0;
    if (isShell(m)) {
      const pos = m.geometry.attributes.position, idx = m.geometry.index.array, half = pos.count / 2;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < idx.length; i += 3) {
        if (idx[i] >= half || idx[i + 1] >= half || idx[i + 2] >= half) continue; // 외피 삼각형만
        a.fromBufferAttribute(pos, idx[i]).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, idx[i + 1]).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, idx[i + 2]).applyMatrix4(m.matrixWorld);
        n.copy(b).sub(a).cross(c.clone().sub(a)); const w = n.length(); if (w < 1e-9) continue;
        nx += n.x; ny += n.y; nz += n.z; cx += (a.x + b.x + c.x) / 3 * w; cy += (a.y + b.y + c.y) / 3 * w; cz += (a.z + b.z + c.z) / 3 * w; wsum += w;
      }
    } else {
      const n = new THREE.Vector3(0, 1, 0).transformDirection(m.matrixWorld); const bc = worldBox(m).getCenter(new THREE.Vector3());
      nx = n.x; ny = n.y; nz = n.z; cx = bc.x; cy = bc.y; cz = bc.z; wsum = 1;
    }
    const n = new THREE.Vector3(nx, ny, nz).normalize(); const centroid = new THREE.Vector3(cx / wsum, cy / wsum, cz / wsum);
    const { dir } = ridgeDist(roof, centroid);
    const outward = dir.lengthSq() > 0 ? n.x * dir.x + n.z * dir.y : 1; // 용마루선 위(dir=0)면 수평 조건 면제
    normalChecks.push({ mesh: m.name, ny: +n.y.toFixed(3), outward: +outward.toFixed(3), ok: n.y > 0.2 && outward >= -0.02 });
  }
  push(`[2] ${roof.prefix}: 외피 법선 위·바깥 (${normalChecks.length}면)`, normalChecks.every((c) => c.ok), normalChecks.filter((c) => !c.ok).map((c) => `${c.mesh} ny=${c.ny} out=${c.outward}`));
  // 4. 레이어 순서: 처마 외곽 띠에서 기와 상면 > ROOF_SOIL 상면; 서까래는 각 서까래 중심에서 **위로 레이캐스트**해 그 자리의 덮개 하면
  //    (최하층 ROOF_SOIL/THATCH 내피, 앞면=아래 법선)보다 서까래 상단이 낮아야 한다 — 서까래는 경사를 따라 기울어 있어 바운딩 비교는 오탐
  const tile = outer.filter((t) => t.surf === 'ROOF_TILE'), soil = outer.filter((t) => t.surf === 'ROOF_SOIL'), thatch = outer.filter((t) => t.surf === 'THATCH');
  const lowerCovers = roof.covers.filter((m) => m.userData.surface === (thatch.length ? 'THATCH' : 'ROOF_SOIL'));
  const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
  const rafterStats = { n: 0, outside: 0, worstAbove: -Infinity, worstName: '' };
  for (const im of meshes) {
    if (!im.isInstancedMesh || !im.name.startsWith('inst_rafter')) continue;
    const mat = new THREE.Matrix4(); const p = new THREE.Vector3(); im.geometry.computeBoundingBox();
    const bb = im.geometry.boundingBox; const halfH = Math.min(bb.max.y - bb.min.y, bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2; // 단면 반두께
    const rb = new THREE.Box3(); for (const m of roof.covers) rb.union(worldBox(m)); rb.expandByScalar(0.3);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mat); p.setFromMatrixPosition(mat).applyMatrix4(im.matrixWorld);
      if (!rb.containsPoint(p)) continue;
      rafterStats.n++;
      ray.set(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, 1, 0)); ray.far = 20;
      const hits = ray.intersectObjects(lowerCovers, false);
      if (!hits.length) { rafterStats.outside++; continue; }
      const underside = hits[0].point.y; const above = (p.y + halfH) - underside;
      if (above > rafterStats.worstAbove) { rafterStats.worstAbove = above; rafterStats.worstName = `${im.name}#${i}`; }
    }
  }
  const orderOk = thatch.length ? true : (tile.length && soil.length && mean(tile) > mean(soil) + T.BOTO_T * 0.5);
  const rafterOk = rafterStats.n === 0 || (rafterStats.worstAbove <= 0.02);
  push(`[4] ${roof.prefix}: 처마 외곽 기와 상면 > ROOF_SOIL 상면, 서까래 상단 ≤ 덮개 하면 (레이캐스트)`, orderOk && rafterOk,
    { tileTop: tile.length ? +mean(tile).toFixed(2) : null, soilTop: soil.length ? +mean(soil).toFixed(2) : null, thatchTop: thatch.length ? +mean(thatch).toFixed(2) : null,
      rafters: rafterStats.n, rafterOutsideRoof: rafterStats.outside, rafterAboveUndersideMax: rafterStats.n ? +rafterStats.worstAbove.toFixed(3) : null, worst: rafterStats.worstName });
}

/* ---------------------------------------------------------- 3. 기단 > 지면 */
const ground = byName.get('ground');
const groundTop = ground ? worldBox(ground).max.y : 0;
for (const m of meshes.filter((m) => /_kidan$/.test(m.name))) {
  const top = worldBox(m).max.y;
  push(`[3] ${m.name}: 기단 상면 > 지면`, top > groundTop + 0.1, { kidanTop: +top.toFixed(2), groundTop: +groundTop.toFixed(2) });
}

/* ---------------------------------------------------------- 5. 담장 하부 < 상부 */
for (const g of meshes.filter((m) => /^wall_g_\d+$/.test(m.name))) {
  const i = g.name.split('_')[2];
  const caps = meshes.filter((m) => m.name.startsWith(`wall_cap_${i}_`));
  const gTop = worldBox(g).max.y; const capTop = Math.max(...caps.map((c) => worldBox(c).max.y));
  push(`[5] 담장 ${i}: GRANITE 상단 < ROOF_TILE 갓 상단`, caps.length > 0 && gTop < capTop, { graniteTop: +gTop.toFixed(2), capTop: +capTop.toFixed(2) });
}

/* ---------------------------------------------------------- 6. 담장 내부 */
{
  let worst = 0, worstName = ''; const p = new THREE.Vector3(); const mat = new THREE.Matrix4();
  for (const m of meshes) {
    if (m.name === 'ground' || m.name.startsWith('wall_') || m.name.startsWith('gate_')) continue;
    if (m.isInstancedMesh) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat); p.setFromMatrixPosition(mat).applyMatrix4(m.matrixWorld);
        if (p.z > WALL - 2 && Math.abs(p.x) < 6.5) continue; // 남문루 지붕 인스턴스(기와·서까래)는 담장선에 걸친다
        const e = Math.max(Math.abs(p.x), Math.abs(p.z)); if (e > worst) { worst = e; worstName = `${m.name}#${i}`; }
      }
      continue;
    }
    const b = worldBox(m); const e = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    if (e > worst) { worst = e; worstName = m.name; }
  }
  // 남문루 지붕 인스턴스(기와·서까래)는 담장선(z=44)에 걸치므로 +2 m 허용
  push('[6] 건물 바운딩박스가 담장(±44) 내부 (담장·남문루·지면 제외)', worst <= WALL - 0.3, { maxExtent: +worst.toFixed(2), at: worstName });
}

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({
  ok,
  ...(INJECT_FLIP ? { testOverride: 'inject-flip-roof — harnesstest 전용, 계약 판정 무효' } : {}),
  roofs: roofs.map((r) => ({ prefix: r.prefix, axis: r.axis, ridgeTop: +r.ridgeTop.toFixed(2), covers: r.covers.length })),
  failed: checks.filter((c) => !c.ok).length,
  checks,
}, null, 2));
process.exit(ok ? 0 : 1);
