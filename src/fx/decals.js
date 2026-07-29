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
 * 회색 규율: 어두운 회색 원형 알파(절차 생성 캔버스 텍스처 — 부팅 시 1회,
 * 결정적 수식) 1종 + 박리용 밝은 회색 1종.
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';

export const DECAL_BUDGET = 512;
const DECAL_SIZE = [0.045, 0.075]; // m (rng 균일)
const PEEL_SIZE = [0.10, 0.16];    // 박리는 더 크다

/** 절차 원형 알파 텍스처 — 결정적 수식 (난수 없음) */
function makeSplatTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      // 중심 진하고 가장자리 소멸 + 각도 요철 (결정적 사인 합)
      const ang = Math.atan2(y - c, x - c);
      const rim = 0.82 + 0.13 * Math.sin(ang * 5) + 0.05 * Math.sin(ang * 11);
      const a = d < rim ? Math.max(0, 1 - Math.pow(d / rim, 1.6)) : 0;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

export class DecalPool {
  constructor(scene) {
    this.capacity = DECAL_BUDGET;
    this.cursor = 0;      // 총 삽입 수 — 슬롯 = cursor % capacity (§3-3 FIFO)
    this.sizes = new Float32Array(DECAL_BUDGET); // overdraw 산출용

    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = makeSplatTexture();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2e2e30, map: null, alphaMap: tex, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.name = 'FX_DECAL';
    this.mesh = new THREE.InstancedMesh(geo, mat, DECAL_BUDGET);
    this.mesh.name = 'fx_decals';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    // 박리(DECAL 표면) 전용 — 밝은 회색, 소량 풀
    this.peelCapacity = 64;
    this.peelCursor = 0;
    this.peelSizes = new Float32Array(64);
    const peelMat = new THREE.MeshBasicMaterial({
      color: 0x9d9a94, alphaMap: tex, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    peelMat.name = 'FX_DECAL_PEEL';
    this.peelMesh = new THREE.InstancedMesh(geo.clone(), peelMat, this.peelCapacity);
    this.peelMesh.name = 'fx_decals_peel';
    this.peelMesh.count = 0;
    this.peelMesh.castShadow = false;
    this.peelMesh.receiveShadow = false;
    this.peelMesh.frustumCulled = false;
    this.peelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.peelMesh.renderOrder = 1; // 박리가 탄흔 아래
    scene.add(this.peelMesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();
  }

  _rand() {
    return rngStream('fx:decals')();
  }

  _place(mesh, capacity, cursorField, sizeArr, x, y, z, nx, ny, nz, size) {
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
    mesh.count = Math.min(this[cursorField], capacity);
    mesh.instanceMatrix.needsUpdate = true;
    return slot;
  }

  /** 탄흔 1개. 진입면 위치 + 노멀 */
  add(x, y, z, nx, ny, nz) {
    const size = DECAL_SIZE[0] + this._rand() * (DECAL_SIZE[1] - DECAL_SIZE[0]);
    return this._place(this.mesh, this.capacity, 'cursor', this.sizes, x, y, z, nx, ny, nz, size);
  }

  /** 박리 (DANCHEONG/LACQUER 층이 관통 체인에 있던 히트) */
  addPeel(x, y, z, nx, ny, nz) {
    const size = PEEL_SIZE[0] + this._rand() * (PEEL_SIZE[1] - PEEL_SIZE[0]);
    return this._place(this.peelMesh, this.peelCapacity, 'peelCursor', this.peelSizes, x, y, z, nx, ny, nz, size);
  }

  /** overdraw 기여: 활성 데칼(탄흔+박리) 화면 투영 면적 합 (§7 — 박리 누락 감사 정정) */
  overdrawArea(camera, viewportH) {
    const k = (viewportH / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const sumOf = (mesh, cursor, capacity, sizes) => {
      const n = Math.min(cursor, capacity);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        mesh.getMatrixAt(i, this._m);
        const e = this._m.elements;
        const d = Math.max(0.3, Math.hypot(e[12] - cx, e[13] - cy, e[14] - cz));
        const rPx = (sizes[i] / 2) * k / d;
        sum += Math.PI * rPx * rPx;
      }
      return sum;
    };
    return sumOf(this.mesh, this.cursor, this.capacity, this.sizes) +
           sumOf(this.peelMesh, this.peelCursor, this.peelCapacity, this.peelSizes);
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
