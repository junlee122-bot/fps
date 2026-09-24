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
 * 룩(색·모양)은 P3 소유 — src/materials/fx-look.js 의 표를 읽어 인스턴스 컬러·
 * 종횡비·회전·알파 실루엣에 싣는다. 이 파일은 운동학과 배선만 소유한다.
 * (P2B의 회색 3단계 무채색은 자리표시자였고 R4 작업 2에서 교체되었다.)
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';
import { FX_PROFILES } from './profiles.js';
import { FX_LOOK, hsvToRgb } from '../materials/fx-look.js';
import { buildAlphaAtlas, cellOf, ATLAS_COLS, ATLAS_ROWS, coverageOf } from '../materials/fx-alpha-atlas.js';

export const PARTICLE_BUDGET = 4000;
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const GRAVITY = 20.6; // rigidbody 월드와 동일 값

/** 자발광 가중 → 선형 색 배수 (AgX가 압축한다) */
const EMISSIVE_GAIN = 3.0;
/** 알파 컷아웃 임계 — 밉맵 축소에서 작은 입자가 사라지지 않을 만큼 낮게 */
const ALPHA_TEST = 0.4;


/** 룩 표 → 프로파일별 인스턴스 컬러(선형) — 부팅 1회 산출 */
const LOOK_COLOR = Object.fromEntries(Object.entries(FX_LOOK).map(([k, L]) => {
  const [r, g, b] = hsvToRgb(L.hue, L.sat, L.light);
  const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const gain = 1 + (L.emissive ?? 0) * EMISSIVE_GAIN;
  return [k, new THREE.Color(c.r * gain, c.g * gain, c.b * gain)];
}));
/** 프로파일별 실루엣 채움 비율 — overdraw 추정에 쓴다(사각형이 아니라 실루엣이 덮는다) */
const LOOK_COVERAGE = Object.fromEntries(Object.keys(FX_LOOK).map((k) => [k, coverageOf(FX_LOOK[k].alphaShape)]));

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
    /** 룩: 종횡비·롤(라디안)·실루엣 채움 비율 — 스왑 대상 */
    this.aspect = new Float32Array(n);
    this.roll = new Float32Array(n);
    this.coverage = new Float32Array(n);
    /** 1 = 속도 방향 정렬(불똥), 0 = 고정 롤 */
    this.alignVel = new Uint8Array(n);
    /** 통계·감사용: 이 입자를 만든 프로파일 키 */
    this.profileOf = new Array(n).fill(null);

    const geo = new THREE.PlaneGeometry(1, 1);
    /** 인스턴스별 아틀라스 셀 (열,행) */
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cellAttr);
    this.atlas = buildAlphaAtlas();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.atlas,          // RGBA 전 채널이 실루엣 값 — 알파컷 + 가장자리 감쇠
      alphaTest: ALPHA_TEST,    // 블렌딩이 아니라 컷아웃 (깊이·안개·정렬 규칙을 불투명과 동일하게)
      toneMapped: true,
    });
    mat.name = 'FX_PARTICLE';
    // 인스턴스 셀 오프셋 주입 — 드로콜 1·프로그램 1로 실루엣 8종
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', 'attribute vec2 aCell;\n#include <common>')
        .replace('#include <uv_vertex>',
          `#include <uv_vertex>\n\tvMapUv = ( vMapUv + aCell ) * vec2( ${(1 / ATLAS_COLS).toFixed(6)}, ${(1 / ATLAS_ROWS).toFixed(6)} );`);
    };
    mat.customProgramCacheKey = () => 'fx_particle_atlas';
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'fx_particles';
    this.mesh.userData.noAO = true; // GTAO 노멀/깊이 패스 제외 (R4)
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; // 활성 구간이 동적 — 컬링 판정 비용/일관성 회피
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instanceColor 버퍼 생성 (setColorAt 1회로 확보)
    this.mesh.setColorAt(0, LOOK_COLOR.dust_burst);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._quat = new THREE.Quaternion();
    this._rollQ = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
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
      const L = FX_LOOK[profileKey];
      if (!L) throw new Error(`fx 룩 미등록: ${profileKey}`); // 표와 룩은 짝이다 (fxaudit이 게이트)
      this.aspect[i] = L.aspect;
      this.coverage[i] = LOOK_COVERAGE[profileKey];
      this.alignVel[i] = L.align === 'velocity' ? 1 : 0;
      // 롤은 난수 스트림을 쓰지 않는다 — 황금비 수열(방출 누계 기준)이라 결정적이고
      // 기존 fx:particles 소비 순서를 건드리지 않는다.
      this.roll[i] = (this.emittedTotal * 0.6180339887498949 % 1) * Math.PI * 2;
      const [cx, cy] = cellOf(L.alphaShape);
      this.cellAttr.setXY(i, cx, cy);
      this.mesh.setColorAt(i, LOOK_COLOR[profileKey]);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
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
    const F = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'gravityK', 'drag',
      'aspect', 'roll', 'coverage', 'alignVel'];
    for (const f of F) { const t = this[f][a]; this[f][a] = this[f][b]; this[f][b] = t; }
    const ca0 = this.cellAttr.getX(a), ca1 = this.cellAttr.getY(a);
    this.cellAttr.setXY(a, this.cellAttr.getX(b), this.cellAttr.getY(b));
    this.cellAttr.setXY(b, ca0, ca1);
    this.cellAttr.needsUpdate = true;
    const tp = this.profileOf[a]; this.profileOf[a] = this.profileOf[b]; this.profileOf[b] = tp;
    // instanceColor도 스왑 반영 (렌더 시 다시 안 쓰므로 즉시)
    const ca = new THREE.Color(), cb = new THREE.Color();
    this.mesh.getColorAt(a, ca); this.mesh.getColorAt(b, cb);
    this.mesh.setColorAt(a, cb); this.mesh.setColorAt(b, ca);
    this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * 렌더 직전 — 카메라 빌보드 행렬 기록.
   * 롤: 입자마다 시선축 회전이 다르다(같은 실루엣이 같은 각도로 줄줄이 서는 것이 R3′ 지적).
   *     불똥(align:'velocity')만은 난수 롤 대신 화면 투영 속도 방향으로 눕는다.
   * 종횡비: 면적을 보존하며 늘린다(w=s√a, h=s/√a) — 입자 예산·overdraw 추정의 기준이 유지된다.
   */
  writeInstances(camera) {
    this._quat.copy(camera.quaternion);
    const e = camera.matrixWorldInverse.elements;
    for (let i = 0; i < this.active; i++) {
      // 수명 마지막 25%는 축소 소멸 (컷아웃이라 알파 페이드가 아니라 크기로 사라진다)
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (t < 0.25 ? t / 0.25 : 1);
      let roll = this.roll[i];
      if (this.alignVel[i]) {
        // 속도를 뷰 공간으로 투영 — 행렬 곱 없이 상단 2행만 쓴다
        const vxc = e[0] * this.vx[i] + e[4] * this.vy[i] + e[8] * this.vz[i];
        const vyc = e[1] * this.vx[i] + e[5] * this.vy[i] + e[9] * this.vz[i];
        if (vxc * vxc + vyc * vyc > 1e-8) roll = Math.atan2(vyc, vxc);
      }
      this._rollQ.setFromAxisAngle(AXIS_Z, roll);
      this._q2.copy(this._quat).multiply(this._rollQ);
      const a = Math.sqrt(this.aspect[i]);
      this._pos.set(this.px[i], this.py[i], this.pz[i]);
      this._scale.set(s * a, s / a, s);
      this._mat4.compose(this._pos, this._q2, this._scale);
      this.mesh.setMatrixAt(i, this._mat4);
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * overdraw 추정 기여분: Σ(입자 화면 투영 면적 px²). CPU 산출 (§7).
   * area = coverage · (size · (H/2)/(dist·tan(fov/2)))²
   *
   * [R4 작업 2] 이전 식은 π·(r)² — 지름 size 의 **원반**을 가정했다. 입자는 이제
   * 알파 컷아웃 실루엣이고 종횡비로 늘어나므로, 사각형 면적(size², 종횡비는 면적
   * 보존)에 실루엣 채움 비율을 곱하는 것이 실제 덮는 픽셀에 가깝다. 임계값은
   * 그대로 두고 측정 대상을 고쳤다 — 값이 움직이면 그것이 사실이다.
   */
  overdrawArea(camera, viewportH) {
    const k = (viewportH / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    let sum = 0;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < this.active; i++) {
      const d = Math.max(0.3, Math.hypot(this.px[i] - cx, this.py[i] - cy, this.pz[i] - cz));
      const sPx = this.size[i] * k / d;
      sum += (this.coverage[i] || 0.5) * sPx * sPx;
    }
    return sum;
  }

  reset() {
    this.active = 0;
    this.emittedTotal = 0;
    this.profileOf.fill(null);
    this.alignVel.fill(0);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return { active: this.active, emittedTotal: this.emittedTotal };
  }
}
