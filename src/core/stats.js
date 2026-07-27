/**
 * src/core/stats.js — 프레임 통계 기록기.
 *
 * 매 렌더 후 record() 1회. 벽시계는 clock.wallNowMs()로만 읽는다
 * (계측 전용 — 시뮬레이션에 흘러들지 않는다).
 *
 * programCountPerFrame은 **누적** WebGL 프로그램 수다. "그 프레임의 신규
 * 컴파일 수"는 도구가 인접 차분으로 계산한다 (CONTRACT-NOTES C).
 */

import { clock } from './clock.js';

const MAX_SAMPLES = 200000;

export class StatsRecorder {
  constructor(renderer) {
    this.renderer = renderer;
    this.reset();
  }

  reset() {
    this.frameTimes = [];          // ms, 벽시계 프레임 간격
    this.programCountPerFrame = [];
    this.drawCallsPerFrame = [];
    this.trianglesPerFrame = [];
    this.events = [];              // {frame, tag}
    this._lastWall = null;
    this._frame = 0;
  }

  /** 렌더 직후 호출 */
  record() {
    if (this.frameTimes.length >= MAX_SAMPLES) return;
    const now = clock.wallNowMs();
    if (this._lastWall !== null) this.frameTimes.push(now - this._lastWall);
    this._lastWall = now;
    const info = this.renderer.info;
    this.programCountPerFrame.push(info.programs?.length ?? 0);
    this.drawCallsPerFrame.push(info.render.calls);
    this.trianglesPerFrame.push(info.render.triangles);
    this._frame++;
  }

  markEvent(tag) {
    this.events.push({ frame: this._frame, tag });
  }

  /** HARNESS.md §2 getStats 계약 + 확장 필드 */
  snapshot() {
    const last = this.trianglesPerFrame.length - 1;
    return {
      frameTimes: this.frameTimes.slice(),
      programCountPerFrame: this.programCountPerFrame.slice(),
      triangles: last >= 0 ? this.trianglesPerFrame[last] : 0,
      drawCalls: last >= 0 ? this.drawCallsPerFrame[last] : 0,
      // 확장 (CONTRACT-NOTES B2)
      drawCallsPerFrame: this.drawCallsPerFrame.slice(),
      trianglesPerFrame: this.trianglesPerFrame.slice(),
      events: this.events.slice(),
      bootMs: clock.bootMs,
    };
  }
}
