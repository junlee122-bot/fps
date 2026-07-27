/**
 * 스윕 캡슐 캐릭터 컨트롤러 — collide and slide.
 *
 * 참조 레포(Claude of Duty)의 검증된 구현을 이식. 표면 매핑만
 * 동결 계약 어댑터로 교체했다.
 *
 * 컨트롤러는 키네마틱이다: 호출자(player/ai)가 고정 스텝마다 원하는 변위를
 * 넘기고, 여기서 정적 BVH에 대해 해석한다. 힘 적분은 하지 않는다 —
 * 속도는 호출자 소유이고 여기서는 접촉에 대해 *클립*만 한다.
 *
 * move()당 해석 순서:
 *   1. depenetrate — 이미 파고든 곳에서 밀어내기
 *   2. lift        — 지상 이동은 stepHeight만큼 먼저 들어올려 계단 디딤판이
 *                    수평 스윕에 보이지 않게 한다
 *   3. slide       — 최대 N회 스윕, 접촉 평면 스택(Quake식)으로 잔여 이동 클립
 *   4. drop        — 들어올린 만큼 + 중력 + 계단 하강 스냅만큼 내려온다.
 *                    걷기 불가 면에는 달라붙지 않는다
 *   5. ground probe — 이번 프레임의 grounded/노멀/표면 발행
 *
 * 스윕은 참 연속 테스트(StaticWorld.sweepCapsule)라 어떤 속도에서도
 * 터널링이 없다.
 */

import { makeHitRecord } from './math.js';
import { MASK, SURFACE_PROPS, surfaceName } from './surface-registry.js';

const MAX_PLANES = 5;
const SKIN = 0.008;

export class CharacterController {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = opts.id ?? 'character';
    this.owner = opts.owner ?? null;

    this.radius = opts.radius ?? 0.32;
    this.height = opts.height ?? 1.78; // 발바닥→정수리 전체 높이
    this.stepHeight = opts.stepHeight ?? 0.42;
    this.slopeLimit = opts.slopeLimit ?? 50 * (Math.PI / 180);
    this.snapDistance = opts.snapDistance ?? 0.32;
    this.mask = opts.mask ?? MASK.CHARACTER;
    this.maxIterations = opts.maxIterations ?? 5;

    /** 발 위치(캡슐 바닥) — 정본 트랜스폼 */
    this.position = { x: 0, y: 0, z: 0 };
    /** 속도는 호출자 소유. move()는 접촉에 대해 클립만 한다 */
    this.velocity = { x: 0, y: 0, z: 0 };

    this.grounded = false;
    this.wasGrounded = false;
    this.groundNormal = { x: 0, y: 1, z: 0 };
    this.groundSurface = 0;
    this.groundDistance = 0;
    this.groundObject = -1;
    this.onSteepSlope = false;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.wallNormal = { x: 0, y: 0, z: 0 };
    this.lastMoveBlocked = false;
    this.steppedUp = 0;
    /** 착지 프레임의 지면 노멀 방향 충돌 속도 */
    this.landingSpeed = 0;
    this.enabled = true;

    // 프리앨록 스크래치
    this._hit = makeHitRecord();
    this._hit2 = makeHitRecord();
    this._planes = new Float32Array(MAX_PLANES * 3);
    this._planeCount = 0;
    this._startPos = { x: 0, y: 0, z: 0 };

