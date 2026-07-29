/**
 * src/weapons/weapon.js — 무기 상태머신 (P2A).
 *
 * 정체성은 표면 관계(§2-1 표 = params.js의 k)가 소유한다. 이 파일은
 * 연사·장전·ADS·산포·반동 같은 조작감 수치만 소유한다.
 *
 * 결정성: 시간은 update(dt) 누적만 사용(클록 직접 호출 금지),
 * 난수는 core/rng.js 명명 스트림만 사용. resetState → reset()이
 * 모든 타이머·탄약·반동을 부팅 상태로 되돌린다 (스트림은 하네스가
 * resetAllStreams로 되돌린다).
 */

import { rngStream } from '../core/rng.js';
import { WEAPONS } from './params.js';

const DEG = Math.PI / 180;

/** 조작감 수치 (P2A 소유 — 계약 수치 아님) */
export const HANDLING = Object.freeze({
  CARBINE: Object.freeze({
    fireIntervalS: 60 / 700,   // 700 rpm 자동
    auto: true,
    magazine: 30,
    reloadS: 2.2,
    adsInS: 0.25, adsOutS: 0.20,
    spreadHipDeg: 1.4, spreadAdsDeg: 0.18,
    recoilPitchDeg: 0.55, recoilYawDeg: 0.22, recoilRecoverPerS: 6.5,
    camKickPitch: 0.9, camKickYaw: 0.28,   // 카메라 스프링 속도 임펄스 rad/s (P2B §8)
    adsMoveMul: 0.72,
  }),
  SHOTGUN: Object.freeze({
    fireIntervalS: 60 / 70,    // 펌프 70 rpm
    auto: false,
    magazine: 6,
    reloadS: 0.62,             // 셸 1발당 (관형 탄창 — 중단 가능)
    reloadPerShell: true,
    adsInS: 0.30, adsOutS: 0.22,
    spreadHipDeg: 3.5, spreadAdsDeg: 2.6, // 산포 원뿔 — 정체성: 면적 파괴
    recoilPitchDeg: 2.6, recoilYawDeg: 0.8, recoilRecoverPerS: 4.0,
    camKickPitch: 2.4, camKickYaw: 0.7,
    adsMoveMul: 0.70,
  }),
  DMR: Object.freeze({
    fireIntervalS: 60 / 240,   // 반자동 240 rpm
    auto: false,
    magazine: 15,
    reloadS: 2.6,
    adsInS: 0.35, adsOutS: 0.26,
    spreadHipDeg: 2.2, spreadAdsDeg: 0.05,
    recoilPitchDeg: 1.7, recoilYawDeg: 0.5, recoilRecoverPerS: 4.5,
    camKickPitch: 1.7, camKickYaw: 0.5,
    adsMoveMul: 0.55,          // §2-2: 근접 기동성 페널티
  }),
});

export const WEAPON_ORDER = Object.freeze(['CARBINE', 'SHOTGUN', 'DMR']);

export class Weapon {
  constructor(id) {
    this.id = id;
    this.params = WEAPONS[id];     // k · energy · pellets (계약)
    this.handling = HANDLING[id];  // 조작감 (P2A)
    if (!this.params || !this.handling) throw new Error(`unknown weapon: ${id}`);
    this.reset();
  }

  /**
   * 난수는 매번 rngStream으로 가져온다 — resetAllStreams()가 맵을 비우는
   * 방식이라, 생성자에서 클로저를 캐시하면 resetState 후에도 이전 수열이
   * 이어져 결정성이 깨진다 (스트림 캐시 금지 규칙).
   */
  _rand() {
    return rngStream(`weapon:${this.id}`)();
  }

  reset() {
    this.ammo = this.handling.magazine;
    this.cooldown = 0;         // 다음 발사까지 남은 s
    this.reloading = false;
    this.reloadRemainS = 0;
    this.adsBlend = 0;         // 0=힙, 1=ADS (뷰모델·산포 보간)
    this.adsHeld = false;
    this.recoilPitch = 0;      // 누적 반동 (라디안) — 회복 감쇠
    this.recoilYaw = 0;
    this.triggerHeld = false;
    this._triggerEdge = false;
  }

  get adsMoveMul() {
    return 1 + (this.handling.adsMoveMul - 1) * this.adsBlend;
  }

  get spreadDeg() {
    const h = this.handling;
    return h.spreadHipDeg + (h.spreadAdsDeg - h.spreadHipDeg) * this.adsBlend;
  }

  /** 입력 반영 + 타이머 진행. 발사 가능 시점이면 true 반환(발사는 firecontrol 소관) */
  update(dt, { trigger, ads, reload }) {
    const h = this.handling;

    // ADS 블렌드
    this.adsHeld = !!ads;
    const rate = ads ? dt / h.adsInS : -dt / h.adsOutS;
    this.adsBlend = Math.min(1, Math.max(0, this.adsBlend + rate));

    // 반동 회복 (지수 감쇠)
    const rec = Math.exp(-h.recoilRecoverPerS * dt);
    this.recoilPitch *= rec;
    this.recoilYaw *= rec;

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    // 장전 진행
    if (this.reloading) {
      this.reloadRemainS -= dt;
      if (this.reloadRemainS <= 0) {
        if (h.reloadPerShell) {
          this.ammo++;
          if (this.ammo < h.magazine && !trigger) {
            this.reloadRemainS += h.reloadS; // 다음 셸
          } else {
            this.reloading = false;          // 만재 또는 발사 의사로 중단
          }
        } else {
          this.ammo = h.magazine;
          this.reloading = false;
        }
      }
    } else if (reload && this.ammo < h.magazine) {
      this.reloading = true;
      this.reloadRemainS = h.reloadS;
    }

    // 트리거 에지/자동
    const edge = trigger && !this.triggerHeld;
    this.triggerHeld = !!trigger;
    const wantsFire = h.auto ? trigger : edge;

    if (!wantsFire || this.cooldown > 0 || this.reloading || this.ammo <= 0) return false;
    return true;
  }

  /** 발사 확정 — 탄약·쿨다운·반동 적용. 산포 각도 목록(라디안 편차 쌍) 반환 */
  commitFire() {
    const h = this.handling;
    this.ammo--;
    this.cooldown = h.fireIntervalS;
    this.recoilPitch += h.recoilPitchDeg * DEG;
    this.recoilYaw += (this._rand() * 2 - 1) * h.recoilYawDeg * DEG;

    const n = this.params.pellets;
    const spread = this.spreadDeg * DEG;
    const out = [];
    for (let i = 0; i < n; i++) {
      // 균일 원판 산포 (시드 스트림 — 결정적)
      const a = this._rand() * Math.PI * 2;
      const r = Math.sqrt(this._rand()) * spread;
      out.push({ dYaw: Math.cos(a) * r, dPitch: Math.sin(a) * r });
    }
    return out;
  }

  get reloadDurationMs() {
    const h = this.handling;
    return Math.round((h.reloadPerShell ? h.reloadS * (h.magazine - this.ammo) : h.reloadS) * 1000);
  }

  snapshot() {
    return {
      id: this.id,
      ammo: this.ammo,
      reloading: this.reloading,
      adsBlend: +this.adsBlend.toFixed(4),
      cooldown: +this.cooldown.toFixed(4),
    };
  }
}
