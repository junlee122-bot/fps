/**
 * src/fx/decals.js — 탄흔 데칼 512 풀 (P2B-BRIEF §5).
 *
 * 에빅션 결정성 (§3-3): 삽입 인덱스 기반 순환 덮어쓰기(FIFO). 벽시계·부팅
 * 의존 프레임 번호·거리 정렬을 쓰지 않는다 — 삽입 카운터만이 순서를 정한다.
 *
 * 배치 규약 (§3-4): 정지 탄은 computePenetration path의 마지막 항목이
 * 가리키는 층의 **진입면**에 찍힌다 (호출자 firecontrol/FxSystem이 보장).
 * 관통 층은 진입면마다 1개.
 *
 * HANJI는 데칼 대상이 아니다 — 구멍(불투명도) + 찢김(tear)은 별도 시스템.
 * DANCHEONG/LACQUER(DECAL 표면)는 하부재 데칼 위에 박리 데칼이 얹힌다.
 *
 * 룩(색·실루엣)은 P3 소유 — src/materials/fx-look.js 의 DECAL_LOOK/PEEL_LOOK 표와
 * fx-alpha-atlas.js 가 구운 아틀라스를 읽는다. 여기는 배치·수명·에빅션만 소유한다.
 * (P2B의 "표면 무관 회색 원형 1종"은 자리표시자였고 R4 작업 2-d 에서 교체되었다:
 *  흙벽·목재·화강암·기와의 탄흔이 실루엣과 색에서 서로 달라야 한다.)
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';
import { DECAL_LOOK, PEEL_LOOK, hsvToRgb } from '../materials/fx-look.js';
import { buildDecalAtlas, decalCellOf, decalCoverageOf, DECAL_COLS, DECAL_ROWS } from '../materials/fx-alpha-atlas.js';

export const DECAL_BUDGET = 512;

const LOOK_COLOR = new Map();
for (const table of [DECAL_LOOK, PEEL_LOOK]) {
  for (const [k, L] of Object.entries(table)) {
    const [r, g, b] = hsvToRgb(L.hue, L.sat, L.light);
    LOOK_COLOR.set(k, new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace));
  }
}
const DECAL_SIZE = [0.045, 0.075]; // m (rng 균일)
const PEEL_SIZE = [0.10, 0.16];    // 박리는 더 크다

/**
 * 인스턴스별 아틀라스 셀 오프셋 주입 — 입자와 같은 방식(드로콜 1·프로그램 1).
 * 두 재질(탄흔·박리)이 같은 캐시 키를 쓰므로 프로그램을 공유한다.
 */
function patchAtlasUv(mat, cacheKey) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute vec2 aCell;\n#include <common>')
      .replace('#include <uv_vertex>',
        `#include <uv_vertex>\n\tvMapUv = ( vMapUv + aCell ) * vec2( ${(1 / DECAL_COLS).toFixed(6)}, ${(1 / DECAL_ROWS).toFixed(6)} );`);
  };
  mat.customProgramCacheKey = () => cacheKey;
}

