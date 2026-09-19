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
 *  8. [PATCH-014 후속, 톱니 모드] 실외에 면한 창호 판의 창살은 판의 **실외 쪽**에 있을 것 — 전통 한옥은 창호지를 창살 안쪽(실내)에 붙인다.
 *     양쪽이 다 실내인 칸막이 판은 제외한다. 실외/실내 판별은 **건물 수직 벽 메시(HANJI·WOOD_PLANK·EARTH_WALL, 높이 ≥0.8 m · 바닥에서 올라온 것만 — 마루와 박공벽은 벽선보다 내밀어 제외) 외피 바운딩박스**로 한다 —
 *     판이 그 경계면(±0.2 m)에 있으면 실외 접면이고, 바깥 방향은 박스 중심의 반대쪽이다. 지붕은 처마가 벽보다 내밀어 기준이 될 수 없다.
 *     **지금은 보고 전용(톱니)**: 알려진 위반 4 건(대청 전면 `dh_bay` ×4, 창살이 실내 쪽)을 기록하고 **4 건을 넘으면 exit 1**.
 *     P1 회귀 패스가 방향+패턴을 고치면 상한을 0 으로 내리고 정식 게이트로 전환한다(허용 목록이 아니라 위반 수 상한 — PATCH-004-B 와 충돌 없음).
 *
 * 음성 훅 (harnesstest 케이스 24): --inject-lattice-flip — 정상 판 하나의 창살을 판 평면 기준으로 반사(위반 5 건) → 반드시 exit 1 + testOverride.
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
const INJECT_LAT = args['inject-lattice-flip'] === true;
const LATTICE_VIOLATION_CAP = 4; // 톱니: 알려진 위반(대청 전면 4베이). P1 수정 후 0 으로 내린다
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
let latticeRows = [];
const push = (name, ok, got, advisory = false) => checks.push({ name, ok: !!ok, got, ...(advisory ? { advisory: true } : {}) });

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

