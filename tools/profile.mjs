#!/usr/bin/env node
/**
 * tools/profile.mjs — 실플레이 프로파일러.
 *
 * [PATCH-001-C] 기본값 = 계약 조건 (--duration 30 --runs 3 --dpr 2).
 * 더 약한 조건은 명시 플래그로만 가능하며 `NON-CONTRACT MEASUREMENT` 배너가 붙는다.
 *
 * [P1-BRIEF 0-3] 출력을 두 계층으로 분리한다:
 *  - leadingIndicators : 환경 무관 선행지표 — 삼각형 / 드로우콜 / 고유 프로그램 /
 *    CPU 프레임 시간 p95(GPU 제외). **패스별 예산으로 게이트하며 초과 시 exit 1.**
 *  - gpuDependent : fps·프레임타임 분포·히치 귀속. 소프트웨어 렌더러 감지 시
 *    `GPU-INVALID` 배너 — 절대 fps는 목표 하드웨어에서만 판정한다.
 *
 *   node tools/profile.mjs [--phase p1] [--duration 30] [--dpr 2] [--runs 3]
 */

import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs } from './lib/browser.mjs';
import { VIEW } from './shots.js';

const args = parseArgs();

/** 계약 측정 조건 (HARNESS.md §6 / PATCH-001-C) — 해상도·워밍업 포함 (감사 B1/B6) */
const CONTRACT = Object.freeze({
  duration: 30, runs: 3, dpr: VIEW.dpr, w: VIEW.width, h: VIEW.height, warmup: 30,
});

const DURATION = Number(args.duration ?? CONTRACT.duration);
const DPR = Number(args.dpr ?? CONTRACT.dpr);
const RUNS = Number(args.runs ?? CONTRACT.runs);
const W = Number(args.w ?? CONTRACT.w);
const H = Number(args.h ?? CONTRACT.h);
const PHASE = String(args.phase ?? 'p1');
/** 워밍업 제외 프레임 (조작 인계 + 첫 섀도 캐스케이드 맞춤은 1회성 비용) */
const WARMUP_FRAMES = Number(args.warmup ?? CONTRACT.warmup);
const HITCH_MS = 50;

const NON_CONTRACT =
  DURATION < CONTRACT.duration || RUNS < CONTRACT.runs || DPR < CONTRACT.dpr ||
  W < CONTRACT.w || H < CONTRACT.h || WARMUP_FRAMES !== CONTRACT.warmup;

/** 패스별 선행지표 예산 (P1-BRIEF 0-3) */
const BUDGETS = Object.freeze({
  p1: { triangles: 2_000_000, drawCalls: 900, programs: 40, cpuFrameMsP95: 6 },
  final: { triangles: 6_000_000, drawCalls: 1500, programs: 120, cpuFrameMsP95: 8 },
});
const budget = BUDGETS[PHASE];
if (!budget) {
  console.error(`unknown --phase: ${PHASE} (${Object.keys(BUDGETS).join('|')})`);
  process.exit(2);
}

/** P1 게임플레이 스크립트: 이동/시점/점프 사이클 (사격은 P2, AI는 P4에서 추가) */
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

const SOFTWARE_GL = /swiftshader|llvmpipe|software|swangle/i;

