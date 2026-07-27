/**
 * 임펄스 강체 — 파편·기와 조각·탄피·낙하물용.
 *
 * 참조 레포(Claude of Duty)의 검증된 구현을 이식. 표면 매핑만
 * 동결 계약 어댑터로 교체했다.
 *
 * 6-DoF 전체: 반음해 오일러 적분, 매 스텝 월드 공간으로 회전되는 관성 텐서,
 * 쿨롱 마찰·반발이 있는 순차 임펄스 접촉 해석, 슬롭 있는 위치 보정,
 * 아일랜드 없는 슬립 시스템(멈춘 강체는 통째로 스킵).
 *
 * 형상은 *접촉 생성*에 한해 소수의 로컬 "프로브" 구로 근사한다 —
 * 박스는 8 코너, 구는 1, 캡슐은 2..3. 정지 거동이 정확하고
 * (박스가 바닥에서 4접촉으로 평평하게 눕는다) SAT 클리핑 대비 비용이 몇 분의 1.
 */

import * as THREE from 'three';
import { makeHitRecord, closestPtPointTriangle } from './math.js';
import { MASK, SURFACE_PROPS } from './surface-registry.js';

const _m3 = new THREE.Matrix3();
const _m3b = new THREE.Matrix3();

let _nextId = 1;

export class RigidBody {
  constructor(opts = {}) {
    this.id = _nextId++;
    this.shape = opts.shape ?? 'box';
    this.active = true;

    const hx = opts.halfExtents?.x ?? opts.halfExtents?.[0] ?? 0.1;
    const hy = opts.halfExtents?.y ?? opts.halfExtents?.[1] ?? 0.1;
    const hz = opts.halfExtents?.z ?? opts.halfExtents?.[2] ?? 0.1;
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.radius = opts.radius ?? Math.min(hx, hy, hz);
    this.halfHeight = opts.halfHeight ?? Math.max(0, hy - this.radius);

    this.mass = opts.mass ?? 1;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.linearVelocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();

    this.restitution = opts.restitution ?? 0.25;
    this.friction = opts.friction ?? 0.6;
    /** 지수 공기 저항, 1/s */
    this.linearDamping = opts.linearDamping ?? 0.16;
    this.angularDamping = opts.angularDamping ?? 0.5;
    this.gravityScale = opts.gravityScale ?? 1;
    this.surface = opts.surface ?? 0;
    this.mask = opts.mask ?? MASK.DEBRIS;
    this.layer = opts.layer ?? 0;
    this.ccd = opts.ccd ?? true;

    this.sleeping = false;
    this.sleepTimer = 0;
    this.lifetime = opts.lifetime ?? Infinity;
    this.age = 0;

    this.object3D = opts.object3D ?? null;
    this.userData = opts.userData ?? null;
    this.onSleep = opts.onSleep ?? null;
    this.onImpact = opts.onImpact ?? null;
    /** 임팩트 보고 스로틀 — 한 번의 바운스가 8이벤트를 내지 않게 */
    this._impactCooldown = 0;

    this.invInertiaLocal = new THREE.Vector3();
    this.invInertiaWorld = new THREE.Matrix3();
    this._computeInertia();

    // 로컬 접촉 프로브: [x,y,z,r] * n
    this.probes = buildProbes(this);
    this.probeCount = this.probes.length / 4;
    /** 최소 프로브 반지름 — 이산 접촉 검출의 해상도 */
    this.probeRadius = Infinity;
    for (let i = 0; i < this.probeCount; i++) {
      if (this.probes[i * 4 + 3] < this.probeRadius) this.probeRadius = this.probes[i * 4 + 3];
    }
    /** 브로드페이즈·CCD 서브스텝 산정용 경계 반지름 */
    this.boundRadius = Math.hypot(hx, hy, hz);
    this.minExtent = Math.min(hx, hy, hz);

    if (opts.position) this.position.copy(opts.position);
    if (opts.quaternion) this.quaternion.copy(opts.quaternion);
    if (opts.velocity) this.linearVelocity.copy(opts.velocity);
    if (opts.angularVelocity) this.angularVelocity.copy(opts.angularVelocity);
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
  }

