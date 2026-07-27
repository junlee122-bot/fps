#!/usr/bin/env node
/**
 * tools/profile.mjs — 실플레이 프로파일러.
 *
 * 정적 카메라 벤치는 진짜 문제를 가린다 (HARNESS.md §0). 이 도구는:
 *  - realtime 모드(자유 실행 rAF 루프)에서
 *  - 실제 DPR로
 *  - 스크립트 이동·시점 전환·점프를 재생하며 (P0. 사격은 P2, AI는 P4에서 추가)
 * 프레임타임 분포(p50/p95/p99/worst)와 히치 귀속(프레임당 신규 WebGL
 * 프로그램 수, 드로우콜, 삼각형, 직전 이벤트)을 보고한다.
 *
 *   node tools/profile.mjs [--duration=30] [--dpr=2] [--runs=3]
 */

import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs } from './lib/browser.mjs';
import { VIEW } from './shots.js';

const args = parseArgs();
const DURATION = Number(args.duration ?? 30);
const DPR = Number(args.dpr ?? VIEW.dpr);
const RUNS = Number(args.runs ?? 3);
const W = Number(args.w ?? VIEW.width);
const H = Number(args.h ?? VIEW.height);
/** 워밍업 제외 프레임 (조작 인계 + 첫 섀도 캐스케이드 맞춤은 1회성 비용) */
const WARMUP_FRAMES = Number(args.warmup ?? 30);
const HITCH_MS = 50;

/** P0 게임플레이 스크립트: 이동/시점/점프 사이클. duration을 채울 때까지 반복 */
function buildScript(duration) {
  const cycle = [
    { dur: 2.0, input: { forward: 1, right: 0, sprint: true }, tag: 'sprint_north' },
    { dur: 1.0, input: { forward: 1, right: 0, sprint: false }, yawRate: 1.6, tag: 'turn_left' },
    { dur: 1.5, input: { forward: 0, right: 1 }, tag: 'strafe_right' },
    { dur: 1.2, input: { forward: 1, right: 0 }, jumpPulse: true, tag: 'jump_forward' },
    { dur: 1.0, input: { forward: 0, right: 0 }, yawRate: -3.1, tag: 'turn_around' },
    { dur: 2.0, input: { forward: 1, right: 0, sprint: true }, tag: 'sprint_back' },
    { dur: 0.8, input: { forward: 0, right: -1, crouch: true }, tag: 'crouch_strafe' },
    { dur: 0.5, input: { forward: 0, right: 0, crouch: false }, yawRate: 1.2, tag: 'idle_look' },
  ];
  const cycleDur = cycle.reduce((a, s) => a + s.dur, 0);
  const script = [];
  let t = 0;
  while (t < duration) {
    for (const seg of cycle) {
      script.push(seg);
      t += seg.dur;
      if (t >= duration) break;
    }
  }
  return script;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const server = await startServer();
const browser = await launchBrowser();
const runs = [];

for (let run = 0; run < RUNS; run++) {
  const g = await openGamePage(browser, {
    baseUrl: server.url,
    width: W,
    height: H,
    dpr: DPR,
    query: 'mode=realtime',
  });
  const bootMs = await g.page.evaluate(() => window.__harness.getBootMs());
  const internal = await g.page.evaluate(() => {
    const c = document.getElementById('game');
    const gl = c.getContext('webgl2');
    return {
      dpr: devicePixelRatio,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      megapixels: +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2),
      renderer: (() => {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })(),
    };
  });

  await g.page.evaluate(() => window.__harness.resetState());
  const script = buildScript(DURATION);
  await g.page.evaluate((s) => window.__harness.runScript(s), script);
  const stats = await g.page.evaluate(() => window.__harness.getStats());
  await g.close();

  // 인덱스 정렬: frameTimes[i]는 레코드 i ↔ i+1 사이의 간격이다.
  // 따라서 그 간격에서 일어난 컴파일 수는 programCountPerFrame[i+1] - [i]다.
  const ft = stats.frameTimes.slice(WARMUP_FRAMES);
  const progs = stats.programCountPerFrame.slice(WARMUP_FRAMES);
  const calls = stats.drawCallsPerFrame.slice(WARMUP_FRAMES);
  const tris = stats.trianglesPerFrame.slice(WARMUP_FRAMES);
  const sorted = ft.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const worst = sorted[sorted.length - 1] ?? NaN;

  const hitches = [];
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] <= HITCH_MS) continue;
    // ft[i] = 레코드 (WARMUP+i) → (WARMUP+i+1) 간격. 히치가 끝난 프레임 인덱스:
    const endFrame = i + WARMUP_FRAMES + 1;
    const lastEvent = stats.events.filter((e) => e.frame <= endFrame).at(-1)?.tag ?? 'boot';
    hitches.push({
      frame: endFrame,
      ms: +ft[i].toFixed(1),
      newPrograms: (stats.programCountPerFrame[endFrame] ?? 0) - (stats.programCountPerFrame[endFrame - 1] ?? 0),
      drawCalls: stats.drawCallsPerFrame[endFrame] ?? 0,
      triangles: stats.trianglesPerFrame[endFrame] ?? 0,
      lastEvent,
    });
  }

  runs.push({
    run: run + 1,
    bootMs: Math.round(bootMs),
    internal,
    frames: ft.length,
    frameMs: {
      p50: +p50.toFixed(2), p95: +p95.toFixed(2), p99: +p99.toFixed(2), worst: +worst.toFixed(1),
    },
    fps: {
      p50: +(1000 / p50).toFixed(1),
      p95: +(1000 / p95).toFixed(1),
      p99: +(1000 / p99).toFixed(1),
      min: +(1000 / worst).toFixed(1),
    },
    programs: {
      start: progs[0] ?? 0,
      end: progs.at(-1) ?? 0,
      compiledDuringPlay: (progs.at(-1) ?? 0) - (progs[0] ?? 0),
    },
    drawCalls: { min: Math.min(...calls), max: Math.max(...calls) },
    triangles: { min: Math.min(...tris), max: Math.max(...tris) },
    hitchCount: hitches.length,
    hitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
    errors: [],
  });
}

await browser.close();
await server.close();

const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const summary = {
  runs: RUNS,
  duration: DURATION,
  dpr: DPR,
  aggregate: {
    fps_p50_median: med(runs.map((r) => r.fps.p50)),
    fps_p95_median: med(runs.map((r) => r.fps.p95)),
    fps_p99_median: med(runs.map((r) => r.fps.p99)),
    frame_worst_max: Math.max(...runs.map((r) => r.frameMs.worst)),
    shaderCompilesDuringPlay_max: Math.max(...runs.map((r) => r.programs.compiledDuringPlay)),
    hitchCount_total: runs.reduce((a, r) => a + r.hitchCount, 0),
    bootMs_median: med(runs.map((r) => r.bootMs)),
  },
  perRun: runs,
};
console.log(JSON.stringify(summary, null, 2));
