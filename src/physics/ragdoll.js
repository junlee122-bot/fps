/**
 * src/physics/ragdoll.js — PBD 래그돌 (P4B 설계서 §6, 단계 5). physics 소유, 시뮬 파일.
 *
 * - three 무의존: import 는 `math.js`·`surface-registry.js`(→ core/surfaces.js)뿐이다(§1-1 physics-sim
 *   허용 집합). `StaticWorld` 는 인스턴스로 주입받는다(bvh.js 는 three 를 import 하므로 import 하지 않는다).
 * - `RigidBody` 미사용 — 강체 목록·축출·전역 id 와 무관하다(§6-1).
 * - 슬롯 SoA 는 생성자에서 전부 할당한다. activate·step 은 할당하지 않는다
 *   (브로드페이즈 후보가 스크래치 용량을 넘을 때만 키운다 — `scratchGrows` 로 보고).
 * - 결정성: 슬롯 0..N−1, 데이터 순서 고정 구속, 접촉은 (깊이 내림차순, 삼각형 번호 오름차순),
 *   충격 최근접 뼈 동률은 낮은 인덱스. 난수 없음.
 *
 * 숫자 표기(014-C): 아래 상수는 모두 **구현 파라미터**이고 게이트 임계가 아니다. 설계서 §6-3 이 준 값이며
 * 판정에 쓰이지 않는다(슬립은 보고만, §6-5).
 */

import { makeClosest, makeHitRecord, segTriangleClosest } from './math.js';
import { MASK, SURFACE_PROPS } from './surface-registry.js';

/** 입자 수·막대·버팀대 수 — 설계서 §6-2 구조 상수 (limits.js `RAGDOLL_PARTICLES` 와 같은 값; 3a 병합 뒤 주입 대조) */
export const RAGDOLL_PARTICLES = 16;
export const RAGDOLL_RODS = 15;
export const RAGDOLL_BRACES = 6;

/** 구현 파라미터 (§6-3) */
export const RAGDOLL_PARAMS = Object.freeze({
  damping: 0.02,            // Verlet 속도 감쇠 (1 − 0.02)
  vMax: 25,                 // m/s, 서브스텝 변위 상한 = vMax·dt
  iterations: 8,            // 구속 반복
  braceStiffness: 0.9,      // 버팀대 강성
  ccdFrac: 0.5,             // |x − xPrev| > ccdFrac·r 이면 입자 CCD
  ccdSkin: 0.001,           // CCD TOI − 1 mm
  maxApplied: 0.25,         // 뼈당 반복당 접촉 밀어내기 상한 (character.js depenetrate 와 같은 값)
  sleepDisp: 2e-4,          // m, 서브스텝 최대 변위
  sleepSteps: 60,           // 위 조건 연속 서브스텝 → sleeping
  forceSleepSteps: 720,     // 활성화 뒤 서브스텝 → 강제 슬립(forced = 1)
  broadMargin: 0.05,        // 브로드페이즈 AABB 여유(m)
});

const N = RAGDOLL_PARTICLES;
const N3 = N * 3;
const FNV_PRIME = 0x01000193;
const FNV_BASIS_A = 0x811c9dc5;
const FNV_BASIS_B = 0x050c5d1f; // 두 번째 기저 — 64비트 표기를 위한 독립 32비트 해시

/* ------------------------------------------------------------------ */
/* 템플릿                                                              */
/* ------------------------------------------------------------------ */

/**
 * 컴파일된 래그돌 템플릿 검증·동결 사본.
 *
 * 형식(모두 데이터 순서 고정):
 *   parent      Int8Array(16)   골격 트리, 루트(골반) = −1, parent[i] < i
 *   massFrac    Float64Array(16) 질량 분율(합 1) — 진짜 질량은 activate 의 massKg 가 곱한다(재검토 #10)
 *   radius      Float64Array(16) 입자 반지름(m)
 *   rods        Int16Array(15·2) 막대(뼈) 입자 쌍 — 충돌 캡슐 선분이기도 하다
 *   rodRadius   Float64Array(15) 뼈 충돌체 반지름
 *   braces      Int16Array(6·2)  버팀대 입자 쌍
 *   limits      Int16Array(k·3) [a, b, c] — b 에서의 내각 범위
 *   limitAngle  Float64Array(k·2) [θmin, θmax] 라디안 → 코사인 법칙으로 |ac| ∈ [dmin, dmax]
 *   hinges      Int16Array(h·8) [a, j, c, upFrom, upTo, left, right, sign]
 *                 n = sign·normalize(cross(x[upTo] − x[upFrom], x[right] − x[left])),
 *                 (x_j − (x_a + x_c)/2)·n ≥ 0 (무릎·팔꿈치 반공간)
 */