export class DecalPool {
  constructor(scene) {
    this.capacity = DECAL_BUDGET;
    this.cursor = 0;      // 총 삽입 수 — 슬롯 = cursor % capacity (§3-3 FIFO)
    this.sizes = new Float32Array(DECAL_BUDGET); // overdraw 산출용

    const geo = new THREE.PlaneGeometry(1, 1);
    this.atlas = buildDecalAtlas();
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_BUDGET * 2), 2);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cellAttr);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: this.atlas, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.name = 'FX_DECAL';
    patchAtlasUv(mat, 'fx_decal_atlas');
    this.mesh = new THREE.InstancedMesh(geo, mat, DECAL_BUDGET);
    this.mesh.name = 'fx_decals';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instanceColor 버퍼를 **부팅 시** 확보한다 — 첫 탄흔에서 생기면 USE_INSTANCING_COLOR가
    // 그때 켜지며 플레이 중 셰이더 컴파일이 발생한다(P0 원칙 위반).
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    // 박리(DECAL 표면) 전용 — 밝은 회색, 소량 풀
    this.peelCapacity = 64;
    this.peelCursor = 0;
    this.peelSizes = new Float32Array(64);
    const peelMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: this.atlas, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    peelMat.name = 'FX_DECAL_PEEL';
    patchAtlasUv(peelMat, 'fx_decal_atlas'); // 같은 캐시 키 — 프로그램을 공유한다(+0)
    const peelGeo = geo.clone();
    this.peelCellAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.peelCapacity * 2), 2);
    this.peelCellAttr.setUsage(THREE.DynamicDrawUsage);
    peelGeo.setAttribute('aCell', this.peelCellAttr);
    this.peelMesh = new THREE.InstancedMesh(peelGeo, peelMat, this.peelCapacity);
    this.peelMesh.name = 'fx_decals_peel';
    this.peelMesh.count = 0;
    this.peelMesh.castShadow = false;
    this.peelMesh.receiveShadow = false;
    this.peelMesh.frustumCulled = false;
    this.peelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.peelMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.peelMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.peelMesh.renderOrder = 1; // 박리가 탄흔 아래
    scene.add(this.peelMesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();
    /** 슬롯별 실루엣 채움 비율 — overdraw 추정 */
    this.coverage = new Float32Array(DECAL_BUDGET);
    this.peelCoverage = new Float32Array(this.peelCapacity);
  }

  _rand() {
    return rngStream('fx:decals')();
  }

  _place(mesh, capacity, cursorField, sizeArr, x, y, z, nx, ny, nz, size, look, cellAttr, covArr) {
    const slot = this[cursorField] % capacity;
    this[cursorField]++;
    this._n.set(nx, ny, nz);
    this._q.setFromUnitVectors(this._z, this._n);
    // 노멀 축 회전각 — 시드 RNG (§3-2)
    const spin = new THREE.Quaternion().setFromAxisAngle(this._n, this._rand() * Math.PI * 2);
    this._q.premultiply(spin);
    // 표면에서 1.5mm 부양 (z-fight 회피 — polygonOffset과 이중 안전)
    this._p.set(x + nx * 0.0015, y + ny * 0.0015, z + nz * 0.0015);
    this._s.set(size, size, size);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(slot, this._m);
    if (sizeArr) sizeArr[slot] = size;
    // 룩: 표면별 실루엣 셀 + 색 (P3 표)
    const [cx, cy] = decalCellOf(look.look.shape);
    cellAttr.setXY(slot, cx, cy);
    cellAttr.needsUpdate = true;
    mesh.setColorAt(slot, look.color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (covArr) covArr[slot] = decalCoverageOf(look.look.shape);
    mesh.count = Math.min(this[cursorField], capacity);
    mesh.instanceMatrix.needsUpdate = true;
    return slot;
  }

  /** 표면 id → {look, color} (미등록은 조용히 넘어가지 않는다 — PATCH-001-D) */
  _lookOf(table, surfaceId, what) {
    const look = table[surfaceId];
    if (!look) throw new Error(`${what} 룩 미등록 표면: ${surfaceId}`);
    return { look, color: LOOK_COLOR.get(surfaceId) };
  }

  /** 탄흔 1개. 진입면 위치 + 노멀 + 표면 id(룩 선택) */
  add(x, y, z, nx, ny, nz, surfaceId) {
    const L = this._lookOf(DECAL_LOOK, surfaceId, '탄흔');
    const size = (DECAL_SIZE[0] + this._rand() * (DECAL_SIZE[1] - DECAL_SIZE[0])) * L.look.sizeK;
    return this._place(this.mesh, this.capacity, 'cursor', this.sizes, x, y, z, nx, ny, nz, size,
      L, this.cellAttr, this.coverage);
  }

  /** 박리 (DANCHEONG/LACQUER 층이 관통 체인에 있던 히트) */
  addPeel(x, y, z, nx, ny, nz, surfaceId) {
    const L = this._lookOf(PEEL_LOOK, surfaceId, '박리');
    const size = (PEEL_SIZE[0] + this._rand() * (PEEL_SIZE[1] - PEEL_SIZE[0])) * L.look.sizeK;
    return this._place(this.peelMesh, this.peelCapacity, 'peelCursor', this.peelSizes, x, y, z, nx, ny, nz, size,
      L, this.peelCellAttr, this.peelCoverage);
  }

  /** overdraw 기여: 활성 데칼(탄흔+박리) 화면 투영 면적 합 (§7 — 박리 누락 감사 정정) */
  overdrawArea(camera, viewportH) {
    const k = (viewportH / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    // [R4 작업 2-d] 원반(π r²) 가정 → 실루엣 채움 비율. 임계값이 아니라 측정을 고친다.
    const sumOf = (mesh, cursor, capacity, sizes, cov) => {
      const n = Math.min(cursor, capacity);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        mesh.getMatrixAt(i, this._m);
        const e = this._m.elements;
        const d = Math.max(0.3, Math.hypot(e[12] - cx, e[13] - cy, e[14] - cz));
        const sPx = sizes[i] * k / d;
        sum += (cov[i] || 0.5) * sPx * sPx;
      }
      return sum;
    };
    return sumOf(this.mesh, this.cursor, this.capacity, this.sizes, this.coverage) +
           sumOf(this.peelMesh, this.peelCursor, this.peelCapacity, this.peelSizes, this.peelCoverage);
  }

  reset() {
    this.cursor = 0;
    this.peelCursor = 0;
    this.mesh.count = 0;
    this.peelMesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.peelMesh.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return {
      cursor: this.cursor,
      used: Math.min(this.cursor, this.capacity),
      peelCursor: this.peelCursor,
    };
  }
}
