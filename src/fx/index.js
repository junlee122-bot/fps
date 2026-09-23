/**
 * src/fx/index.js — FX 조정자 (P2B). P2A placeholder를 대체한다.
 *
 * 이벤트 어휘(ARCHITECTURE §3)만 구독한다 — weapons/physics를 import하지 않는다.
 *  ballistic:hit  → 표면 fx 프로파일 파티클 + 데칼(진입면) + 기와 낙하
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

import { bus } from '../core/events.js';
import { SURFACES, PenClass } from '../core/surfaces.js';
import { ParticlePool } from './particles.js';
import { DecalPool } from './decals.js';
import { TracerPool } from './tracers.js';
import { MuzzleFlash } from './muzzleflash.js';
import { TileDebris } from './debris.js';

/** 데칼 제외 표면: HANJI는 구멍+찢어짐(해석적, materials/index.js), WATER는 수면 (데칼 부적합) */
const NO_DECAL = new Set(['HANJI', 'WATER']);

export class FxSystem {
  constructor(scene, { spawnBody, despawnBody }) {
    this.scene = scene;
    this.particles = new ParticlePool(scene);
    this.decals = new DecalPool(scene);
    this.tracers = new TracerPool(scene);
    this.flash = new MuzzleFlash(scene);
    this.debris = new TileDebris(spawnBody, despawnBody);

    // HANJI 찢김 쿼드 풀은 없다 — R3 불투명도 시스템의 시각 짝이었고, PATCH-013-B 해석적
    // 구멍·찢어짐(materials/index.js HANJI_TORN)이 그 역할을 가져갔다. 쿼드는 알파 없는
    // 불투명 검정 판이라 종이 위에 곧은 모서리 사각형으로 남았다 (R4 실측, pixelowner).

    /** 마지막 weapon:fire의 총구 — 격발 직후 펠릿들의 예광 시점 */
    this._muzzle = null;

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
    // memberBox: 맞은 부재 하나의 월드 AABB — 데칼을 그 상자 밖에서 자른다(좁은 부재 번짐 방지, R4)
    if (surf.penClass === PenClass.DECAL) {
      this.decals.addPeel(x, y, z, nx, ny, nz, e.surfaceType, e.memberBox ?? null);
    } else if (!NO_DECAL.has(e.surfaceType)) {
      this.decals.add(x, y, z, nx, ny, nz, e.surfaceType, e.memberBox ?? null);
    }

    // 3. 기와 낙하 (ARCHITECTURE §2)
    if (e.surfaceType === 'ROOF_TILE') {
      this.debris.spawnAt(x, y, z, nx, ny, nz, e.incidentEnergy);
    }

    // 4. 예광 — 격발 후 첫 레이어 히트가 종점
    if (e.layerIndex === 0 && this._muzzle) {
      this.tracers.spawn(this._muzzle[0], this._muzzle[1], this._muzzle[2], x, y, z);
    }
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
    this.decals.add(0, 2, 0, 0, 0, 1, 'EARTH_WALL');
    this.decals.addPeel(0.3, 2, 0, 0, 0, 1, 'DANCHEONG');
    this.tracers.spawn(0, 2, 0, 0, 2, -3);
    this.flash.fire(0, 2, 0, 0, 0, -1);
    this.writeInstances(camera);
  }

  /** resetState — §3-1 전 항목 */
  reset() {
    this.particles.reset();
    this.decals.reset();
    this.tracers.reset();
    this.flash.reset();
    this.debris.reset();
    this._muzzle = null;
  }

  snapshot() {
    return {
      particles: this.particles.snapshot(),
      decals: this.decals.snapshot(),
      tracers: this.tracers.snapshot(),
      flash: this.flash.snapshot(),
      debris: this.debris.snapshot(),
    };
  }
}