export function compileRagdollTemplate(t) {
  const fail = (m) => { throw new Error(`ragdoll template: ${m}`); };
  if (!t || typeof t !== 'object') fail('not an object');
  const parent = Int8Array.from(t.parent ?? []);
  const massFrac = Float64Array.from(t.massFrac ?? []);
  const radius = Float64Array.from(t.radius ?? []);
  const rods = Int16Array.from(t.rods ?? []);
  const rodRadius = Float64Array.from(t.rodRadius ?? []);
  const braces = Int16Array.from(t.braces ?? []);
  const limits = Int16Array.from(t.limits ?? []);
  const limitAngle = Float64Array.from(t.limitAngle ?? []);
  const hinges = Int16Array.from(t.hinges ?? []);

  if (parent.length !== N || massFrac.length !== N || radius.length !== N) fail(`particle arrays must have ${N} entries`);
  if (rods.length !== RAGDOLL_RODS * 2 || rodRadius.length !== RAGDOLL_RODS) fail(`rods must be ${RAGDOLL_RODS}`);
  if (braces.length !== RAGDOLL_BRACES * 2) fail(`braces must be ${RAGDOLL_BRACES}`);
  if (limits.length % 3 !== 0 || limitAngle.length !== (limits.length / 3) * 2) fail('limits/limitAngle shape');
  if (hinges.length % 8 !== 0) fail('hinges shape');
  if (parent[0] !== -1) fail('particle 0 (pelvis) must be the root');
  for (let i = 1; i < N; i++) if (!(parent[i] >= 0 && parent[i] < i)) fail(`parent[${i}] must be in [0, ${i})`);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    if (!(massFrac[i] > 0)) fail(`massFrac[${i}] must be > 0`);
    if (!(radius[i] > 0)) fail(`radius[${i}] must be > 0`);
    sum += massFrac[i];
  }
  if (Math.abs(sum - 1) > 1e-9) fail(`massFrac must sum to 1 (got ${sum})`);
  const idxOk = (arr) => arr.every((v) => v >= 0 && v < N);
  if (!idxOk(rods) || !idxOk(braces) || !idxOk(limits)) fail('particle index out of range');
  for (let h = 0; h < hinges.length; h += 8) {
    for (let k = 0; k < 7; k++) if (!(hinges[h + k] >= 0 && hinges[h + k] < N)) fail('hinge index out of range');
    if (hinges[h + 7] !== 1 && hinges[h + 7] !== -1) fail('hinge sign must be ±1');
  }
  for (let r = 0; r < RAGDOLL_RODS; r++) if (!(rodRadius[r] > 0)) fail(`rodRadius[${r}] must be > 0`);
  for (let k = 0; k < limitAngle.length; k += 2) {
    const a0 = limitAngle[k], a1 = limitAngle[k + 1];
    if (!(a0 >= 0 && a0 <= a1 && a1 <= Math.PI)) fail('limit angles must satisfy 0 ≤ θmin ≤ θmax ≤ π');
  }
  // 골격 트리의 모든 부모–자식 쌍이 막대여야 한다(초기 클램프가 막대 위에서 성립)
  for (let i = 1; i < N; i++) {
    let found = false;
    for (let r = 0; r < RAGDOLL_RODS; r++) {
      const a = rods[r * 2], b = rods[r * 2 + 1];
      if ((a === parent[i] && b === i) || (b === parent[i] && a === i)) { found = true; break; }
    }
    if (!found) fail(`tree edge ${parent[i]}→${i} is not a rod`);
  }
  const out = { parent, massFrac, radius, rods, rodRadius, braces, limits, limitAngle, hinges };
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ */
/* 월드                                                                */
/* ------------------------------------------------------------------ */

export class RagdollWorld {
  /**
   * @param staticWorld 주입된 StaticWorld (queryAabb·raycast·sweepCapsule·pos·nrm·surface)
   * @param opts { slots = 6, gravity = −20.6, mask = MASK.CHARACTER }
   */
  constructor(staticWorld, opts = {}) {
    this.world = staticWorld;
    this.slots = opts.slots ?? 6;
    this.gravity = opts.gravity ?? -20.6;
    this.mask = opts.mask ?? MASK.CHARACTER;
    const S = this.slots;

    this.x = new Float64Array(S * N3);
    this.xPrev = new Float64Array(S * N3);
    this.invMass = new Float64Array(S * N);
    this.radius = new Float64Array(S * N);
    this.restRod = new Float64Array(S * RAGDOLL_RODS);
    this.restBrace = new Float64Array(S * RAGDOLL_BRACES);
    this.active = new Uint8Array(S);
    this.sleeping = new Uint8Array(S);
    this.forced = new Uint8Array(S);
    this.still = new Int32Array(S);
    this.steps = new Int32Array(S);
    this.tmpl = new Array(S).fill(null);
    this.limitD = new Array(S).fill(null); // 슬롯별 [dmin, dmax] — 템플릿 등록 시 최대 크기로 할당
    this.limitCap = 0;

    // 슬롯별 후보 삼각형 스크래치 (§6-3 ②: queryAabb 결과를 즉시 복사)
    this.cand = [];
    for (let s = 0; s < S; s++) this.cand.push(new Int32Array(1024));
    this.candN = new Int32Array(S);
    this.scratchGrows = 0;

    // 뼈 접촉 스크래치 (뼈 하나씩 처리하므로 공유)
    this._cCap = 1024;
    this._cDepth = new Float64Array(this._cCap);
    this._cNx = new Float64Array(this._cCap);
    this._cNy = new Float64Array(this._cCap);
    this._cNz = new Float64Array(this._cCap);
    this._cS = new Float64Array(this._cCap);
    this._cTri = new Int32Array(this._cCap);
    this._cOrd = new Int32Array(this._cCap);
    // 이번 서브스텝 마찰용: 입자별 접촉 노멀·표면 (−1 = 접촉 없음)
    this._fN = new Float64Array(N3);
    this._fSurf = new Int32Array(N);
    // 이전 서브스텝 뼈 중점 (관통 노멀 부호용)
    this._midPrev = new Float64Array(RAGDOLL_RODS * 3);

    this._cl = makeClosest();
    this._hit = makeHitRecord();
    this.templates = new Map();
  }

