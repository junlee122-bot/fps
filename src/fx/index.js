/**
 * src/fx/index.js — FX 조정자 (P2B). P2A placeholder를 대체한다.
 *
 * 이벤트 어휘(ARCHITECTURE §3)만 구독한다 — weapons/physics를 import하지 않는다.
 *  ballistic:hit  → 표면 fx 프로파일 파티클 + 데칼(진입면) + 기와 낙하 + HANJI 찢김
 *  weapon:fire    → 총구화염 + light:transient + (다음 첫 히트까지의) 예광 시점 기록
 *
 * 데칼 배치 규약 (§3-4): 모든 히트의 진입면에 찍으므로, 정지 탄의 마지막
 * 데칼 = computePenetration path 마지막 층의 진입면 — 규약을 자동 만족한다
 * (정지 이후 층은 히트 이벤트 자체가 없다).
 *
 * 예광은 어휘 제약 안에서: weapon:fire의 총구 + 해당 격발 이후 첫
 * ballistic:hit(layerIndex 0)의 진입점을 종점으로 스폰한다 — 탄자는 첫
 * 임팩트에서 시각적으로 소멸한다. 미스(히트 0)는 예광 없음 (정직한 한계).
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';
import { bus } from '../core/events.js';
import { SURFACES, PenClass } from '../core/surfaces.js';
import { ParticlePool } from './particles.js';
import { DecalPool } from './decals.js';
import { TracerPool } from './tracers.js';
import { MuzzleFlash } from './muzzleflash.js';
import { TileDebris } from './debris.js';

/** 데칼 제외 표면: HANJI는 구멍+찢김, WATER는 수면 (데칼 부적합) */
const NO_DECAL = new Set(['HANJI', 'WATER']);
const TEAR_CAPACITY = 128;
const TEAR_SIZE = [0.02, 0.045];

