/**
 * src/core/clock.js — 단일 시간 소스.
 *
 * 이 파일만이 performance.now()와 rAF 타임스탬프를 소비한다.
 * 어떤 서브시스템도 시간을 직접 읽지 않는다 (HARNESS.md §2-1).
 *
 * 모드:
 *  - 'realtime' : 메인 루프가 rAF 타임스탬프를 tickRealtime()으로 전달
 *  - 'fixed'    : 하네스가 tickFixed()로 프레임을 진행. 벽시계와 완전 분리
 *
 * 시뮬레이션은 clock.time / clock.dt 만 사용한다. 부팅 길이가 달라져도
 * fixed 모드의 (frame → time) 매핑은 불변이므로 캡처가 비트 동일해진다.
 */

/** fixed 모드 렌더 프레임당 dt (초) */
export const FIXED_DT = 1 / 60;
/** 물리 서브스텝 dt (초). 렌더 프레임당 정확히 2스텝 */
export const PHYSICS_DT = 1 / 120;
/** realtime 모드에서 스파이크 프레임의 dt 상한 (초) */
export const MAX_FRAME_DT = 0.1;

class Clock {
  constructor() {
    this.mode = 'realtime';
    /** 시뮬레이션 누적 시간 (초). resetState()에서 0으로 돌아간다 */
    this.time = 0;
    /** 이번 프레임 dt (초) */
    this.dt = FIXED_DT;
    /** 진행된 렌더 프레임 수 */
    this.frame = 0;
    this._lastRafSec = null;
    this._bootStartMs = performance.now();
    this._bootMs = null;
  }

  setMode(mode) {
    if (mode !== 'realtime' && mode !== 'fixed') throw new Error(`unknown clock mode: ${mode}`);
    this.mode = mode;
    this._lastRafSec = null;
  }

  /** 메인 루프 전용. rAF 콜백 타임스탬프를 받는다 */
  tickRealtime(rafTimestampMs) {
    if (this.mode !== 'realtime') throw new Error('tickRealtime called in fixed mode');
    const t = rafTimestampMs * 0.001;
    this.dt = this._lastRafSec === null ? FIXED_DT : Math.min(t - this._lastRafSec, MAX_FRAME_DT);
    if (this.dt < 0) this.dt = 0;
    this._lastRafSec = t;
    this.time += this.dt;
    this.frame++;
  }

  /** 하네스 전용. 고정 스텝 1프레임 진행 */
  tickFixed() {
    if (this.mode !== 'fixed') throw new Error('tickFixed called in realtime mode');
    this.dt = FIXED_DT;
    this.time += FIXED_DT;
    this.frame++;
  }

  /** 시뮬레이션 시간 리셋 (resetState 경로). 부팅 시각과 무관해진다 */
  resetSimTime() {
    this.time = 0;
    this.frame = 0;
    this.dt = FIXED_DT;
    this._lastRafSec = null;
  }

  /** 부팅 완료 마킹 — ready 직전에 1회 호출 */
  markBootDone() {
    if (this._bootMs === null) this._bootMs = performance.now() - this._bootStartMs;
  }

  get bootMs() {
    return this._bootMs;
  }

  /**
   * 벽시계 ms. **계측 전용** (프레임타임 측정 등 통계 기록).
   * 시뮬레이션·렌더 상태에 절대 흘러들어가면 안 된다.
   */
  wallNowMs() {
    return performance.now();
  }
}

export const clock = new Clock();