  /** 부팅, 시각 리그별. 질량은 분율만(§6-1). 같은 키 재등록은 throw */
  registerTemplate(key, compiledRig) {
    if (this.templates.has(key)) throw new Error(`ragdoll: template already registered: ${key}`);
    const t = compiledRig && Object.isFrozen(compiledRig) && compiledRig.parent instanceof Int8Array
      ? compiledRig : compileRagdollTemplate(compiledRig);
    this.templates.set(key, t);
    const nl = t.limits.length / 3;
    if (nl > this.limitCap) {
      this.limitCap = nl;
      for (let s = 0; s < this.slots; s++) this.limitD[s] = new Float64Array(nl * 2);
    }
    return t;
  }

  /**
   * 사망 활성화 (§6-4 ③). 할당 0.
   * @param jointPos 길이 48 (외견 리그 관절 원점, 월드)
   * @param jointVel 길이 3(액터 속도, 전 입자 공통) 또는 48
   * @param impulseWorldPos 길이 3 또는 null
   * @param impulse 길이 3 (N·s) 또는 null
   */
  activate(slot, key, massKg, jointPos, jointVel, impulseWorldPos, impulse, dt = 1 / 120) {
    if (!(slot >= 0 && slot < this.slots)) throw new Error(`ragdoll: slot out of range: ${slot}`);
    const t = this.templates.get(key);
    if (!t) throw new Error(`ragdoll: unknown template: ${key}`);
    if (!(massKg > 0)) throw new Error(`ragdoll: massKg must be > 0 (got ${massKg})`);
    if (!jointPos || jointPos.length !== N3) throw new Error(`ragdoll: jointPos must have ${N3} entries`);
    const perVel = jointVel && jointVel.length === N3;
    if (jointVel && !perVel && jointVel.length !== 3) throw new Error('ragdoll: jointVel must have 3 or 48 entries');

    const o = slot * N3, oi = slot * N;
    const x = this.x, xp = this.xPrev;
    for (let i = 0; i < N3; i++) {
      const v = jointPos[i];
      if (!Number.isFinite(v)) throw new Error('ragdoll: non-finite jointPos');
      x[o + i] = v;
    }
    for (let i = 0; i < N; i++) {
      this.invMass[oi + i] = 1 / (t.massFrac[i] * massKg);
      this.radius[oi + i] = t.radius[i];
    }
    // 막대 길이 = 활성화 직전 뼈 길이(클램프 전, §6-2). 버팀대도 같은 시점.
    for (let r = 0; r < RAGDOLL_RODS; r++) {
      this.restRod[slot * RAGDOLL_RODS + r] = this._dist(o, t.rods[r * 2], t.rods[r * 2 + 1]);
    }
    for (let r = 0; r < RAGDOLL_BRACES; r++) {
      this.restBrace[slot * RAGDOLL_BRACES + r] = this._dist(o, t.braces[r * 2], t.braces[r * 2 + 1]);
    }
    // 거리 한계: 코사인 법칙, 다리 길이 = 활성화 직전 |ab|·|bc|
    const ld = this.limitD[slot];
    for (let k = 0, nl = t.limits.length / 3; k < nl; k++) {
      const a = t.limits[k * 3], b = t.limits[k * 3 + 1], c = t.limits[k * 3 + 2];
      const l1 = this._dist(o, a, b), l2 = this._dist(o, b, c);
      const th0 = t.limitAngle[k * 2], th1 = t.limitAngle[k * 2 + 1];
      ld[k * 2] = Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(th0)));
      ld[k * 2 + 1] = Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(th1)));
    }

    // 속도 → xPrev = x − v·dt
    for (let i = 0; i < N; i++) {
      const vx = jointVel ? (perVel ? jointVel[i * 3] : jointVel[0]) : 0;
      const vy = jointVel ? (perVel ? jointVel[i * 3 + 1] : jointVel[1]) : 0;
      const vz = jointVel ? (perVel ? jointVel[i * 3 + 2] : jointVel[2]) : 0;
      xp[o + i * 3] = x[o + i * 3] - vx * dt;
      xp[o + i * 3 + 1] = x[o + i * 3 + 1] - vy * dt;
      xp[o + i * 3 + 2] = x[o + i * 3 + 2] - vz * dt;
    }

    // 초기 클램프(검토 #17): 골반부터 부모 → 자식 순으로 raycast, 히트면 자식을 부모 + dir·max(0, t − r_child)
    const hit = this._hit;
    for (let i = 1; i < N; i++) {
      const p = o + t.parent[i] * 3, c = o + i * 3;
      const dx = x[c] - x[p], dy = x[c + 1] - x[p + 1], dz = x[c + 2] - x[p + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-12) continue;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      if (!this.world.raycast(x[p], x[p + 1], x[p + 2], ux, uy, uz, len, this.mask, hit)) continue;
      const k = Math.max(0, hit.t - this.radius[oi + i]);
      const nx = x[p] + ux * k, ny = x[p + 1] + uy * k, nz = x[p + 2] + uz * k;
      const sx = nx - x[c], sy = ny - x[c + 1], sz = nz - x[c + 2];
      x[c] = nx; x[c + 1] = ny; x[c + 2] = nz;
      xp[c] += sx; xp[c + 1] += sy; xp[c + 2] += sz;
    }

    // 충격: impulseWorldPos 최근접 뼈 선분 양끝에 (1−s, s) 가중 Δv = J·w_i/m_i (동률은 낮은 인덱스)
    if (impulse && impulseWorldPos) {
      let best = Infinity, bestR = -1, bestS = 0;
      const px = impulseWorldPos[0], py = impulseWorldPos[1], pz = impulseWorldPos[2];
      for (let r = 0; r < RAGDOLL_RODS; r++) {
        const a = o + t.rods[r * 2] * 3, b = o + t.rods[r * 2 + 1] * 3;
        const ex = x[b] - x[a], ey = x[b + 1] - x[a + 1], ez = x[b + 2] - x[a + 2];
        const ee = ex * ex + ey * ey + ez * ez;
        let s = ee > 1e-18 ? ((px - x[a]) * ex + (py - x[a + 1]) * ey + (pz - x[a + 2]) * ez) / ee : 0;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const qx = x[a] + ex * s - px, qy = x[a + 1] + ey * s - py, qz = x[a + 2] + ez * s - pz;
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < best) { best = d2; bestR = r; bestS = s; }
      }
      const ia = t.rods[bestR * 2], ib = t.rods[bestR * 2 + 1];
      this._kick(o + ia * 3, (1 - bestS) * this.invMass[oi + ia], impulse, dt);
      this._kick(o + ib * 3, bestS * this.invMass[oi + ib], impulse, dt);
    }

    this.tmpl[slot] = t;
    this.active[slot] = 1;
    this.sleeping[slot] = 0;
    this.forced[slot] = 0;
    this.still[slot] = 0;
    this.steps[slot] = 0;
  }

  _kick(p, wInv, J, dt) {
    // Δv = J·w/m → xPrev −= Δv·dt
    this.xPrev[p] -= J[0] * wInv * dt;
    this.xPrev[p + 1] -= J[1] * wInv * dt;
    this.xPrev[p + 2] -= J[2] * wInv * dt;
  }

  _dist(o, a, b) {
    const x = this.x, pa = o + a * 3, pb = o + b * 3;
    return Math.hypot(x[pb] - x[pa], x[pb + 1] - x[pa + 1], x[pb + 2] - x[pa + 2]);
  }

  /** PhysicsWorld.step 이 강체 뒤에 부른다. 슬롯 0..N−1, 깨어 있는 것만 */
  step(dt) {
    for (let s = 0; s < this.slots; s++) {
      if (!this.active[s] || this.sleeping[s]) continue;
      this._stepSlot(s, dt);
    }
  }

  _stepSlot(slot, dt) {
    const P = RAGDOLL_PARAMS;
    const t = this.tmpl[slot];
    const o = slot * N3, oi = slot * N;
    const x = this.x, xp = this.xPrev;
    const g = this.gravity * dt * dt;
    const vCap = P.vMax * dt;
    const keep = 1 - P.damping;

    // 이전 서브스텝 뼈 중점 (관통 노멀 부호)
    const mp = this._midPrev;
    for (let r = 0; r < RAGDOLL_RODS; r++) {
      const a = o + t.rods[r * 2] * 3, b = o + t.rods[r * 2 + 1] * 3;
      mp[r * 3] = (x[a] + x[b]) * 0.5;
      mp[r * 3 + 1] = (x[a + 1] + x[b + 1]) * 0.5;
      mp[r * 3 + 2] = (x[a + 2] + x[b + 2]) * 0.5;
    }

    // ① Verlet
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    let rMax = 0;
    for (let i = 0; i < N; i++) {
      const p = o + i * 3;
      let vx = (x[p] - xp[p]) * keep, vy = (x[p + 1] - xp[p + 1]) * keep, vz = (x[p + 2] - xp[p + 2]) * keep;
      const vl = Math.hypot(vx, vy, vz);
      if (vl > vCap) { const k = vCap / vl; vx *= k; vy *= k; vz *= k; }
      xp[p] = x[p]; xp[p + 1] = x[p + 1]; xp[p + 2] = x[p + 2];
      x[p] += vx; x[p + 1] += vy + g; x[p + 2] += vz;
      const r = this.radius[oi + i];
      if (r > rMax) rMax = r;
      minx = Math.min(minx, x[p], xp[p]); maxx = Math.max(maxx, x[p], xp[p]);
      miny = Math.min(miny, x[p + 1], xp[p + 1]); maxy = Math.max(maxy, x[p + 1], xp[p + 1]);
      minz = Math.min(minz, x[p + 2], xp[p + 2]); maxz = Math.max(maxz, x[p + 2], xp[p + 2]);
    }
    for (let r = 0; r < RAGDOLL_RODS; r++) if (t.rodRadius[r] > rMax) rMax = t.rodRadius[r];

    // ② 브로드페이즈 1회 → 슬롯 스크래치로 즉시 복사 (공유 _cand 재진입 오염 방지)
    const m = rMax + P.broadMargin;
    const w = this.world;
    const n = w.queryAabb(minx - m, miny - m, minz - m, maxx + m, maxy + m, maxz + m, this.mask);
    let cand = this.cand[slot];
    if (n > cand.length) {
      let cap = cand.length;
      while (cap < n) cap *= 2;
      this.cand[slot] = cand = new Int32Array(cap);
      this.scratchGrows++;
    }
    const src = w.candidates;
    for (let k = 0; k < n; k++) cand[k] = src[k];
    this.candN[slot] = n;

    // ③ 입자 CCD
    const hit = this._hit;
    for (let i = 0; i < N; i++) {
      const p = o + i * 3;
      const dx = x[p] - xp[p], dy = x[p + 1] - xp[p + 1], dz = x[p + 2] - xp[p + 2];
      const len = Math.hypot(dx, dy, dz);
      const r = this.radius[oi + i];
      if (len <= P.ccdFrac * r) continue;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      if (w.sweepCapsule(xp[p], xp[p + 1], xp[p + 2], xp[p], xp[p + 1], xp[p + 2], r, ux, uy, uz, len, this.mask, hit)) {
        const adv = Math.max(0, hit.t - P.ccdSkin);
        x[p] = xp[p] + ux * adv; x[p + 1] = xp[p + 1] + uy * adv; x[p + 2] = xp[p + 2] + uz * adv;
      }
    }

    // ④ 반복: 막대 → 버팀대 → 한계 → 경첩 → 충돌
    this._fSurf.fill(-1);
    for (let it = 0; it < P.iterations; it++) {
      for (let r = 0; r < RAGDOLL_RODS; r++) {
        this._distance(o, oi, t.rods[r * 2], t.rods[r * 2 + 1], this.restRod[slot * RAGDOLL_RODS + r], 1);
      }
      for (let r = 0; r < RAGDOLL_BRACES; r++) {
        this._distance(o, oi, t.braces[r * 2], t.braces[r * 2 + 1], this.restBrace[slot * RAGDOLL_BRACES + r], P.braceStiffness);
      }
      const ld = this.limitD[slot];
      for (let k = 0, nl = t.limits.length / 3; k < nl; k++) {
        const a = t.limits[k * 3], c = t.limits[k * 3 + 2];
        const d = this._dist(o, a, c);
        if (d < ld[k * 2]) this._distance(o, oi, a, c, ld[k * 2], 1);
        else if (d > ld[k * 2 + 1]) this._distance(o, oi, a, c, ld[k * 2 + 1], 1);
      }
      for (let h = 0; h < t.hinges.length; h += 8) this._hinge(o, oi, t.hinges, h);
      this._collide(slot, o, it === P.iterations - 1);
    }

    // ⑥ 마찰 (1 − μ): 마지막 반복에서 접촉한 입자의 접선 변위를 깎는다. 반발 0.
    // ⑤(중심 비교차 클램프)보다 먼저 한다 — 클램프가 서브스텝의 마지막 위치 변경이어야
    // "매 스텝 중심 비교차"가 구성으로 성립한다(설계서 §6-3 순서 ⑤→⑥ 에서 바꾼 점, 보고).
    const fN = this._fN, fS = this._fSurf;
    for (let i = 0; i < N; i++) {
      const surf = fS[i];
      if (surf < 0) continue;
      const mu = (SURFACE_PROPS[surf] ?? SURFACE_PROPS[0]).friction;
      const p = o + i * 3;
      const nx = fN[i * 3], ny = fN[i * 3 + 1], nz = fN[i * 3 + 2];
      const dx = x[p] - xp[p], dy = x[p + 1] - xp[p + 1], dz = x[p + 2] - xp[p + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      const tx = dx - nx * dn, ty = dy - ny * dn, tz = dz - nz * dn;
      x[p] = xp[p] + nx * dn + tx * (1 - mu);
      x[p + 1] = xp[p + 1] + ny * dn + ty * (1 - mu);
      x[p + 2] = xp[p + 2] + nz * dn + tz * (1 - mu);
    }

    // ⑤ 중심 비교차 클램프: raycast(xPrev → x), 히트면 x = xPrev + dir·max(0, t − r)
    let maxDisp = 0;
    for (let i = 0; i < N; i++) {
      const p = o + i * 3;
      const dx = x[p] - xp[p], dy = x[p + 1] - xp[p + 1], dz = x[p + 2] - xp[p + 2];
      let len = Math.hypot(dx, dy, dz);
      if (len > 1e-12) {
        const ux = dx / len, uy = dy / len, uz = dz / len;
        if (w.raycast(xp[p], xp[p + 1], xp[p + 2], ux, uy, uz, len, this.mask, hit)) {
          const k = Math.max(0, hit.t - this.radius[oi + i]);
          x[p] = xp[p] + ux * k; x[p + 1] = xp[p + 1] + uy * k; x[p + 2] = xp[p + 2] + uz * k;
          len = k;
        }
      }
      if (len > maxDisp) maxDisp = len;
    }

    // ⑦ 슬립 (구현 파라미터, 판정 아님). ⑧ 슬립 진입 스텝도 위치는 이미 기록됨(입자 → 뼈는 postPhysics 가 읽는다)
    this.steps[slot]++;
    this.still[slot] = maxDisp < P.sleepDisp ? this.still[slot] + 1 : 0;
    if (this.still[slot] >= P.sleepSteps) this.sleeping[slot] = 1;
    if (this.steps[slot] >= P.forceSleepSteps && !this.sleeping[slot]) {
      this.sleeping[slot] = 1;
      this.forced[slot] = 1;
    }
  }

  /** 질량 가중 거리 구속 (stiffness ∈ (0, 1]) */
  _distance(o, oi, a, b, rest, stiffness) {
    const x = this.x;
    const pa = o + a * 3, pb = o + b * 3;
    const wa = this.invMass[oi + a], wb = this.invMass[oi + b];
    const W = wa + wb;
    if (W <= 0) return;
    const dx = x[pb] - x[pa], dy = x[pb + 1] - x[pa + 1], dz = x[pb + 2] - x[pa + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-12) return;
    const k = ((d - rest) / (d * W)) * stiffness;
    x[pa] += dx * k * wa; x[pa + 1] += dy * k * wa; x[pa + 2] += dz * k * wa;
    x[pb] -= dx * k * wb; x[pb + 1] -= dy * k * wb; x[pb + 2] -= dz * k * wb;
  }

  /** 경첩 반공간 (x_j − (x_a + x_c)/2)·n ≥ 0 */
  _hinge(o, oi, H, h) {
    const x = this.x;
    const a = H[h], j = H[h + 1], c = H[h + 2];
    const u0 = o + H[h + 3] * 3, u1 = o + H[h + 4] * 3, l = o + H[h + 5] * 3, r = o + H[h + 6] * 3;
    const ux = x[u1] - x[u0], uy = x[u1 + 1] - x[u0 + 1], uz = x[u1 + 2] - x[u0 + 2];
    const rx = x[r] - x[l], ry = x[r + 1] - x[l + 1], rz = x[r + 2] - x[l + 2];
    let nx = uy * rz - uz * ry, ny = uz * rx - ux * rz, nz = ux * ry - uy * rx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) return; // 축 퇴화 — 결정적으로 건너뜀
    const sg = H[h + 7] / nl;
    nx *= sg; ny *= sg; nz *= sg;
    const pa = o + a * 3, pj = o + j * 3, pc = o + c * 3;
    const C = (x[pj] - (x[pa] + x[pc]) * 0.5) * nx
      + (x[pj + 1] - (x[pa + 1] + x[pc + 1]) * 0.5) * ny
      + (x[pj + 2] - (x[pa + 2] + x[pc + 2]) * 0.5) * nz;
    if (C >= 0) return;
    const wa = this.invMass[oi + a], wj = this.invMass[oi + j], wc = this.invMass[oi + c];
    const den = wj + 0.25 * wa + 0.25 * wc;
    if (den <= 0) return;
    const lam = -C / den;
    x[pj] += nx * lam * wj; x[pj + 1] += ny * lam * wj; x[pj + 2] += nz * lam * wj;
    const ka = -0.5 * lam * wa, kc = -0.5 * lam * wc;
    x[pa] += nx * ka; x[pa + 1] += ny * ka; x[pa + 2] += nz * ka;
    x[pc] += nx * kc; x[pc + 1] += ny * kc; x[pc + 2] += nz * kc;
  }

  /**
   * 뼈 캡슐–삼각형 접촉 축약 (§6-3 ④). 뼈마다 접촉을 (깊이 내림차순, 삼각형 오름차순)으로 정렬하고
   * character.js depenetrate 의 already/extra 누적, |applied| ≤ maxApplied, 양끝 분배 w = 1/((1−s)² + s²).
   */
  _collide(slot, o, recordFriction) {
    const t = this.tmpl[slot];
    const x = this.x;
    const w = this.world;
    const pos = w.pos, nrm = w.nrm, ta = w._taabb;
    const cand = this.cand[slot], nc = this.candN[slot];
    const cl = this._cl;
    const mp = this._midPrev;
    for (let r = 0; r < RAGDOLL_RODS; r++) {
      const ia = t.rods[r * 2], ib = t.rods[r * 2 + 1];
      const pa = o + ia * 3, pb = o + ib * 3;
      const rad = t.rodRadius[r];
      const ax = x[pa], ay = x[pa + 1], az = x[pa + 2], bx = x[pb], by = x[pb + 1], bz = x[pb + 2];
      const lox = Math.min(ax, bx) - rad, loy = Math.min(ay, by) - rad, loz = Math.min(az, bz) - rad;
      const hix = Math.max(ax, bx) + rad, hiy = Math.max(ay, by) + rad, hiz = Math.max(az, bz) + rad;
      let k = 0;
      for (let c = 0; c < nc; c++) {
        const tri = cand[c];
        const tb = tri * 6;
        if (ta[tb] > hix || ta[tb + 3] < lox || ta[tb + 1] > hiy || ta[tb + 4] < loy || ta[tb + 2] > hiz || ta[tb + 5] < loz) continue;
        const q = tri * 9;
        const d2 = segTriangleClosest(ax, ay, az, bx, by, bz,
          pos[q], pos[q + 1], pos[q + 2], pos[q + 3], pos[q + 4], pos[q + 5], pos[q + 6], pos[q + 7], pos[q + 8], cl);
        if (d2 >= rad * rad) continue;
        const d = Math.sqrt(d2);
        let nx, ny, nz;
        if (d > 1e-9) {
          nx = (cl.ax - cl.bx) / d; ny = (cl.ay - cl.by) / d; nz = (cl.az - cl.bz) / d;
        } else {
          // 관통: 면 노멀을 '이전 서브스텝 뼈 중점 쪽' 부호로
          nx = nrm[tri * 3]; ny = nrm[tri * 3 + 1]; nz = nrm[tri * 3 + 2];
          const side = (mp[r * 3] - cl.bx) * nx + (mp[r * 3 + 1] - cl.by) * ny + (mp[r * 3 + 2] - cl.bz) * nz;
          if (side < 0) { nx = -nx; ny = -ny; nz = -nz; }
        }
        if (k >= this._cCap) this._growContacts();
        this._cDepth[k] = rad - d;
        this._cNx[k] = nx; this._cNy[k] = ny; this._cNz[k] = nz;
        this._cS[k] = cl.s;
        this._cTri[k] = tri;
        this._cOrd[k] = k;
        k++;
      }
      if (k === 0) continue;
      // 정렬: 깊이 내림차순, 삼각형 오름차순 (삽입 정렬 — 할당 0, 결정적)
      const ord = this._cOrd, dep = this._cDepth, tr = this._cTri;
      for (let i = 1; i < k; i++) {
        const v = ord[i];
        let j = i - 1;
        while (j >= 0) {
          const u = ord[j];
          if (dep[u] > dep[v] || (dep[u] === dep[v] && tr[u] < tr[v])) break;
          ord[j + 1] = u;
          j--;
        }
        ord[j + 1] = v;
      }
      let px = 0, py = 0, pz = 0, sAcc = 0, wAcc = 0;
      for (let i = 0; i < k; i++) {
        const c = ord[i];
        const nx = this._cNx[c], ny = this._cNy[c], nz = this._cNz[c];
        const already = px * nx + py * ny + pz * nz;
        const extra = dep[c] - already;
        if (extra > 0) {
          px += nx * extra; py += ny * extra; pz += nz * extra;
          sAcc += this._cS[c] * extra; wAcc += extra;
        }
      }
      const l = Math.hypot(px, py, pz);
      if (l < 1e-12) continue;
      const sc = l > RAGDOLL_PARAMS.maxApplied ? RAGDOLL_PARAMS.maxApplied / l : 1;
      px *= sc; py *= sc; pz *= sc;
      // 적용점 = 접촉 s 의 깊이 가중 평균
      const s = wAcc > 0 ? sAcc / wAcc : 0.5;
      const wd = 1 / ((1 - s) * (1 - s) + s * s);
      const fa = (1 - s) * wd, fb = s * wd;
      x[pa] += px * fa; x[pa + 1] += py * fa; x[pa + 2] += pz * fa;
      x[pb] += px * fb; x[pb + 1] += py * fb; x[pb + 2] += pz * fb;
      if (recordFriction) {
        // 마찰용 접촉: 가장 깊은 접촉의 표면, 밀어낸 방향(정규화). 입자당 처음 기록만(뼈 순서 고정 → 결정적)
        const surf = w.surface[tr[ord[0]]];
        const inv = 1 / (l * sc);
        this._recordFriction(ia, surf, px * inv, py * inv, pz * inv);
        this._recordFriction(ib, surf, px * inv, py * inv, pz * inv);
      }
    }
  }

  _recordFriction(i, surf, nx, ny, nz) {
    if (this._fSurf[i] >= 0) return;
    this._fSurf[i] = surf;
    this._fN[i * 3] = nx; this._fN[i * 3 + 1] = ny; this._fN[i * 3 + 2] = nz;
  }

  _growContacts() {
    const cap = this._cCap * 2;
    const g = (A, T) => { const b = new T(cap); b.set(A); return b; };
    this._cDepth = g(this._cDepth, Float64Array);
    this._cNx = g(this._cNx, Float64Array);
    this._cNy = g(this._cNy, Float64Array);
    this._cNz = g(this._cNz, Float64Array);
    this._cS = g(this._cS, Float64Array);
    this._cTri = g(this._cTri, Int32Array);
    this._cOrd = g(this._cOrd, Int32Array);
    this._cCap = cap;
    this.scratchGrows++;
  }

  /** 입자 위치를 out(길이 ≥ 48)에 쓴다. 비활성 슬롯은 0 */
  particles(slot, out) {
    if (!this.active[slot]) return 0;
    const o = slot * N3;
    for (let i = 0; i < N3; i++) out[i] = this.x[o + i];
    return N;
  }

  state(slot) {
    return {
      active: this.active[slot] === 1,
      sleeping: this.sleeping[slot] === 1,
      forced: this.forced[slot] === 1,
      steps: this.steps[slot],
      hash: this.active[slot] ? this._hashSlots(slot, slot + 1) : null,
    };
  }

  /** 슬립 해제. 서브스텝 카운터·강제 표시도 새로 센다(설계서에 정의 없음 — 구현 선택, 보고) */
  wake(slot) {
    if (!this.active[slot]) return;
    this.sleeping[slot] = 0;
    this.forced[slot] = 0;
    this.still[slot] = 0;
    this.steps[slot] = 0;
  }

  /** 활성 슬롯의 평문 사본 (보고·디버그) */
  snapshot() {
    const slots = [];
    for (let s = 0; s < this.slots; s++) {
      if (!this.active[s]) continue;
      slots.push({
        slot: s,
        sleeping: this.sleeping[s] === 1,
        forced: this.forced[s] === 1,
        steps: this.steps[s],
        x: Array.from(this.x.subarray(s * N3, (s + 1) * N3)),
      });
    }
    return { slots, hash: this.hash() };
  }

  /**
   * 최종 자세 해시 (§6-5): FNV-1a 32 × 2 기저(64비트 표기).
   * 대상은 활성 슬롯마다 [slot, sleeping, forced, steps](Int32 LE)와 Float64 입자 바이트(플랫폼 바이트 순서 — x86/ARM LE).
   */
  hash() {
    return this._hashSlots(0, this.slots);
  }

  _hashSlots(s0, s1) {
    let ha = FNV_BASIS_A, hb = FNV_BASIS_B;
    const feed = (byte) => {
      ha = Math.imul(ha ^ byte, FNV_PRIME);
      hb = Math.imul(hb ^ byte, FNV_PRIME);
    };
    const feedI32 = (v) => { for (let k = 0; k < 4; k++) feed((v >>> (k * 8)) & 0xff); };
    const bytes = new Uint8Array(this.x.buffer);
    for (let s = s0; s < s1; s++) {
      if (!this.active[s]) continue;
      feedI32(s); feedI32(this.sleeping[s]); feedI32(this.forced[s]); feedI32(this.steps[s]);
      const b0 = s * N3 * 8;
      for (let i = b0; i < b0 + N3 * 8; i++) feed(bytes[i]);
    }
    return (ha >>> 0).toString(16).padStart(8, '0') + (hb >>> 0).toString(16).padStart(8, '0');
  }

  /** 전 슬롯 비활성·버퍼 0 (resetState ⑤a) */
  reset() {
    this.x.fill(0); this.xPrev.fill(0);
    this.invMass.fill(0); this.radius.fill(0);
    this.restRod.fill(0); this.restBrace.fill(0);
    this.active.fill(0); this.sleeping.fill(0); this.forced.fill(0);
    this.still.fill(0); this.steps.fill(0);
    this.candN.fill(0);
    for (let s = 0; s < this.slots; s++) { this.tmpl[s] = null; this.limitD[s]?.fill(0); }
  }

  /** 활성 슬롯 수 */
  activeCount() {
    let n = 0;
    for (let s = 0; s < this.slots; s++) n += this.active[s];
    return n;
  }
}