  _computeInertia() {
    const m = this.mass;
    if (m <= 0) {
      this.invInertiaLocal.set(0, 0, 0);
      return;
    }
    let ix, iy, iz;
    if (this.shape === 'sphere') {
      const i = 0.4 * m * this.radius * this.radius;
      ix = iy = iz = i;
    } else if (this.shape === 'capsule') {
      const r = this.radius, h = this.halfHeight * 2;
      const mc = m * (h / (h + 1.3333 * r));
      const ms = m - mc;
      const iyy = 0.5 * mc * r * r + 0.8 * ms * r * r;
      const ixx =
        mc * (0.25 * r * r + h * h / 12) +
        ms * (0.4 * r * r + 0.375 * r * h + 0.25 * h * h);
      ix = iz = ixx;
      iy = iyy;
    } else {
      const w = this.hx * 2, ht = this.hy * 2, d = this.hz * 2;
      const k = m / 12;
      ix = k * (ht * ht + d * d);
      iy = k * (w * w + d * d);
      iz = k * (w * w + ht * ht);
    }
    this.invInertiaLocal.set(ix > 0 ? 1 / ix : 0, iy > 0 ? 1 / iy : 0, iz > 0 ? 1 / iz : 0);
  }

  updateInertiaWorld() {
    _m3.setFromMatrix4(_mat4FromQuat(this.quaternion));
    const e = _m3.elements;
    const ix = this.invInertiaLocal.x, iy = this.invInertiaLocal.y, iz = this.invInertiaLocal.z;
    // R * diag(I) * R^T
    const a = _m3b.elements;
    a[0] = e[0] * ix; a[1] = e[1] * ix; a[2] = e[2] * ix;
    a[3] = e[3] * iy; a[4] = e[4] * iy; a[5] = e[5] * iy;
    a[6] = e[6] * iz; a[7] = e[7] * iz; a[8] = e[8] * iz;
    const o = this.invInertiaWorld.elements;
    o[0] = a[0] * e[0] + a[3] * e[3] + a[6] * e[6];
    o[1] = a[1] * e[0] + a[4] * e[3] + a[7] * e[6];
    o[2] = a[2] * e[0] + a[5] * e[3] + a[8] * e[6];
    o[3] = a[0] * e[1] + a[3] * e[4] + a[6] * e[7];
    o[4] = a[1] * e[1] + a[4] * e[4] + a[7] * e[7];
    o[5] = a[2] * e[1] + a[5] * e[4] + a[8] * e[7];
    o[6] = a[0] * e[2] + a[3] * e[5] + a[6] * e[8];
    o[7] = a[1] * e[2] + a[4] * e[5] + a[7] * e[8];
    o[8] = a[2] * e[2] + a[5] * e[5] + a[8] * e[8];
  }