    if (opts.position) this.setPosition(opts.position.x, opts.position.y, opts.position.z);
  }

  get cosSlope() {
    return Math.cos(this.slopeLimit);
  }

  /** 캡슐 하단 구 중심 */
  get p0y() {
    return this.position.y + this.radius;
  }
  /** 캡슐 상단 구 중심 */
  get p1y() {
    return this.position.y + this.height - this.radius;
  }

  setPosition(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
  }

  /** 텔레포트: 접촉 상태를 지우고 도착지에서 탈침투 */
  teleport(x, y, z) {
    this.setPosition(x, y, z);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.grounded = false;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.depenetrate(8);
    this.probeGround();
  }

  /** 발을 고정한 채 캡슐 높이 변경. 천장에 막히면 false */
  setHeight(h, force = false) {
    if (h > this.height && !force && !this.canFit(h)) return false;
    this.height = h;
    return true;
  }

  /** 현재 발 위치에 높이 h 캡슐이 들어가는가 */
  canFit(h) {
    const r = this.radius;
    const p0y = this.position.y + r;
    const p1y = this.position.y + h - r;
    if (p1y < p0y) return true;
    const n = this.world.overlapCapsule(
      this.position.x, p0y, this.position.z,
      this.position.x, p1y, this.position.z,
      r - 0.01, this.mask, 0
    );
    return n === 0;
  }

  /**
   * 변위 해석. dx/dy/dz는 이번 스텝의 미터 변위(호출자가 dt 곱을 마침).
   * 실제 이동 거리를 반환.
   */
  move(dx, dy, dz) {
    if (!this.enabled) return 0;
    const st = this._startPos;
    st.x = this.position.x; st.y = this.position.y; st.z = this.position.z;
    this.wasGrounded = this.grounded;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.lastMoveBlocked = false;
    this.steppedUp = 0;

    this.depenetrate(4);

    const jumping = dy > 1e-6;
    const useStepOffset =
      this.wasGrounded && !jumping && this.stepHeight > 1e-4 &&
      (dx * dx + dz * dz) > 1e-10;

    if (!useStepOffset) {
      this._slide(dx, dy, dz);
    } else {
      // 1. 들어올리기 — 낮은 천장이면 자동으로 짧아진다
      const lift = this._sweepMove(0, this.stepHeight, 0);
      // 2. 수평
      this._slide(dx, 0, dz);
      // 3. 내려오기: 들어올린 만큼 + 이번 스텝 중력 + 계단 하강 스냅
      const want = lift + Math.max(0, -dy);
      const snap = this.snapDistance;
      const yBefore = this.position.y;
      const dropped = this._sweepDown(want + snap);
      if (dropped < 0) {
        // 발 밑에 아무것도 없음: 요청받은 만큼만 떨어진다
        this.position.y = yBefore - want;
      } else if (dropped > want && this._hit2.ny < this.cosSlope) {
        // 스냅 범위 안에 있는 게 절벽면뿐 — 달라붙지 않는다
        this.position.y = yBefore - want;
      }
      const gained = this.position.y - st.y;
      if (gained > 1e-4) this.steppedUp = gained;
    }

    this.depenetrate(3);
    this.probeGround();

    if (this.grounded && !this.wasGrounded) {
      this.landingSpeed = -Math.min(0, this.velocity.y);
    }

    return Math.hypot(this.position.x - st.x, this.position.y - st.y, this.position.z - st.z);
  }

  /** collide-and-slide 코어. 평면에 막혔으면 true */
  _slide(dx, dy, dz) {
    const planes = this._planes;
    let planeCount = 0;
    let blocked = false;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-6) break;
      const inv = 1 / dist;
      const ux = dx * inv, uy = dy * inv, uz = dz * inv;

      const hit = this._hit;
      const r = this.radius;
      const ok = this.world.sweepCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        r, ux, uy, uz, dist + SKIN, this.mask, hit
      );

      if (!ok) {
        this.position.x += dx;
        this.position.y += dy;
        this.position.z += dz;
        break;
      }

      blocked = true;
      const advance = Math.max(0, Math.min(hit.t - SKIN, dist));
      this.position.x += ux * advance;
      this.position.y += uy * advance;
      this.position.z += uz * advance;

      // 잔여 이동
      const rem = dist - advance;
      dx = ux * rem; dy = uy * rem; dz = uz * rem;

      const nx = hit.nx, ny = hit.ny, nz = hit.nz;
      this._classifyContact(nx, ny, nz, hit);
      // 주의: 가파른 접촉의 수직 성분은 일부러 유지한다. 이를 0으로 만드는
      // 흔한 핵은 모든 계단 코를 벽으로 만든다 — 하단 반구는 계단 모서리를
      // 항상 얕은 각으로 만나기 때문. 걷기 불가 면은 probeGround()가
      // grounded=false를 보고해 중력이 계속 걸리는 것으로 처리된다.

      if (planeCount >= MAX_PLANES) break;
      planes[planeCount * 3] = nx;
      planes[planeCount * 3 + 1] = ny;
      planes[planeCount * 3 + 2] = nz;
      planeCount++;

      // 지금까지 모은 모든 평면에 대해 클립. 단일 평면 사영이 다른 평면을
      // 위반하면 두 평면의 접선(crease)을 따라 미끄러진다.
      let cx = dx, cy = dy, cz = dz;
      let resolved = false;
      for (let i = 0; i < planeCount && !resolved; i++) {
        const px = planes[i * 3], py = planes[i * 3 + 1], pz = planes[i * 3 + 2];
        if (dx * px + dy * py + dz * pz >= 0) continue;
        let tx = dx, ty = dy, tz = dz;
        const into = tx * px + ty * py + tz * pz;
        tx -= px * into; ty -= py * into; tz -= pz * into;
        let violates = -1;
        for (let j = 0; j < planeCount; j++) {
          if (j === i) continue;
          const qx = planes[j * 3], qy = planes[j * 3 + 1], qz = planes[j * 3 + 2];
          if (tx * qx + ty * qy + tz * qz < 0) { violates = j; break; }
        }
        if (violates < 0) {
          cx = tx; cy = ty; cz = tz;
          resolved = true;
        } else {
          // crease: 두 평면의 교선을 따라 이동
          const qx = planes[violates * 3], qy = planes[violates * 3 + 1], qz = planes[violates * 3 + 2];
          let ex = py * qz - pz * qy;
          let ey = pz * qx - px * qz;
          let ez = px * qy - py * qx;
          const el = Math.hypot(ex, ey, ez);
          if (el < 1e-6) { cx = cy = cz = 0; resolved = true; break; }
          ex /= el; ey /= el; ez /= el;
          const along = dx * ex + dy * ey + dz * ez;
          cx = ex * along; cy = ey * along; cz = ez * along;
          // 제3의 평면이 교선 방향을 막으면 기각
          let bad = false;
          for (let j = 0; j < planeCount; j++) {
            const rx = planes[j * 3], ry = planes[j * 3 + 1], rz = planes[j * 3 + 2];
            if (cx * rx + cy * ry + cz * rz < -1e-6) { bad = true; break; }
          }
          if (bad) { cx = cy = cz = 0; }
          resolved = true;
        }
      }
      dx = cx; dy = cy; dz = cz;

      // 호출자의 속도도 같은 방식으로 클립 — 벽에 박은 속도가 살아남지 않게
      this._clipVelocity(nx, ny, nz);

      if (dx * dx + dy * dy + dz * dz < 1e-12) break;
    }
    this._planeCount = planeCount;
    this.lastMoveBlocked = blocked;
    return blocked;
  }

  _classifyContact(nx, ny, nz, hit) {
    if (ny >= this.cosSlope) {
      this.grounded = true;
      this.groundNormal.x = nx; this.groundNormal.y = ny; this.groundNormal.z = nz;
      this.groundSurface = hit.surface;
      this.groundObject = hit.object;
      this.onSteepSlope = false;
    } else if (ny < -0.5) {
      this.touchingCeiling = true;
    } else {
      this.touchingWall = true;
      this.wallNormal.x = nx; this.wallNormal.y = ny; this.wallNormal.z = nz;
      if (ny > 0.05) this.onSteepSlope = true;
    }
  }

  _clipVelocity(nx, ny, nz) {
    const v = this.velocity;
    const into = v.x * nx + v.y * ny + v.z * nz;
    if (into < 0) {
      v.x -= nx * into;
      v.y -= ny * into;
      v.z -= nz * into;
    }
  }

  /** 슬라이드 없는 단일 스윕 이동. 이동 거리 반환 */
  _sweepMove(dx, dy, dz) {
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-7) return 0;
    const inv = 1 / dist;
    const ux = dx * inv, uy = dy * inv, uz = dz * inv;
    const hit = this._hit2;
    const ok = this.world.sweepCapsule(
      this.position.x, this.p0y, this.position.z,
      this.position.x, this.p1y, this.position.z,
      this.radius, ux, uy, uz, dist + SKIN, this.mask, hit
    );
    const adv = ok ? Math.max(0, Math.min(hit.t - SKIN, dist)) : dist;
    this.position.x += ux * adv;
    this.position.y += uy * adv;
    this.position.z += uz * adv;
    return adv;
  }

  /**
   * 아래로 최대 dist 스윕. 낙하 거리, 히트 없으면 -1(제자리 유지).
   * radiusScale은 트레이스용 캡슐 축소 — 계단 코에 걸리지 않고
   * 디딤판에 안착하도록 스텝업 드롭은 가는 프로브를 쓴다.
   */
  _sweepDown(dist, radiusScale = 1) {
    const hit = this._hit2;
    const r = this.radius * radiusScale;
    const ok = this.world.sweepCapsule(
      this.position.x, this.position.y + r, this.position.z,
      this.position.x, this.position.y + this.height - r, this.position.z,
      r, 0, -1, 0, dist + SKIN, this.mask, hit
    );
    if (!ok) return -1;
    const adv = Math.max(0, Math.min(hit.t - SKIN, dist));
    this.position.y -= adv;
    return adv;
  }

  /** 현재 겹쳐 있는 모든 것에서 캡슐을 밀어낸다 */
  depenetrate(iterations = 4) {
    const w = this.world;
    let moved = 0;
    for (let it = 0; it < iterations; it++) {
      const n = w.overlapCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        this.radius, this.mask, 0
      );
      if (n === 0) break;
      const c = w.contacts;
      // 노멀별 최대 푸시를 누적 — 합산하면 테셀레이션된 벽이 캡슐을
      // 맵 반대편으로 사출한다.
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i < n; i++) {
        const d = c.depth[i];
        if (d <= 1e-5) continue;
        const nx = c.nx[i], ny = c.ny[i], nz = c.nz[i];
        const already = px * nx + py * ny + pz * nz;
        const extra = d - already;
        if (extra > 0) {
          px += nx * extra;
          py += ny * extra;
          pz += nz * extra;
        }
      }
      const l = Math.hypot(px, py, pz);
      if (l < 1e-5) break;
      // 나쁜 접촉 집합이 캐릭터를 날리지 못하게 감쇠
      const maxPush = 0.25;
      const s = l > maxPush ? maxPush / l : 1;
      this.position.x += px * s;
      this.position.y += py * s;
      this.position.z += pz * s;
      moved += l * s;
      if (l < 1e-4) break;
    }
    return moved;
  }

  /**
   * grounded 상태를 발행하는 짧은 하향 스윕.
   *
   * 트레이스 두 번은 의도다. 가는 것(반지름 60%)은 볼록 모서리를 무시하고
   * 바닥을 찾는다 — 없으면 계단 코를 오르는 중에 공중으로 보고된다.
   * 넓은 것은 좁은 보 위에 서 있을 때의 폴백이다.
   */
  probeGround() {
    const probe = 0.06;
    const cos = this.cosSlope;
    const hit = this._hit;
    const w = this.world;

    const thin = w.sweepCapsule(
      this.position.x, this.position.y + this.radius * 0.6, this.position.z,
      this.position.x, this.position.y + this.height - this.radius * 0.6, this.position.z,
      this.radius * 0.6, 0, -1, 0, probe, this.mask, hit
    );

    let found = thin && hit.ny >= cos;
    if (!found) {
      const wide = w.sweepCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        this.radius * 0.98, 0, -1, 0, probe, this.mask, hit
      );
      // 의미 있는 상향 성분이 있으면 지지된 것 — 계단 코가 그렇다
      found = wide && hit.ny > 0.15;
    }

    if (found) {
      this.grounded = true;
      this.groundNormal.x = hit.nx;
      this.groundNormal.y = hit.ny;
      this.groundNormal.z = hit.nz;
      this.groundSurface = hit.surface;
      this.groundObject = hit.object;
      this.groundDistance = hit.t;
      this.onSteepSlope = hit.ny < cos;
    } else {
      this.grounded = false;
      this.groundDistance = hit.hit ? hit.t : Infinity;
      this.onSteepSlope = hit.hit && hit.ny > 0.05 && hit.ny < cos;
      if (hit.hit) {
        this.groundNormal.x = hit.nx;
        this.groundNormal.y = hit.ny;
        this.groundNormal.z = hit.nz;
        this.groundSurface = hit.surface;
      }
    }

    // 천장 프로브 — 이동 상태머신이 점프 취소에 쓴다
    const ch = this._hit2;
    this.touchingCeiling = this.world.sweepCapsule(
      this.position.x, this.p0y, this.position.z,
      this.position.x, this.p1y, this.position.z,
      this.radius * 0.98, 0, 1, 0, 0.06, this.mask, ch
    ) && ch.ny < -0.4;

    return this.grounded;
  }

  /** 밟고 있는 표면의 마찰 계수 */
  get groundFriction() {
    return SURFACE_PROPS[this.groundSurface]?.friction ?? 0.9;
  }

  get groundSurfaceName() {
    return surfaceName(this.groundSurface);
  }

  /** 이 위치에 설 수 있는가 — AI 스폰·맨틀 사전 검사용 */
  checkCapsule(x, y, z, height = this.height) {
    return (
      this.world.overlapCapsule(
        x, y + this.radius, z,
        x, y + height - this.radius, z,
        this.radius - 0.005, this.mask, 0
      ) === 0
    );
  }
}