const server = await startServer();
const browser = await launchBrowser();
const runs = [];
let environment = null;

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
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      dpr: devicePixelRatio,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      megapixels: +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2),
      renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  environment ??= { ...internal, softwareGL: SOFTWARE_GL.test(internal.renderer) };

  await g.page.evaluate(() => window.__harness.resetState());
  const script = buildScript(DURATION);
  await g.page.evaluate((s) => window.__harness.runScript(s), script);
  const stats = await g.page.evaluate(() => window.__harness.getStats());
  await g.close();

  // 인덱스 정렬: frameTimes[i]는 레코드 i ↔ i+1 사이의 간격이다.
  // 프레임 j의 지속시간 = frameTimes[j-1] 이므로, 프레임 WARMUP..N-1을 다루려면
  // frameTimes는 WARMUP-1부터 잘라야 per-frame 배열들과 경계가 일치한다 (감사 B7).
  const FT_OFFSET = Math.max(0, WARMUP_FRAMES - 1);
  const ft = stats.frameTimes.slice(FT_OFFSET);
  const progs = stats.programCountPerFrame.slice(WARMUP_FRAMES);
  const calls = stats.drawCallsPerFrame.slice(WARMUP_FRAMES);
  const tris = stats.trianglesPerFrame.slice(WARMUP_FRAMES);
  const cpuSimRaw = stats.cpuSimMsPerFrame.slice(WARMUP_FRAMES);
  const cpuSubmitRaw = stats.cpuSubmitMsPerFrame.slice(WARMUP_FRAMES);
  const cpuSim = cpuSimRaw.filter((v) => v >= 0).sort((a, b) => a - b);
  const cpuSubmit = cpuSubmitRaw.filter((v) => v >= 0).sort((a, b) => a - b);
  // 프레임별 합(sim+submit)의 분포 — p95(sim)+p95(submit)는 합의 p95가 아니다 (감사 B3)
  const cpuTotal = [];
  for (let i = 0; i < cpuSimRaw.length; i++) {
    if (cpuSimRaw[i] >= 0 && cpuSubmitRaw[i] >= 0) cpuTotal.push(cpuSimRaw[i] + cpuSubmitRaw[i]);
  }
  cpuTotal.sort((a, b) => a - b);
  const sorted = ft.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const worst = sorted[sorted.length - 1] ?? NaN;

  const hitches = [];
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] <= HITCH_MS) continue;
    // ft[i] = 레코드 (FT_OFFSET+i) → (FT_OFFSET+i+1) 간격. 히치가 끝난 프레임:
    const endFrame = i + FT_OFFSET + 1;
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
    frames: ft.length,
    leading: {
      trianglesMax: Math.max(...tris),
      drawCallsMax: Math.max(...calls),
      programsEnd: progs.at(-1) ?? 0,
      // sim: 항상 환경 무관. submit: 실 GPU에서만 CPU 비용 (소프트웨어 GL은 라스터에 블록)
      cpuSimMs: {
        p50: +percentile(cpuSim, 0.5).toFixed(2),
        p95: +percentile(cpuSim, 0.95).toFixed(2),
        worst: +(cpuSim[cpuSim.length - 1] ?? NaN).toFixed(2),
        samples: cpuSim.length,
      },
      cpuSubmitMs: {
        p50: +percentile(cpuSubmit, 0.5).toFixed(2),
        p95: +percentile(cpuSubmit, 0.95).toFixed(2),
        worst: +(cpuSubmit[cpuSubmit.length - 1] ?? NaN).toFixed(2),
      },
      // 프레임별 sim+submit 합의 참 분위수 (실 GPU 게이트 성분 — 감사 B3)
      cpuTotalMs: {
        p50: +percentile(cpuTotal, 0.5).toFixed(2),
        p95: +percentile(cpuTotal, 0.95).toFixed(2),
        worst: +(cpuTotal[cpuTotal.length - 1] ?? NaN).toFixed(2),
      },
    },
    gpu: {
      frameMs: { p50: +p50.toFixed(2), p95: +p95.toFixed(2), p99: +p99.toFixed(2), worst: +worst.toFixed(1) },
      fps: {
        p50: +(1000 / p50).toFixed(1),
        p95: +(1000 / p95).toFixed(1),
        p99: +(1000 / p99).toFixed(1),
        min: +(1000 / worst).toFixed(1),
      },
      hitchCount: hitches.length,
      hitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
    },
    programs: {
      start: progs[0] ?? 0,
      end: progs.at(-1) ?? 0,
      // 컴파일-0 게이트는 워밍업 절단 없이 전 기록 구간으로 판정한다 (감사 B6) —
      // 리셋 직후 첫 프레임들의 지연 컴파일이 §0(1)이 잡으라는 바로 그 실패다.
      compiledDuringPlay:
        (stats.programCountPerFrame.at(-1) ?? 0) - (stats.programCountPerFrame[0] ?? 0),
    },
  });
}