  wake() {
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  applyImpulse(ix, iy, iz, px, py, pz) {
    if (this.invMass === 0) return;
    this.wake();
    this.linearVelocity.x += ix * this.invMass;
    this.linearVelocity.y += iy * this.invMass;
    this.linearVelocity.z += iz * this.invMass;
    if (px !== undefined) {
      const rx = px - this.position.x, ry = py - this.position.y, rz = pz - this.position.z;
      const tx = ry * iz - rz * iy;
      const ty = rz * ix - rx * iz;
      const tz = rx * iy - ry * ix;
      const w = this.invInertiaWorld.elements;
      this.angularVelocity.x += w[0] * tx + w[3] * ty + w[6] * tz;
      this.angularVelocity.y += w[1] * tx + w[4] * ty + w[7] * tz;
      this.angularVelocity.z += w[2] * tx + w[5] * ty + w[8] * tz;
    }
  }
}

const _tmpMat4 = new THREE.Matrix4();
function _mat4FromQuat(q) {
  return _tmpMat4.makeRotationFromQuaternion(q);
}

function buildProbes(body) {
  if (body.shape === 'sphere') {
    return new Float32Array([0, 0, 0, body.radius]);
  }
  if (body.shape === 'capsule') {
    const h = body.halfHeight;
    return new Float32Array([0, -h, 0, body.radius, 0, h, 0, body.radius, 0, 0, 0, body.radius]);
  }
  // 박스: 코너 8개, 각각 작은 구 — 반지름은 박스의 실질 비율(엡실론 아님).
  // 접촉 검출 밴드와 CCD 서브스텝 크기를 결정한다.
  const { hx, hy, hz } = body;
  const r = Math.max(0.006, Math.min(hx, hy, hz) * 0.35);
  const p = new Float32Array(8 * 4);
  let k = 0;
  for (let sx = -1; sx <= 1; sx += 2)
    for (let sy = -1; sy <= 1; sy += 2)
      for (let sz = -1; sz <= 1; sz += 2) {
        p[k++] = sx * (hx - r);
        p[k++] = sy * (hy - r);
        p[k++] = sz * (hz - r);
        p[k++] = r;
      }
  return p;
}

/* ------------------------------------------------------------------ */

const MAX_CONTACTS = 48;
const SLOP = 0.0015;
/** 잔여 침투 중 스텝당 위치로 제거하는 비율 */
const BAUMGARTE = 0.4;
const REST_THRESHOLD = 0.55; // 이하 접근 속도에서 반발 억제, m/s
const SLEEP_LINEAR = 0.035;
const SLEEP_ANGULAR = 0.22;
const SLEEP_TIME = 0.45;

export class RigidBodyWorld {
  constructor(staticWorld, gravity = -20.6) {
    this.world = staticWorld;
    this.gravity = gravity;
    this.bodies = [];
    this.maxBodies = 256;
    this.solverIterations = 4;

    // 접촉 스크래치
    this._cn = new Float32Array(MAX_CONTACTS * 3);
    this._cp = new Float32Array(MAX_CONTACTS * 3);
    this._cd = new Float32Array(MAX_CONTACTS);
    this._cf = new Float32Array(MAX_CONTACTS); // 마찰 계수
    this._ce = new Float32Array(MAX_CONTACTS); // 반발 계수
    this._cs = new Int32Array(MAX_CONTACTS); // 표면 인덱스
    this._hit = makeHitRecord();
    this._awake = 0;
    this._contactsLastStep = 0;
  }

  add(body) {
    if (this.bodies.length >= this.maxBodies) {
      // 가장 오래 잠든 강체를 재활용해 예산을 넘기지 않는다
      let victim = -1;
      let bestAge = -1;
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        if (b.sleeping && b.age > bestAge) { bestAge = b.age; victim = i; }
      }
      if (victim < 0) victim = 0;
      this.remove(this.bodies[victim]);
    }
    body.updateInertiaWorld();
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    body.active = false;
    return body;
  }

  clear() {
    this.bodies.length = 0;
  }

  /** 폭발 반경 안의 모든 강체를 깨워 밀어낸다 */
  applyRadialImpulse(x, y, z, radius, strength) {
    const r2 = radius * radius;
    for (const b of this.bodies) {
      const dx = b.position.x - x, dy = b.position.y - y, dz = b.position.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const falloff = 1 - d / radius;
      const j = strength * falloff * falloff * b.mass;
      b.applyImpulse(
        (dx / d) * j, (dy / d) * j + j * 0.35, (dz / d) * j,
        b.position.x + dx * 0.05, b.position.y + dy * 0.05, b.position.z + dz * 0.05
      );
    }
  }

