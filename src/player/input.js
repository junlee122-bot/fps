/**
 * src/player/input.js — 플레이어 입력 상태.
 *
 * 실시간: 키보드/마우스(포인터록) 리스너가 상태를 채운다.
 * 하네스: __harness.setInput()이 override()로 같은 상태를 직접 쓴다.
 * 시뮬레이션은 이 상태 객체만 읽는다 — 입력 경로가 어디든 결과는 같다.
 */

export class PlayerInput {
  constructor() {
    this.state = {
      forward: 0,   // -1..1
      right: 0,     // -1..1
      jump: false,  // 에지 트리거 — 소비 시 해제
      sprint: false,
      crouch: false,
      fire: false,       // 좌클릭 (P2A: firecontrol이 소비)
      ads: false,        // 우클릭 홀드 — 조준
      reload: false,     // KeyR 홀드 (무기 상태머신이 멱등 처리)
      weaponSwitch: null, // 'CARBINE'|'SHOTGUN'|'DMR' 에지 — 소비 시 해제
      yaw: 0,       // 라디안. 0 = -Z(북) 방향
      pitch: 0,     // 라디아. +위
    };
    this._keys = new Set();
    this._sensitivity = 0.0023;
    this._attached = false;
    this._dom = null;

    this._onKeyDown = (e) => { this._keys.add(e.code); this._applyKeys(); };
    this._onKeyUp = (e) => { this._keys.delete(e.code); this._applyKeys(); };
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this._dom) return;
      this.state.yaw -= e.movementX * this._sensitivity;
      this.state.pitch -= e.movementY * this._sensitivity;
      const lim = Math.PI / 2 - 0.01;
      if (this.state.pitch > lim) this.state.pitch = lim;
      if (this.state.pitch < -lim) this.state.pitch = -lim;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this.state.fire = true;
      if (e.button === 2) this.state.ads = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.state.fire = false;
      if (e.button === 2) this.state.ads = false;
    };
    this._onContextMenu = (e) => e.preventDefault(); // 우클릭 ADS와 충돌 방지
    this._onClick = () => {
      if (document.pointerLockElement !== this._dom) this._dom.requestPointerLock();
    };
  }

  attach(dom) {
    if (this._attached) return;
    this._dom = dom;
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('mousemove', this._onMouseMove);
    addEventListener('mousedown', this._onMouseDown);
    addEventListener('mouseup', this._onMouseUp);
    dom.addEventListener('click', this._onClick);
    addEventListener('contextmenu', this._onContextMenu);
    this._attached = true;
  }

  _applyKeys() {
    const k = this._keys;
    this.state.forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    this.state.right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (k.has('Space')) this.state.jump = true;
    this.state.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    this.state.crouch = k.has('ControlLeft') || k.has('KeyC');
    this.state.reload = k.has('KeyR');
    if (k.has('Digit1')) this.state.weaponSwitch = 'CARBINE';
    else if (k.has('Digit2')) this.state.weaponSwitch = 'SHOTGUN';
    else if (k.has('Digit3')) this.state.weaponSwitch = 'DMR';
  }

  /** 무기 교체 에지 소비 — 배선(main/harness)이 처리 후 호출 */
  consumeWeaponSwitch() {
    const w = this.state.weaponSwitch;
    this.state.weaponSwitch = null;
    return w;
  }

  /** 하네스 주입 경로. 부분 상태를 병합한다 */
  override(partial) {
    Object.assign(this.state, partial);
  }

  /** 점프 에지 소비 — 이동 코드가 처리 후 호출 */
  consumeJump() {
    const j = this.state.jump;
    this.state.jump = false;
    return j;
  }

  reset() {
    this._keys.clear();
    this.state.forward = 0;
    this.state.right = 0;
    this.state.jump = false;
    this.state.sprint = false;
    this.state.crouch = false;
    this.state.fire = false;
    this.state.ads = false;
    this.state.reload = false;
    this.state.weaponSwitch = null;
    this.state.yaw = 0;
    this.state.pitch = 0;
  }
}