/* ---------------------------------------------------------- 7. 파생 배치 전수 (PATCH-006-C) */
// 셸 매개변수에서 파생된 배치가 바로잡힌 셸 기준으로 옳은지 레이캐스트로 확인한다.
//  (a) 기와 인스턴스: 중심에서 아래로 쏘아 첫 히트가 ROOF_TILE 셸 외피이고 간격이 [0, 0.12] m (기와가 셸 위에 얹힘)
//  (b) 추녀마루·내림마루 상자: 중심에서 아래로 쏘아 셸 외피 히트가 상자 하단 − 0.05 이하 (마루가 셸 이음매 위에 얹힘)
//  (c) 추녀·사래·공포 상단: 위로 쏘아 첫 히트(덮개 하면)가 부재 상단보다 위 (부재가 셸을 뚫지 않음)
//  (d) 합각 판벽: 상단 ≤ 용마루 갓, 하단 = 합각하부면 안쪽 가장자리 높이 ±0.05
{
  const ray = new THREE.Raycaster(); const mat = new THREE.Matrix4(); const p = new THREE.Vector3();
  for (const roof of roofs) {
    const isHip = roof.covers.some((m) => /_hip_main_/.test(m.name));
    if (!isHip) continue;
    const tileShells = roof.covers.filter((m) => m.userData.surface === 'ROOF_TILE' && isShell(m));
    const lowShells = roof.covers.filter((m) => m.userData.surface === 'ROOF_SOIL' && isShell(m));
    const rb = new THREE.Box3(); for (const m of roof.covers) rb.union(worldBox(m)); rb.expandByScalar(0.3);
    // (a) 기와
    let tiles = 0, tileBad = 0, tileMiss = 0, gapMax = -1, gapMin = 9;
    for (const im of meshes) {
      if (!im.isInstancedMesh || !im.name.startsWith('inst_tile')) continue;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mat); p.setFromMatrixPosition(mat).applyMatrix4(im.matrixWorld);
        if (!rb.containsPoint(p)) continue;
        tiles++;
        ray.set(new THREE.Vector3(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, -1, 0)); ray.far = 5;
        const h = ray.intersectObjects(tileShells, false)[0];
        if (!h) { tileMiss++; continue; }
        const gap = p.y - h.point.y; gapMax = Math.max(gapMax, gap); gapMin = Math.min(gapMin, gap);
        if (gap < -0.02 || gap > 0.12) tileBad++; // −2 cm: 곡면 보간 수치 오차 허용
      }
    }
    push(`[7a] ${roof.prefix}: 기와 인스턴스가 기와 셸 외피 위 [−0.02,0.12] m`, tiles > 0 && tileBad === 0 && tileMiss <= tiles * 0.05,
      { tiles, bad: tileBad, missShell: tileMiss, gapMin: +gapMin.toFixed(3), gapMax: +gapMax.toFixed(3) }, true);
    // (b) 추녀마루·내림마루
    const ridgesB = meshes.filter((m) => m.name.startsWith(`${roof.prefix}_hipridge_`) || m.name.startsWith(`${roof.prefix}_naerim_`));
    const rres = [];
    for (const m of ridgesB) {
      const b = worldBox(m); const c = b.getCenter(new THREE.Vector3());
      ray.set(new THREE.Vector3(c.x, c.y + 2, c.z), new THREE.Vector3(0, -1, 0)); ray.far = 10;
      const h = ray.intersectObjects(tileShells, false)[0];
      const rel = h ? +(b.min.y - h.point.y).toFixed(3) : null; // 상자 하단 − 셸 외피
      rres.push({ m: m.name.replace(roof.prefix + '_', ''), rel, ok: h ? rel >= -0.12 && rel <= 0.25 : false });
    }
    push(`[7b] ${roof.prefix}: 추녀마루·내림마루가 셸 이음매 위 (하단−외피 ∈ [−0.12, 0.25])`, rres.length > 0 && rres.every((r) => r.ok), rres.filter((r) => !r.ok).map((r) => `${r.m}:${r.rel}`).concat([`n=${rres.length}`]), true);
    // (c) 추녀·사래·공포 상단 — 덮개 하면 아래
    const under = meshes.filter((m) => m.name.startsWith(`${roof.prefix}_chunyeo_`) || m.name.startsWith(`${roof.prefix}_sarae_`));
    const ures = [];
    for (const m of under) {
      const b = worldBox(m); const c = b.getCenter(new THREE.Vector3());
      // 부재 중심 xz에서 위→아래로 쏘아 보토 셸 외피를 찾고, 하면 = 외피 − BOTO_T. 관통량 = 부재 상단 − 하면 (양수 = 셸 안으로 들어감)
      ray.set(new THREE.Vector3(c.x, c.y + 10, c.z), new THREE.Vector3(0, -1, 0)); ray.far = 20;
      const h = ray.intersectObjects(lowShells, false)[0];
      const penet = h ? +(b.max.y - (h.point.y - T.BOTO_T)).toFixed(3) : null;
      ures.push({ m: m.name.replace(roof.prefix + '_', ''), penetration: penet, ok: h ? penet <= 0.05 : true });
    }
    push(`[7c] ${roof.prefix}: 추녀·사래 — 보토 셸 하면 관통량 (상단 − 하면 ≤ 0.05; null = 처마 밖)`, ures.every((r) => r.ok), ures.map((r) => `${r.m}:${r.penetration ?? '처마밖'}`), true);
    // (d) 합각 판벽
    const hap = meshes.filter((m) => m.name.startsWith(`${roof.prefix}_hapgak_`));
    const sideShells = roof.covers.filter((m) => /_hip_side_ROOF_SOIL_/.test(m.name));
    const hres = hap.map((m) => {
      const b = worldBox(m);
      const sideTop = Math.max(...sideShells.flatMap((sm) => worldVerts(sm, 'top').map((v) => v.y)));
      return { m: m.name.replace(roof.prefix + '_', ''), top: +b.max.y.toFixed(2), bottom: +b.min.y.toFixed(2), sideShellTop: +sideTop.toFixed(2), ok: b.max.y <= roof.ridgeTop + 0.05 && Math.abs(b.min.y - sideTop) <= 0.1 };
    });
    push(`[7d] ${roof.prefix}: 합각 판벽 상단 ≤ 용마루 갓, 하단 = 합각하부면 안쪽 가장자리 ±0.1`, hres.length > 0 && hres.every((r) => r.ok), hres, true);
  }
  // 공포 상단 vs 처마 하면 — 공포 부재(인스턴스 'gup'/'cheomcha' 등)는 InstancedMesh 키로 구분 불가하므로 브래킷 인스턴스 최고점 vs 처마 하면 최저점
  for (const roof of roofs) {
    const isHip = roof.covers.some((m) => /_hip_main_/.test(m.name)); if (!isHip) continue;
    const lowShells = roof.covers.filter((m) => m.userData.surface === 'ROOF_SOIL' && isShell(m));
    const eaveUnder = Math.min(...lowShells.flatMap((sm) => worldVerts(sm, 'bottom').map((v) => v.y)));
    const rb = new THREE.Box3(); for (const m of roof.covers) rb.union(worldBox(m)); rb.min.y = -1e9; rb.max.y = 1e9; // xz 포함 판정
    let brTop = -Infinity, brN = 0;
    for (const im of meshes) {
      if (!im.isInstancedMesh || !/inst_(gup|cheomcha|haenggong|salmi|jedong)/.test(im.name)) continue;
      im.geometry.computeBoundingBox(); const hh = im.geometry.boundingBox.max.y;
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, mat); p.setFromMatrixPosition(mat).applyMatrix4(im.matrixWorld); if (rb.containsPoint(p)) { brN++; brTop = Math.max(brTop, p.y + hh); } }
    }
    if (brN > 0) push(`[7e] ${roof.prefix}: 공포 부재 최고점 < 처마 보토 하면 최저점`, brTop < eaveUnder, { bracketTop: +brTop.toFixed(2), eaveUnderside: +eaveUnder.toFixed(2), parts: brN }, true);
  }
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