export class FxSystem {
  constructor(scene, { spawnBody, despawnBody }) {
    this.scene = scene;
    this.particles = new ParticlePool(scene);
    this.decals = new DecalPool(scene);
    this.tracers = new TracerPool(scene);
    this.flash = new MuzzleFlash(scene);
    this.debris = new TileDebris(spawnBody, despawnBody);

    // HANJI 찢김 쿼드 풀 (지속 — 불투명도 시스템의 시각 짝)
    const tearGeo = new THREE.PlaneGeometry(1, 1);
    const tearMat = new THREE.MeshBasicMaterial({
      color: 0x1f1f21, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    tearMat.name = 'FX_TEAR';
    this.tearMesh = new THREE.InstancedMesh(tearGeo, tearMat, TEAR_CAPACITY);
    this.tearMesh.name = 'fx_hanji_tears';
    this.tearMesh.count = 0;
    this.tearMesh.castShadow = false;
    this.tearMesh.receiveShadow = false;
    this.tearMesh.frustumCulled = false;
    this.tearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tearMesh);
    this.tearCursor = 0;

    /** 마지막 weapon:fire의 총구 — 격발 직후 펠릿들의 예광 시점 */
    this._muzzle = null;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();

    bus.on('weapon:fire', (e) => {
      this._muzzle = e.muzzleWorldPos.slice();
      this.flash.fire(
        e.muzzleWorldPos[0], e.muzzleWorldPos[1], e.muzzleWorldPos[2],
        e.dir[0], e.dir[1], e.dir[2],
      );
    });

    bus.on('ballistic:hit', (e) => this.onHit(e));
  }

  onHit(e) {
    const surf = SURFACES[e.surfaceType];
    if (!surf) throw new Error(`fx: unknown surface ${e.surfaceType}`); // PATCH-001-D
    const [x, y, z] = e.worldPos;
    const [nx, ny, nz] = e.normal;

    // 1. 파티클 — 표면 fx 프로파일 (15종 전수)
    this.particles.emit(surf.fx, x, y, z, nx, ny, nz);

    // 2. 데칼 — 진입면. DECAL 표면은 박리로, HANJI/WATER는 제외
    if (surf.penClass === PenClass.DECAL) {
      this.decals.addPeel(x, y, z, nx, ny, nz);
    } else if (!NO_DECAL.has(e.surfaceType)) {
      this.decals.add(x, y, z, nx, ny, nz);
    }

    // 3. 기와 낙하 (ARCHITECTURE §2)
    if (e.surfaceType === 'ROOF_TILE') {
      this.debris.spawnAt(x, y, z, nx, ny, nz, e.incidentEnergy);
    }

    // 4. HANJI 찢김 형상
    if (e.surfaceType === 'HANJI') {
      this.spawnTear(x, y, z, nx, ny, nz);
    }

    // 5. 예광 — 격발 후 첫 레이어 히트가 종점
    if (e.layerIndex === 0 && this._muzzle) {
      this.tracers.spawn(this._muzzle[0], this._muzzle[1], this._muzzle[2], x, y, z);
    }
  }

  spawnTear(x, y, z, nx, ny, nz) {
    const rand = rngStream('fx:tear');
    const slot = this.tearCursor % TEAR_CAPACITY;
    this.tearCursor++;
    this._n.set(nx, ny, nz);
    this._q.setFromUnitVectors(this._z, this._n);
    const spin = new THREE.Quaternion().setFromAxisAngle(this._n, rand() * Math.PI * 2);
    this._q.premultiply(spin);
    const s = TEAR_SIZE[0] + rand() * (TEAR_SIZE[1] - TEAR_SIZE[0]);
    this._p.set(x + nx * 0.002, y + ny * 0.002, z + nz * 0.002);
    this._s.set(s, s * (0.5 + rand() * 0.8), s); // 세장비 변주 — 찢김 느낌
    this._m.compose(this._p, this._q, this._s);
    this.tearMesh.setMatrixAt(slot, this._m);
    this.tearMesh.count = Math.min(this.tearCursor, TEAR_CAPACITY);
    this.tearMesh.instanceMatrix.needsUpdate = true;
  }

  /** 고정 스텝 — 시뮬레이션 (harness simSubstep에서 호출) */
  update(dt) {
    this.particles.update(dt);
    this.tracers.update(dt);
    this.flash.update(dt);
  }

  /** 렌더 직전 — 빌보드·스트릭 행렬 기록 */
  writeInstances(camera) {
    this.particles.writeInstances(camera);
    this.tracers.writeInstances();
  }

  /** §7 overdraw_estimate: (파티클+데칼 화면 투영 면적) / 화면 픽셀 수 */
  overdrawEstimate(camera, viewportW, viewportH) {
    const area = this.particles.overdrawArea(camera, viewportH) +
                 this.decals.overdrawArea(camera, viewportH);
    return area / (viewportW * viewportH);
  }

  /**
   * 프리웜 — 모든 fx 머티리얼이 한 번씩 렌더되도록 대표 인스턴스 활성화.
   * writeInstances까지 해서 인스턴스 count>0 상태로 렌더 경로를 태운다
   * (compileAsync 커버 + 실렌더 이중 보증).
   */
  prewarmSpawn(camera) {
    this.particles.emit('dust_burst', 0, 2, 0, 0, 1, 0);
    this.decals.add(0, 2, 0, 0, 0, 1);
    this.decals.addPeel(0.3, 2, 0, 0, 0, 1);
    this.tracers.spawn(0, 2, 0, 0, 2, -3);
    this.flash.fire(0, 2, 0, 0, 0, -1);
    this.spawnTear(0.6, 2, 0, 0, 0, 1);
    this.writeInstances(camera);
  }

  /** resetState — §3-1 전 항목 */
  reset() {
    this.particles.reset();
    this.decals.reset();
    this.tracers.reset();
    this.flash.reset();
    this.debris.reset();
    this.tearCursor = 0;
    this.tearMesh.count = 0;
    this.tearMesh.instanceMatrix.needsUpdate = true;
    this._muzzle = null;
  }

  snapshot() {
    return {
      particles: this.particles.snapshot(),
      decals: this.decals.snapshot(),
      tracers: this.tracers.snapshot(),
      flash: this.flash.snapshot(),
      debris: this.debris.snapshot(),
      tears: this.tearCursor,
    };
  }
}