  step(dt) {
    const bodies = this.bodies;
    this._awake = 0;
    this._contactsLastStep = 0;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      b.age += dt;
      if (b.age > b.lifetime) {
        this.remove(b);
        continue;
      }
      if (b.sleeping) continue;
      this._awake++;
      this._stepBody(b, dt);
    }
  }

  _stepBody(b, dt) {
    b.prevPosition.copy(b.position);
    b.prevQuaternion.copy(b.quaternion);
    if (b._impactCooldown > 0) b._impactCooldown -= dt;

    // --- 속도 적분 ---
    b.linearVelocity.y += this.gravity * b.gravityScale * dt;
    const ld = Math.exp(-b.linearDamping * dt);
    const ad = Math.exp(-b.angularDamping * dt);
    b.linearVelocity.multiplyScalar(ld);
    b.angularVelocity.multiplyScalar(ad);

    // --- 연속(CCD) 패스 --------------------------------------------------
    // 스텝당 이동이 프로브 반지름을 넘으면 이산 솔버는 벽을 못 본다.
    // 코어 구를 먼저 스윕해 충돌 시점에서 스텝을 자른다.
    const speed = b.linearVelocity.length();
    const travel = speed * dt;
    const probeR = b.probeRadius;
    if (b.ccd && travel > probeR && this.world.triCount > 0) {
      const inv = 1 / speed;
      const dx = b.linearVelocity.x * inv;
      const dy = b.linearVelocity.y * inv;
      const dz = b.linearVelocity.z * inv;
      const hit = this._hit;
      const core = Math.max(probeR, b.minExtent * 0.9);
      if (this.world.sweepCapsule(
        b.position.x, b.position.y, b.position.z,
        b.position.x, b.position.y, b.position.z,
        core, dx, dy, dz, travel, b.mask, hit
      )) {
        const adv = Math.max(0, hit.t - 0.002);
        b.position.x += dx * adv;
        b.position.y += dy * adv;
        b.position.z += dz * adv;
        // 반발 + 접선 마찰로 반사하고, 미끄럼 일부를 스핀으로 바꿔
        // 스케이트 대신 구르게 한다.
        const sp = SURFACE_PROPS[this.world.surface[hit.tri]] ?? SURFACE_PROPS[0];
        const e = Math.sqrt(Math.max(0, b.restitution * sp.restitution));
        const mu = Math.sqrt(Math.max(0, b.friction * sp.friction));
        const vn = b.linearVelocity.x * hit.nx + b.linearVelocity.y * hit.ny + b.linearVelocity.z * hit.nz;
        if (vn < 0) {
          const tx = b.linearVelocity.x - hit.nx * vn;
          const ty = b.linearVelocity.y - hit.ny * vn;
          const tz = b.linearVelocity.z - hit.nz * vn;
          const keep = Math.max(0, 1 - mu * 0.5);
          b.linearVelocity.set(
            tx * keep - hit.nx * vn * e,
            ty * keep - hit.ny * vn * e,
            tz * keep - hit.nz * vn * e
          );
          const spin = Math.min(30, -vn * 2.5);
          b.angularVelocity.x += (hit.ny * tz - hit.nz * ty) * spin * 0.05;
          b.angularVelocity.y += (hit.nz * tx - hit.nx * tz) * spin * 0.05;
          b.angularVelocity.z += (hit.nx * ty - hit.ny * tx) * spin * 0.05;
        }
        if (b.onImpact && b._impactCooldown <= 0 && -vn > 1.0) {
          b._impactCooldown = 0.08;
          b.onImpact(b, hit.px, hit.py, hit.pz, hit.nx, hit.ny, hit.nz, -vn, this.world.surface[hit.tri]);
        }
        integrateQuaternion(b.quaternion, b.angularVelocity, dt);
        b.updateInertiaWorld();
        this._sleepCheck(b, dt);
        return;
      }
    }

    // --- 이산 서브스텝 -----------------------------------------------------
    const maxStepDist = Math.max(0.004, probeR * 0.75);
    let sub = b.ccd ? Math.ceil(travel / maxStepDist) : 1;
    if (!(sub >= 1)) sub = 1;
    if (sub > 12) sub = 12;
    const h = dt / sub;

    for (let s = 0; s < sub; s++) {
      b.position.addScaledVector(b.linearVelocity, h);
      integrateQuaternion(b.quaternion, b.angularVelocity, h);
      b.updateInertiaWorld();
      const n = this._collect(b);
      if (n > 0) {
        this._contactsLastStep += n;
        this._solve(b, n, h);
      }
    }

    this._sleepCheck(b, dt);
  }

  _sleepCheck(b, dt) {
    let lin = b.linearVelocity.lengthSq();
    let ang = b.angularVelocity.lengthSq();
    // 각속도 허용치는 크기에 비례 — 9cm 조각의 0.3 rad/s는 표면 속도 1cm/s
    const angLimit = SLEEP_ANGULAR / Math.max(0.12, b.boundRadius);
    // 마이크로 마찰: 이 정도로 느린 강체는 접촉이 떠받치는 중이고
    // 남은 지터는 솔버 노이즈다. 흘려보내 슬립에 빨리 도달시킨다.
    if (lin < 9 * SLEEP_LINEAR * SLEEP_LINEAR && ang < 9 * angLimit * angLimit) {
      b.linearVelocity.multiplyScalar(0.9);
      b.angularVelocity.multiplyScalar(0.85);
      lin = b.linearVelocity.lengthSq();
      ang = b.angularVelocity.lengthSq();
    }
    if (lin < SLEEP_LINEAR * SLEEP_LINEAR && ang < angLimit * angLimit) {
      b.sleepTimer += dt;
      if (b.sleepTimer > SLEEP_TIME) {
        b.sleeping = true;
        b.linearVelocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        b.onSleep?.(b);
      }
    } else {
      b.sleepTimer = 0;
    }
  }

  /** 접촉 생성: 프로브 vs 정적 삼각형 */
  _collect(b) {
    const w = this.world;
    if (w.triCount === 0) return 0;
    const R = b.boundRadius + 0.05;
    const n = w.queryAabb(
      b.position.x - R, b.position.y - R, b.position.z - R,
      b.position.x + R, b.position.y + R, b.position.z + R,
      b.mask
    );
    if (n === 0) return 0;
    const cand = w.candidates;
    const pos = w.pos;
    const nrm = w.nrm;
    const probes = b.probes;
    const q = b.quaternion;
    let count = 0;

    for (let pi = 0; pi < b.probeCount && count < MAX_CONTACTS; pi++) {
      const lx = probes[pi * 4], ly = probes[pi * 4 + 1], lz = probes[pi * 4 + 2];
      const pr = probes[pi * 4 + 3];
      const wx = rotX(q, lx, ly, lz) + b.position.x;
      const wy = rotY(q, lx, ly, lz) + b.position.y;
      const wz = rotZ(q, lx, ly, lz) + b.position.z;

      let deepest = 0;
      let dnx = 0, dny = 0, dnz = 0, dpx = 0, dpy = 0, dpz = 0, dtri = -1;

      for (let c = 0; c < n; c++) {
        const tri = cand[c];
        const p = tri * 9;
        closestPtPointTriangle(
          wx, wy, wz,
          pos[p], pos[p + 1], pos[p + 2],
          pos[p + 3], pos[p + 4], pos[p + 5],
          pos[p + 6], pos[p + 7], pos[p + 8],
          _cpt
        );
        const ex = wx - _cpt.bx, ey = wy - _cpt.by, ez = wz - _cpt.bz;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= pr * pr) continue;
        const d = Math.sqrt(d2);
        let nx, ny, nz;
        if (d > 1e-6) {
          nx = ex / d; ny = ey / d; nz = ez / d;
          if (nx * nrm[tri * 3] + ny * nrm[tri * 3 + 1] + nz * nrm[tri * 3 + 2] < 0.02) {
            nx = nrm[tri * 3]; ny = nrm[tri * 3 + 1]; nz = nrm[tri * 3 + 2];
          }
        } else {
          nx = nrm[tri * 3]; ny = nrm[tri * 3 + 1]; nz = nrm[tri * 3 + 2];
        }
        const depth = pr - d;
        if (depth > deepest) {
          deepest = depth;
          dnx = nx; dny = ny; dnz = nz;
          dpx = _cpt.bx; dpy = _cpt.by; dpz = _cpt.bz;
          dtri = tri;
        }
      }

      if (dtri >= 0) {
        const k = count++;
        this._cn[k * 3] = dnx; this._cn[k * 3 + 1] = dny; this._cn[k * 3 + 2] = dnz;
        this._cp[k * 3] = dpx; this._cp[k * 3 + 1] = dpy; this._cp[k * 3 + 2] = dpz;
        this._cd[k] = deepest;
        const sp = SURFACE_PROPS[w.surface[dtri]] ?? SURFACE_PROPS[0];
        this._cf[k] = Math.sqrt(Math.max(0, b.friction * sp.friction));
        this._ce[k] = Math.sqrt(Math.max(0, b.restitution * sp.restitution));
        this._cs[k] = w.surface[dtri];
      }
    }
    return count;
  }

  _solve(b, n, dt) {
    const iw = b.invInertiaWorld.elements;
    const im = b.invMass;
    let maxApproach = 0;
    let impactIdx = -1;

    // 사전 패스: 임팩트 보고용 최대 접근 속도
    for (let k = 0; k < n; k++) {
      const nx = this._cn[k * 3], ny = this._cn[k * 3 + 1], nz = this._cn[k * 3 + 2];
      const rx = this._cp[k * 3] - b.position.x;
      const ry = this._cp[k * 3 + 1] - b.position.y;
      const rz = this._cp[k * 3 + 2] - b.position.z;
      const vx = b.linearVelocity.x + (b.angularVelocity.y * rz - b.angularVelocity.z * ry);
      const vy = b.linearVelocity.y + (b.angularVelocity.z * rx - b.angularVelocity.x * rz);
      const vz = b.linearVelocity.z + (b.angularVelocity.x * ry - b.angularVelocity.y * rx);
      const vn = vx * nx + vy * ny + vz * nz;
      if (-vn > maxApproach) { maxApproach = -vn; impactIdx = k; }
    }

    for (let iter = 0; iter < this.solverIterations; iter++) {
      for (let k = 0; k < n; k++) {
        const nx = this._cn[k * 3], ny = this._cn[k * 3 + 1], nz = this._cn[k * 3 + 2];
        const rx = this._cp[k * 3] - b.position.x;
        const ry = this._cp[k * 3 + 1] - b.position.y;
        const rz = this._cp[k * 3 + 2] - b.position.z;

        let vx = b.linearVelocity.x + (b.angularVelocity.y * rz - b.angularVelocity.z * ry);
        let vy = b.linearVelocity.y + (b.angularVelocity.z * rx - b.angularVelocity.x * rz);
        let vz = b.linearVelocity.z + (b.angularVelocity.x * ry - b.angularVelocity.y * rx);
        const vn = vx * nx + vy * ny + vz * nz;

        // n 방향 유효 질량: im + n . (Iinv (r x n)) x r
        const rnx = ry * nz - rz * ny;
        const rny = rz * nx - rx * nz;
        const rnz = rx * ny - ry * nx;
        const iax = iw[0] * rnx + iw[3] * rny + iw[6] * rnz;
        const iay = iw[1] * rnx + iw[4] * rny + iw[7] * rnz;
        const iaz = iw[2] * rnx + iw[5] * rny + iw[8] * rnz;
        const angTerm =
          (iay * rz - iaz * ry) * nx + (iaz * rx - iax * rz) * ny + (iax * ry - iay * rx) * nz;
        const kn = im + angTerm;
        if (kn <= 1e-9) continue;

        // Baumgarte 속도 바이어스는 일부러 없음: 위치 오차를 속도로 주입하면
        // 정지 강체에 잔류 속도가 남아 영원히 슬립하지 못한다.
        // 침투는 솔브 후 위치로 제거한다 — 에너지가 추가되지 않는다.
        const e = maxApproach > REST_THRESHOLD ? this._ce[k] : 0;
        let jn = (-(1 + e) * vn) / kn;
        if (jn < 0) jn = 0;
        if (jn > 0) applyImpulse(b, nx * jn, ny * jn, nz * jn, rx, ry, rz, iw);

        // --- 마찰 ---
        vx = b.linearVelocity.x + (b.angularVelocity.y * rz - b.angularVelocity.z * ry);
        vy = b.linearVelocity.y + (b.angularVelocity.z * rx - b.angularVelocity.x * rz);
        vz = b.linearVelocity.z + (b.angularVelocity.x * ry - b.angularVelocity.y * rx);
        const vnn = vx * nx + vy * ny + vz * nz;
        let tx = vx - nx * vnn, ty = vy - ny * vnn, tz = vz - nz * vnn;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-6) {
          tx /= tl; ty /= tl; tz /= tl;
          const rtx = ry * tz - rz * ty;
          const rty = rz * tx - rx * tz;
          const rtz = rx * ty - ry * tx;
          const jx = iw[0] * rtx + iw[3] * rty + iw[6] * rtz;
          const jy = iw[1] * rtx + iw[4] * rty + iw[7] * rtz;
          const jz = iw[2] * rtx + iw[5] * rty + iw[8] * rtz;
          const angT =
            (jy * rz - jz * ry) * tx + (jz * rx - jx * rz) * ty + (jx * ry - jy * rx) * tz;
          const kt = im + angT;
          if (kt > 1e-9) {
            let jt = -tl / kt;
            const maxF = this._cf[k] * jn;
            if (jt < -maxF) jt = -maxF;
            if (jt > maxF) jt = maxF;
            applyImpulse(b, tx * jt, ty * jt, tz * jt, rx, ry, rz, iw);
          }
        }
      }
    }

    // 위치 보정 — 에너지 추가 없이 잔여 침투 제거. 가장 깊은 접촉만 사용;
    // 코너의 8프로브를 합산하면 이중 계산된다.
    let deepest = 0, dk = -1;
    for (let k = 0; k < n; k++) if (this._cd[k] > deepest) { deepest = this._cd[k]; dk = k; }
    if (dk >= 0 && deepest > SLOP) {
      const push = Math.min(deepest - SLOP, 0.08) * BAUMGARTE;
      b.position.x += this._cn[dk * 3] * push;
      b.position.y += this._cn[dk * 3 + 1] * push;
      b.position.z += this._cn[dk * 3 + 2] * push;
    }

    if (impactIdx >= 0 && maxApproach > 1.0 && b._impactCooldown <= 0 && b.onImpact) {
      b._impactCooldown = 0.08;
      b.onImpact(
        b,
        this._cp[impactIdx * 3], this._cp[impactIdx * 3 + 1], this._cp[impactIdx * 3 + 2],
        this._cn[impactIdx * 3], this._cn[impactIdx * 3 + 1], this._cn[impactIdx * 3 + 2],
        maxApproach,
        this._cs[impactIdx]
      );
    }
  }

  get awakeCount() {
    return this._awake;
  }
}

