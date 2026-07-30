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
    /**
     * P3 지표 의미 정정 (P1.5 선례 — CONTRACT-NOTES P3 판정):
     * 멀티패스 파이프라인에서 renderer.info는 그림자 3캐스케이드·GTAO 프리패스·
     * 후처리 쿼드까지 전 패스 합산이다. drawCalls/trisFrame 예산(900/250k)은
     * "단일 씬 패스가 제출하는 지오메트리"로 정의됐으므로 게이트는 scene 계열
     * (파이프라인 패스 분해)로 걸고, 합산은 정보용으로 병기한다.
     */
    this.drawCallsPerFrame = [];       // 전 패스 합산 (정보용)
    this.trianglesPerFrame = [];       // 전 패스 합산 (정보용)
    this.drawCallsScenePerFrame = [];  // 단일 씬 패스 (게이트) — 미계측 -1
    this.trianglesScenePerFrame = []; // 단일 씬 패스 (게이트) — 미계측 -1
    /**
     * 프레임당 CPU 시간(ms), 2성분. 미계측 프레임 -1.
     * - sim    : 프레임 시작 → render() 직전 (입력·물리·플레이어·씬 갱신). 항상 환경 무관
     * - submit : render() 호출 소요. 실 GPU에선 제출 비용 ≈ CPU, 소프트웨어 GL에선
     *            라스터에 블록되어 오염됨 (profile이 환경 감지로 게이트 성분을 선택)
     */
    this.cpuSimMsPerFrame = [];
    this.cpuSubmitMsPerFrame = [];
    /** §7 overdraw_estimate — (파티클+데칼 화면 투영 면적)/화면 픽셀. 미계측 -1 */
    this.overdrawPerFrame = [];
    this.particlesPerFrame = [];
    this.decalsPerFrame = [];
    this.events = [];              // {frame, tag}
    this._lastWall = null;
    this._frame = 0;
  }

  /** 렌더 직후 호출 */
  record(cpuSimMs = -1, cpuSubmitMs = -1, overdraw = -1, particlesActive = -1, decalsUsed = -1, sceneCalls = -1, sceneTris = -1) {
    if (this.programCountPerFrame.length >= MAX_SAMPLES) return;
    const now = clock.wallNowMs();
    if (this._lastWall !== null) this.frameTimes.push(now - this._lastWall);
    this._lastWall = now;
    const info = this.renderer.info;
    this.programCountPerFrame.push(info.programs?.length ?? 0);
    this.drawCallsPerFrame.push(info.render.calls);
    this.trianglesPerFrame.push(info.render.triangles);
    this.drawCallsScenePerFrame.push(sceneCalls);
    this.trianglesScenePerFrame.push(sceneTris);
    this.cpuSimMsPerFrame.push(cpuSimMs);
    this.cpuSubmitMsPerFrame.push(cpuSubmitMs);
    this.overdrawPerFrame.push(overdraw);
    this.particlesPerFrame.push(particlesActive);
    this.decalsPerFrame.push(decalsUsed);
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
      drawCallsScenePerFrame: this.drawCallsScenePerFrame.slice(),
      trianglesScenePerFrame: this.trianglesScenePerFrame.slice(),
      cpuSimMsPerFrame: this.cpuSimMsPerFrame.slice(),
      cpuSubmitMsPerFrame: this.cpuSubmitMsPerFrame.slice(),
      overdrawPerFrame: this.overdrawPerFrame.slice(),
      particlesPerFrame: this.particlesPerFrame.slice(),
      decalsPerFrame: this.decalsPerFrame.slice(),
      events: this.events.slice(),
      bootMs: clock.bootMs,
    };
  }
}
