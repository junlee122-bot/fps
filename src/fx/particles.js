/**
 * src/fx/particles.js — 결정적 파티클 풀 (P2B-BRIEF §2·§3).
 *
 * 시뮬레이션은 CPU 고정 스텝(PHYSICS_DT 배수)에서만 진행한다 — GPU 시뮬은
 * 드라이버별 부동소수점 차이가 결정성을 위협하므로 배제. 렌더는 단일
 * InstancedMesh(용량 = 예산 4,000) + 카메라 정렬 빌보드.
 *
 * 결정성 규약:
 *  - 난수는 방출 시점에만, rngStream('fx:particles')에서만 소비
 *  - 활성 목록은 밀집 배열 + swap-remove — 규칙이 고정이라 순서 결정적
 *  - reset()이 풀 상태(활성·수명·누적자) 전부를 부팅 상태로 되돌린다
 *
 * 회색 규율: 밝기 3단계 무채색 인스턴스 컬러만. 룩(색·발광)은 P3 소유.
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';
import { FX_PROFILES } from './profiles.js';

export const PARTICLE_BUDGET = 4000;
const GRAVITY = 20.6; // rigidbody 월드와 동일 값

/** 밝기 3단계 (무채색) — 인스턴스 컬러 */
const BRIGHTNESS = [
  new THREE.Color(0x3a3a3c),
  new THREE.Color(0x77746e),
  new THREE.Color(0xb9b7b1),
];

export class ParticlePool {
  constructor(scene) {
    const n = PARTICLE_BUDGET;
    this.capacity = n;
    this.active = 0;
    // SoA 상태
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.gravityK = new Float32Array(n);
    this.drag = new Float32Array(n);
    /** 통계·감사용: 이 입자를 만든 프로파일 키 */
    this.profileOf = new Array(n).fill(null);

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.name = 'FX_PARTICLE';
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'fx_particles';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; // 활성 구간이 동적 — 컬링 판정 비용/일관성 회피
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instanceColor 버퍼 생성 (setColorAt 1회로 확보)
    this.mesh.setColorAt(0, BRIGHTNESS[0]);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._quat = new THREE.Quaternion();
    this._mat4 = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    /** 방출 누적 계수 (감사·overdraw 근거) */
    this.emittedTotal = 0;
  }

  _rand() {
    return rngStream('fx:particles')();
  }

  /**
   * 프로파일 방출. dir = 표면 노멀(정규화). 예산 초과분은 조용히 버리지 않고
   * 가장 오래된 입자를 밀어낸다(FIFO성 — swap-remove라 엄밀 FIFO는 아니지만
   * 규칙이 고정이라 결정적).
   */
  emit(profileKey, x, y, z, nx, ny, nz) {
    const p = FX_PROFILES[profileKey];
    if (!p) throw new Error(`unknown fx profile: ${profileKey}`); // PATCH-001-D 정신
    // 노멀 기준 직교 기저 (결정적 — 입력에만 의존)
    const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = Math.abs(nx) < 0.9 ? 0 : 1;
    let t1x = ny * 0 - nz * ay, t1y = nz * ax - nx * 0, t1z = nx * ay - ny * ax;
    const t1l = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1l; t1y /= t1l; t1z /= t1l;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;

    for (let k = 0; k < p.count; k++) {
      let i;
      if (this.active < this.capacity) {
        i = this.active++;
      } else {
        i = this.emittedTotal % this.capacity; // 포화 시 결정적 재사용
      }
      this.emittedTotal++;
      const a = this._rand() * Math.PI * 2;
      const r = Math.sin(p.spread) * Math.sqrt(this._rand());
      const cz = Math.sqrt(Math.max(0, 1 - r * r));
      const dx = nx * cz + (Math.cos(a) * t1x + Math.sin(a) * t2x) * r;
      const dy = ny * cz + (Math.cos(a) * t1y + Math.sin(a) * t2y) * r;
      const dz = nz * cz + (Math.cos(a) * t1z + Math.sin(a) * t2z) * r;
      const spd = p.speed[0] + this._rand() * (p.speed[1] - p.speed[0]);
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = dx * spd; this.vy[i] = dy * spd; this.vz[i] = dz * spd;
      const life = p.life[0] + this._rand() * (p.life[1] - p.life[0]);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size[i] = p.size[0] + this._rand() * (p.size[1] - p.size[0]);
      this.gravityK[i] = p.gravityK;
      this.drag[i] = p.drag;
      this.profileOf[i] = profileKey;
      this.mesh.setColorAt(i, BRIGHTNESS[p.brightness]);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** 고정 스텝 적분 — 만료는 swap-remove (규칙 고정 = 결정적) */
  update(dt) {
    let i = 0;
    while (i < this.active) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.active;
        if (i !== last) this._swap(i, last);
        continue; // i 재검사
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr;
      this.vy[i] = this.vy[i] * dr - GRAVITY * this.gravityK[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      i++;
    }
  }

  _swap(a, b) {
    const F = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'gravityK', 'drag'];
    for (const f of F) { const t = this[f][a]; this[f][a] = this[f][b]; this[f][b] = t; }
    const tp = this.profileOf[a]; this.profileOf[a] = this.profileOf[b]; this.profileOf[b] = tp;
    // instanceColor도 스왑 반영 (렌더 시 다시 안 쓰므로 즉시)
    const ca = new THREE.Color(), cb = new THREE.Color();
    this.mesh.getColorAt(a, ca); this.mesh.getColorAt(b, cb);
    this.mesh.setColorAt(a, cb); this.mesh.setColorAt(b, ca);
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** 렌더 직전 — 카메라 빌보드 행렬 기록 */
  writeInstances(camera) {
    this._quat.copy(camera.quaternion);
    for (let i = 0; i < this.active; i++) {
      // 수명 마지막 25%는 축소 소멸 (투명도 없이 회색 규율 유지)
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (t < 0.25 ? t / 0.25 : 1);
      this._pos.set(this.px[i], this.py[i], this.pz[i]);
      this._scale.set(s, s, s);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.mesh.setMatrixAt(i, this._mat4);
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * overdraw 추정 기여분: Σ(입자 화면 투영 면적 px²). CPU 산출 (§7).
   * area = π·(size/2 · (H/2)/(dist·tan(fov/2)))²
   */
  overdrawArea(camera, viewportH) {
    const k = (viewportH / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    let sum = 0;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < this.active; i++) {
      const d = Math.max(0.3, Math.hypot(this.px[i] - cx, this.py[i] - cy, this.pz[i] - cz));
      const rPx = (this.size[i] / 2) * k / d;
      sum += Math.PI * rPx * rPx;
    }
    return sum;
  }

  reset() {
    this.active = 0;
    this.emittedTotal = 0;
    this.profileOf.fill(null);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return { active: this.active, emittedTotal: this.emittedTotal };
  }
}