await browser.close();
await server.close();

const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];

// ---- 선행지표 집계는 보수적으로: 런 간 최악값을 예산과 비교 ----
// CPU 프레임 시간(GPU 제외):
//  - 실 GPU: sim + submit (render()가 제출만 하고 리턴 → 전부 CPU 비용)
//  - 소프트웨어 GL: render()가 라스터에 블록되어 submit이 오염 → sim 성분만 게이트하고
//    submit은 참고로 보고한다. 목표 하드웨어에서 total 기준 재검증 필요 (보고서에 명시)
const cpuGatedP95 = environment.softwareGL
  ? Math.max(...runs.map((r) => r.leading.cpuSimMs.p95))
  : Math.max(...runs.map((r) => r.leading.cpuTotalMs.p95)); // 프레임별 합의 참 p95 (감사 B3)
const leading = {
  triangles: { value: Math.max(...runs.map((r) => r.leading.trianglesMax)), budget: budget.triangles },
  drawCalls: { value: Math.max(...runs.map((r) => r.leading.drawCallsMax)), budget: budget.drawCalls },
  programs: { value: Math.max(...runs.map((r) => r.leading.programsEnd)), budget: budget.programs },
  cpuFrameMsP95: {
    value: +cpuGatedP95.toFixed(2),
    budget: budget.cpuFrameMsP95,
    basis: environment.softwareGL ? 'sim-only (software GL: submit은 라스터 오염)' : 'sim+submit',
    submitP95_reference: +Math.max(...runs.map((r) => r.leading.cpuSubmitMs.p95)).toFixed(2),
  },
};
for (const k of Object.keys(leading)) leading[k].pass = leading[k].value <= leading[k].budget;
const leadingPass = Object.values(leading).every((v) => v.pass);

const banners = [];
if (NON_CONTRACT) banners.push('NON-CONTRACT MEASUREMENT — 계약 조건(30s/3runs/DPR2) 미달. 게이트 판정에 쓰지 마라');
if (environment.softwareGL) banners.push('GPU-INVALID — 소프트웨어 렌더러. gpuDependent 섹션은 절대 성능 판정에 무효');

const summary = {
  banners,
  contract: { duration: DURATION, runs: RUNS, dpr: DPR, w: W, h: H, warmup: WARMUP_FRAMES, nonContract: NON_CONTRACT },
  environment,
  phase: PHASE,
  /** 환경 무관 선행지표 — 이 섹션이 P1 이후 패스 게이트다 */
  leadingIndicators: { ...leading, pass: leadingPass },
  shaderCompilesDuringPlay_max: Math.max(...runs.map((r) => r.programs.compiledDuringPlay)),
  bootMs_median: med(runs.map((r) => r.bootMs)),
  /** GPU 의존 — softwareGL이면 참고치 */
  gpuDependent: {
    valid: !environment.softwareGL,
    fps_p50_median: med(runs.map((r) => r.gpu.fps.p50)),
    fps_p99_median: med(runs.map((r) => r.gpu.fps.p99)),
    frame_worst_max: Math.max(...runs.map((r) => r.gpu.frameMs.worst)),
    hitchCount_total: runs.reduce((a, r) => a + r.gpu.hitchCount, 0),
  },
  perRun: runs,
};
console.log(JSON.stringify(summary, null, 2));

// 게이트: 선행지표 초과 또는 플레이 중 셰이더 컴파일 발생 시 실패
const compileFail = summary.shaderCompilesDuringPlay_max > 0;
process.exit(leadingPass && !compileFail ? 0 : 1);
