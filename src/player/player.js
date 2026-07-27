/**
 * src/player/player.js — 이동 상태머신 (P0: 걷기/달리기/앉기/점프).
 *
 * 속도는 여기가 소유하고, 충돌 해석은 physics의 CharacterController가 한다.
 * 슬라이드/맨틀/린은 이후 패스. 카메라 필(뷰밥 등)도 이후 — P0 카메라는
 * 눈 위치 + yaw/pitch 그대로다 (픽셀 결정성에 유리).
 *
 * 모든 수치는 명명 상수 (금지 사항: "임시" 매직 넘버).
 */

const WALK_SPEED = 4.2;        // m/s
const SPRINT_SPEED = 6.7;      // m/s
const CROUCH_SPEED = 2.2;      // m/s
const GROUND_RESPONSE = 12;    // 1/s — 목표 속도로의 지수 접근율 (평형점 = 목표)
const AIR_ACCEL = 9;           // m/s²
const GROUND_FRICTION = 9.5;   // 1/s — 무입력 시 지수 감속 계수
const GRAVITY = 20.6;          // m/s² (rigidbody 월드와 동일 값)
const JUMP_SPEED = 6.9;        // m/s → 최고 도약 ~1.15m
const TERMINAL_FALL = 38;      // m/s
const STAND_HEIGHT = 1.78;     // m
const CROUCH_HEIGHT = 1.22;    // m
const EYE_OFFSET = 0.14;       // 정수리 아래 눈 위치, m
const SPAWN = Object.freeze({ x: 0, y: 0.05, z: 24, yaw: 0, pitch: 0 });

export class Player {
  constructor(physics, input) {
    this.input = input;
    this.controller = physics.createCharacter({
      id: 'player',
      radius: 0.34,
      height: STAND_HEIGHT,
      stepHeight: 0.42,
      position: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    });
    this.crouched = false;
    /** 'ground' | 'air' — P0 상태머신 */
    this.state = 'ground';
    this.reset();
  }

  reset() {
    const c = this.controller;
    c.height = STAND_HEIGHT;
    this.crouched = false;
    this.state = 'ground';
    c.velocity.x = c.velocity.y = c.velocity.z = 0;
    c.teleport(SPAWN.x, SPAWN.y, SPAWN.z);
    this.input.override({ yaw: SPAWN.yaw, pitch: SPAWN.pitch, forward: 0, right: 0, jump: false, sprint: false, crouch: false, fire: false });
  }

  /** 고정 스텝 갱신. dt는 PHYSICS_DT */
  update(dt) {
    const c = this.controller;
    const s = this.input.state;
    const v = c.velocity;

    // --- 앉기/서기 ---
    if (s.crouch && !this.crouched) {
      c.setHeight(CROUCH_HEIGHT, true);
      this.crouched = true;
    } else if (!s.crouch && this.crouched) {
      if (c.setHeight(STAND_HEIGHT)) this.crouched = false;
    }

    // --- 희망 이동 방향 (yaw 평면) ---
    const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
    // yaw=0 → 전방 -Z
    let wx = -sinY * s.forward + cosY * s.right;
    let wz = -cosY * s.forward - sinY * s.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const targetSpeed = this.crouched ? CROUCH_SPEED : s.sprint ? SPRINT_SPEED : WALK_SPEED;

    if (c.grounded) {
      this.state = 'ground';
      const mu = Math.max(0.3, c.groundFriction);
      if (wl > 1e-6) {
        // 입력 있음: 목표 속도 벡터로 지수 접근 — 평형점이 정확히 목표 속도다
        const k = 1 - Math.exp(-GROUND_RESPONSE * mu * dt);
        v.x += (wx * targetSpeed - v.x) * k;
        v.z += (wz * targetSpeed - v.z) * k;
      } else {
        // 무입력: 마찰 감속 (프레임레이트 독립 지수 감쇠)
        const fr = Math.exp(-GROUND_FRICTION * mu * dt);
        v.x *= fr;
        v.z *= fr;
      }
      // 수평 속도 상한 (경사 슬라이드 등 외부 요인 대비)
      const hs = Math.hypot(v.x, v.z);
      if (hs > targetSpeed * 1.05) {
        v.x *= targetSpeed * 1.05 / hs;
        v.z *= targetSpeed * 1.05 / hs;
      }
      // 점프
      if (this.input.consumeJump() && !this.crouched) {
        v.y = JUMP_SPEED;
        this.state = 'air';
      } else if (v.y < 0) {
        v.y = -0.5; // 지면 유지용 소량 하향
      }
    } else {
      this.state = 'air';
      this.input.consumeJump(); // 공중 점프 입력은 버린다 (선입력 버퍼는 이후 패스)
      // 공중 제어
      v.x += wx * AIR_ACCEL * dt;
      v.z += wz * AIR_ACCEL * dt;
      const hs = Math.hypot(v.x, v.z);
      if (hs > SPRINT_SPEED) {
        v.x *= SPRINT_SPEED / hs;
        v.z *= SPRINT_SPEED / hs;
      }
    }

    // 중력
    v.y -= GRAVITY * dt;
    if (v.y < -TERMINAL_FALL) v.y = -TERMINAL_FALL;

    c.move(v.x * dt, v.y * dt, v.z * dt);

    if (c.grounded && v.y < 0) v.y = Math.max(v.y, -0.5);
  }

  /** 카메라에 눈 트랜스폼 기록 (하네스 샷 오버라이드 시 호출 생략) */
  applyCamera(camera) {
    const c = this.controller;
    const s = this.input.state;
    camera.position.set(
      c.position.x,
      c.position.y + c.height - EYE_OFFSET,
      c.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = s.yaw;
    camera.rotation.x = s.pitch;
    camera.rotation.z = 0;
  }

  get eyeState() {
    const c = this.controller;
    const s = this.input.state;
    return {
      pos: [c.position.x, c.position.y, c.position.z],
      vel: [c.velocity.x, c.velocity.y, c.velocity.z],
      yaw: s.yaw,
      pitch: s.pitch,
      grounded: c.grounded,
      groundSurface: c.groundSurfaceName,
      state: this.state,
      crouched: this.crouched,
      height: c.height,
    };
  }
}