function applyImpulse(b, ix, iy, iz, rx, ry, rz, iw) {
  b.linearVelocity.x += ix * b.invMass;
  b.linearVelocity.y += iy * b.invMass;
  b.linearVelocity.z += iz * b.invMass;
  const tx = ry * iz - rz * iy;
  const ty = rz * ix - rx * iz;
  const tz = rx * iy - ry * ix;
  b.angularVelocity.x += iw[0] * tx + iw[3] * ty + iw[6] * tz;
  b.angularVelocity.y += iw[1] * tx + iw[4] * ty + iw[7] * tz;
  b.angularVelocity.z += iw[2] * tx + iw[5] * ty + iw[8] * tz;
}

function integrateQuaternion(q, w, dt) {
  const wx = w.x * dt * 0.5, wy = w.y * dt * 0.5, wz = w.z * dt * 0.5;
  const x = q.x, y = q.y, z = q.z, s = q.w;
  q.x = x + (wx * s + wy * z - wz * y);
  q.y = y + (wy * s + wz * x - wx * z);
  q.z = z + (wz * s + wx * y - wy * x);
  q.w = s - (wx * x + wy * y + wz * z);
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  if (l > 1e-9) {
    const i = 1 / l;
    q.x *= i; q.y *= i; q.z *= i; q.w *= i;
  } else {
    q.set(0, 0, 0, 1);
  }
}

/* 쿼터니언으로 로컬 벡터 회전 — 성분 단위, 할당 없음 */
function rotX(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return x + q.w * tx + (q.y * tz - q.z * ty);
}
function rotY(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return y + q.w * ty + (q.z * tx - q.x * tz);
}
function rotZ(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return z + q.w * tz + (q.x * ty - q.y * tx);
}

/** closestPtPointTriangle이 b*를 쓰는 공유 레코드 */
const _cpt = { bx: 0, by: 0, bz: 0 };

export { rotX, rotY, rotZ, integrateQuaternion };