/* ---- [8] 창호 창살 방향 (톱니 모드) ---------------------------------------------- */
{
  const WALL_SURF = new Set(['HANJI', 'WOOD_PLANK', 'EARTH_WALL']);
  const prefixOf = (n) => n.split('_')[0];
  // 건물별 벽 메시 외피 박스 (지붕 제외 — 처마가 벽보다 내밀어 기준이 될 수 없다)
  const encl = new Map();
  for (const m of meshes) {
    const s = m.userData?.surface;
    if (!s || !WALL_SURF.has(s)) continue;
    const pf = prefixOf(m.name);
    if (!/^(dh|na|gs)$/.test(pf)) continue;
    const b = worldBox(m);
    const sz = b.getSize(new THREE.Vector3());
    if (sz.y < 0.8) continue;   // 마루(수평 널)는 벽보다 내밀어 외피 기준이 될 수 없다 — 수직 벽만
    if (b.min.y > 1.6) continue; // 박공벽은 처마 밑에서 벽선보다 내밀어 있다(내아 실측 1.5 m) — 바닥에서 올라온 벽만
    const cur = encl.get(pf);
    if (!cur) encl.set(pf, b.clone()); else cur.union(b);
  }
  // 창살 인스턴스 월드 좌표 (판 매칭용)
  const latInst = [];
  {
    const mat = new THREE.Matrix4(), p = new THREE.Vector3();
    scene.traverse((im) => {
      if (!im.isInstancedMesh || !/^inst_lat_/.test(im.name)) return;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mat); p.setFromMatrixPosition(mat).applyMatrix4(im.matrixWorld);
        latInst.push({ im, i, pos: p.clone() });
      }
    });
  }
  const panes = meshes.filter((m) => /_hanji$/.test(m.name) && m.geometry?.parameters?.width);
  const rows = [];
  for (const pane of panes) {
    const pf = prefixOf(pane.name);
    const box = encl.get(pf);
    if (!box) continue;
    const ry = pane.rotation.y;
    const axis = Math.abs(ry) < 0.1 ? 'z' : 'x';           // 법선 축
    const pos = pane.getWorldPosition(new THREE.Vector3());
    const pc = axis === 'z' ? pos.z : pos.x;
    const lo = axis === 'z' ? box.min.z : box.min.x;
    const hi = axis === 'z' ? box.max.z : box.max.x;
    const EPS = 0.2;
    const atLo = Math.abs(pc - lo) <= EPS, atHi = Math.abs(pc - hi) <= EPS;
    if (!atLo && !atHi) { rows.push({ pane: pane.name, kind: 'partition(양쪽 실내)', skipped: true }); continue; }
    const outward = atHi ? +1 : -1;                         // 실외 = 박스 바깥
    const hw = pane.geometry.parameters.width / 2, hh = pane.geometry.parameters.height / 2;
    let sum = 0, n = 0;
    for (const li of latInst) {
      const d = axis === 'z' ? li.pos.z - pos.z : li.pos.x - pos.x;
      if (Math.abs(d) > 0.06) continue;
      const lat = axis === 'z' ? li.pos.x - pos.x : li.pos.z - pos.z;
      if (Math.abs(lat) > hw + 0.05 || Math.abs(li.pos.y - pos.y) > hh + 0.05) continue;
      sum += d; n++;
      if (INJECT_LAT && pane.name === 'na_w_-3_hanji') {    // 음성 훅: 정상 판 하나를 판 평면 기준 반사
        const mat = new THREE.Matrix4(); li.im.getMatrixAt(li.i, mat);
        const q = new THREE.Vector3().setFromMatrixPosition(mat);
        if (axis === 'z') q.z = 2 * pos.z - li.pos.z; else q.x = 2 * pos.x - li.pos.x;
        mat.setPosition(q); li.im.setMatrixAt(li.i, mat);
        sum += -2 * d; // 반사된 오프셋으로 대체
      }
    }
    if (n === 0) { rows.push({ pane: pane.name, kind: '창살 없음', skipped: true }); continue; }
    const meanOff = sum / n;
    const latticeSide = Math.sign(meanOff) || 0;
    const ok7 = latticeSide === outward;
    rows.push({ pane: pane.name, axis, kind: '실외 접면', outward, latticeSide, meanOffset: +meanOff.toFixed(4), instances: n, ok: ok7 });
  }
  const viol = rows.filter((r) => r.ok === false);
  const checked = rows.filter((r) => !r.skipped).length;
  push(`[8] 창호 창살 방향 — 실외 접면 판의 창살이 실외 쪽 (톱니 상한 ${LATTICE_VIOLATION_CAP}건)`,
    viol.length <= LATTICE_VIOLATION_CAP,
    { 검사한_실외접면_판: checked, 칸막이_제외: rows.filter((r) => r.skipped).length, 위반: viol.length,
      상한: LATTICE_VIOLATION_CAP, 위반목록: viol.map((v) => v.pane) });
  latticeRows = rows;
}

const ok = checks.filter((c) => !c.advisory).every((c) => c.ok); // 게이트 = 불변식 1~6; [7] 파생 배치는 보고용(PATCH-006-C 표)
console.log(JSON.stringify({
  ok,
  ...(INJECT_FLIP ? { testOverride: 'inject-flip-roof — harnesstest 전용, 계약 판정 무효' } : {}),
  ...(INJECT_LAT ? { testOverride: 'inject-lattice-flip — harnesstest 전용, 계약 판정 무효' } : {}),
  latticeOrientation: latticeRows,
  roofs: roofs.map((r) => ({ prefix: r.prefix, axis: r.axis, ridgeTop: +r.ridgeTop.toFixed(2), covers: r.covers.length })),
  failed: checks.filter((c) => !c.ok && !c.advisory).length,
  advisoryFailed: checks.filter((c) => !c.ok && c.advisory).length,
  checks,
}, null, 2));
process.exit(ok ? 0 : 1);
