/**
 * src/render/groundao.js — 접지 음영(지면 접촉 AO) 맵 베이크 (R4, R1·R2 "그림자·접지 음영 없음" 8/12).
 *
 * 측정(CONTRACT-NOTES R4): 화면 공간 GTAO 는 기둥 밑동(수직면)에는 .43–.22 의 폐색을 주지만 **기둥 옆 바닥에는 0**을 준다 — 눈높이
 * 시점에서 바닥 점의 수평 탐색 샘플이 얇은 수직 물체의 낮은 부분만 맞혀 지평선이 오르지 않는 기법 한계(반경·두께·scale 6종 스윕 전부 1.00).
 * 그래서 바닥 접촉 음영은 정적 지오메트리에서 **부팅 시 CPU 로 베이크**한 탑다운 맵으로 준다: 월드 그룹의 수직 구조물(기둥·벽·기단·소품,
 * 높이 ≥ minHeight, 바닥 근처에서 시작)의 XZ 풋프린트 바깥 거리 d 에 대해 k = strength(높이)·(1 − smoothstep(0, falloff, d)),
 * 텍셀 AO = Π(1 − k). 상향면(surfN.y > 0) 재질(PACKED_DIRT·WOOD_PLANK·GRANITE)이 월드 XZ 로 샘플해 색에 곱한다(GTAO 합성과
 * 같은 의미 — 직사·간접 모두). 정적 세계 전제(동적 상자·파편은 제외). 결정적(정수 격자·순수 산술), 텍스처 1장·유니폼 2개, 순열 불변.
 */

import * as THREE from 'three';
import { clock } from '../core/clock.js';

export const GROUND_AO = Object.freeze({ res: 1024, falloff: 0.5, minHeight: 0.5, maxBaseY: 1.3, strength: 0.45, heightRef: 2.0 }); // 강도 .45/폭 .5 m: .55/.6 은 회랑 저해상에서 밑동 타원이 과하게 읽혀 한 단계 완화 (값 선택, P3)

const _bb = new THREE.Box3(); const _m = new THREE.Matrix4(); const _v = new THREE.Vector3();

/** 월드 그룹에서 접지 차폐물 풋프린트 수집 — { minX, maxX, minZ, maxZ, h } (월드 AABB) */
export function collectGroundOccluders(group, opts = GROUND_AO) {
  const out = [];
  const push = (bb) => {
    const h = bb.max.y - bb.min.y;
    if (h < opts.minHeight || bb.min.y > opts.maxBaseY) return; // 낮은 물체·공중 부재(보·지붕)는 제외
    out.push({ minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z, h });
  };
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.visible || o.userData.auditOnly || o.userData.groundAoIgnore) return;
    if (!o.geometry?.attributes?.position) return;
    if (o.name === 'ground' || o.userData.surface === 'HANJI') return;
    o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); _bb.copy(o.geometry.boundingBox).applyMatrix4(_m); push(_bb); }
    } else {
      _bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); push(_bb);
    }
  });
  return out;
}

/**
 * 베이크 → { texture: DataTexture(R8, res²), bounds: {minX, minZ, sizeX, sizeZ}, occluders, ms }
 * bounds 는 차폐물 전체 AABB + falloff 여유. 차폐물마다 자기 영향 사각형만 순회한다(비용 = Σ 영향 면적).
 */
export function bakeGroundAo(group, opts = GROUND_AO) {
  const t0 = clock.wallNowMs();
  const occ = collectGroundOccluders(group, opts);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const o of occ) { minX = Math.min(minX, o.minX); maxX = Math.max(maxX, o.maxX); minZ = Math.min(minZ, o.minZ); maxZ = Math.max(maxZ, o.maxZ); }
  if (!occ.length) { minX = -1; maxX = 1; minZ = -1; maxZ = 1; }
  minX -= opts.falloff; minZ -= opts.falloff; maxX += opts.falloff; maxZ += opts.falloff;
  const res = opts.res; const sizeX = maxX - minX, sizeZ = maxZ - minZ;
  const ao = new Float32Array(res * res).fill(1);
  const tx = (x) => (x - minX) / sizeX * res, tz = (z) => (z - minZ) / sizeZ * res;
  for (const o of occ) {
    const k0 = opts.strength * THREE.MathUtils.clamp(o.h / opts.heightRef, 0.35, 1.0);
    const i0 = Math.max(0, Math.floor(tx(o.minX - opts.falloff))), i1 = Math.min(res - 1, Math.ceil(tx(o.maxX + opts.falloff)));
    const j0 = Math.max(0, Math.floor(tz(o.minZ - opts.falloff))), j1 = Math.min(res - 1, Math.ceil(tz(o.maxZ + opts.falloff)));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + (j + 0.5) / res * sizeZ;
      const dz = Math.max(o.minZ - z, 0, z - o.maxZ);
      for (let i = i0; i <= i1; i++) {
        const x = minX + (i + 0.5) / res * sizeX;
        const dx = Math.max(o.minX - x, 0, x - o.maxX);
        const d = Math.hypot(dx, dz);
        if (d >= opts.falloff) continue;
        const s = d / opts.falloff; const k = k0 * (1 - s * s * (3 - 2 * s));
        ao[j * res + i] *= 1 - k;
      }
    }
  }
  const data = new Uint8Array(res * res);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(ao[i] * 255);
  const texture = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  texture.name = 'GROUND_AO';
  return { texture, bounds: { minX, minZ, sizeX, sizeZ }, occluders: occ.length, ms: +(clock.wallNowMs() - t0).toFixed(1) };
}
