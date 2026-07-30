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
import { percentile, sortedAsc, pairSum } from './lib/stats.mjs';
import { VIEW, SHOTS, FIXED_STEP_FRAMES } from './shots.js';

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
const PHASE = String(args.phase ?? 'p2b');
/** 워밍업 제외 프레임 (조작 인계 + 첫 섀도 캐스케이드 맞춤은 1회성 비용) */
const WARMUP_FRAMES = Number(args.warmup ?? CONTRACT.warmup);
const HITCH_MS = 50;

const NON_CONTRACT =
  DURATION < CONTRACT.duration || RUNS < CONTRACT.runs || DPR < CONTRACT.dpr ||
  W < CONTRACT.w || H < CONTRACT.h || WARMUP_FRAMES !== CONTRACT.warmup;

/**
 * 패스별 선행지표 예산.
 * [P1.5-BRIEF §0 정정] 삼각형은 두 지표로 분리 게이트:
 *  - trisScene    : 씬 전체 (씬그래프 순회, 인스턴스 전개, 컬링 무관)
 *  - trisFrameP95 : 프레임당 가시 삼각형 p95 — 11샷 순회 기준 (단일 카메라 무효)
 */
const BUDGETS = Object.freeze({
  p15: { trisScene: 600_000, trisFrameP95: 250_000, drawCalls: 900, programs: 40, cpuFrameMsP95: 6 },
  // [P2B §6·§7] 프로그램 상향(fx 변형) + 필레이트 선행지표 신설
  p2b: {
    trisScene: 600_000, trisFrameP95: 250_000, drawCalls: 900, programs: 90, cpuFrameMsP95: 6,
    overdrawP95: 2.5, particlesMax: 4000, decalsMax: 512,
  },
  // [P3 §7·§8] 프로그램 ≤110(CSM·후처리 변형 포함), overdraw ≤3.0 (안개·HANJI 편입 후에도 유지)
  p3: {
    trisScene: 600_000, trisFrameP95: 250_000, drawCalls: 900, programs: 110, cpuFrameMsP95: 6,
    overdrawP95: 3.0, particlesMax: 4000, decalsMax: 512,
  },
  final: {
    trisScene: 6_000_000, trisFrameP95: 2_000_000, drawCalls: 1500, programs: 120, cpuFrameMsP95: 8,
    overdrawP95: 4.0, particlesMax: 8000, decalsMax: 512,
  },
});
const budget = BUDGETS[PHASE];
if (!budget) {
  console.error(`unknown --phase: ${PHASE} (${Object.keys(BUDGETS).join('|')})`);
  process.exit(2);
}

// harnesstest 전용: 브라우저 실행 없이 해석된 설정·배너를 출력하고 종료.
// 케이스 3(기본값=계약)·4(NON-CONTRACT 배너)를 빠르게 검증할 수 있게 한다.
if (args['print-config']) {
  const banners = [];
  if (NON_CONTRACT) banners.push('NON-CONTRACT MEASUREMENT — 계약 조건(30s/3runs/DPR2) 미달. 게이트 판정에 쓰지 마라');
  console.log(JSON.stringify({
    contract: { duration: DURATION, runs: RUNS, dpr: DPR, w: W, h: H, warmup: WARMUP_FRAMES, nonContract: NON_CONTRACT },
    phase: PHASE,
    budgets: budget,
    banners,
  }, null, 2));
  process.exit(0);
}

/**
 * P2B 게임플레이 스크립트 — §7 최악 시나리오 포함:
 * 지붕 카빈 연사(기와 파편 낙하 + ceramic_shatter 다발) → 근접 산탄 연사
 * (펌프 에지 — fire 토글 세그먼트) → 장전 → 이동/점프 커버리지.
 */
function buildScript(duration) {
  const cycle = [
    { dur: 1.5, input: { forward: 1, right: 0, sprint: true, fire: false, reload: false, pitch: 0 }, tag: 'sprint_north' },
    // 동헌 지붕 조준 카빈 연사 — 기와 낙하 + 파편 + 예광 + 데칼 누적 (최악 필레이트).
    // pitch 0.15: 마당(z≈14)에서 동헌 지붕면(처마 5.2~용마루 7.35m) 앙각 실측치
    { dur: 2.4, input: { forward: 0, sprint: false, weaponSwitch: 'CARBINE', pitch: 0.15, fire: true }, tag: 'fire_roof_debris' },
    { dur: 2.4, input: { fire: false, reload: true, pitch: 0.1 }, tag: 'reload_carbine' },
    // 근접 산탄 — 펌프는 트리거 에지라 on/off 토글 (1.0s 주기 > 0.857s 간격)
    { dur: 0.5, input: { reload: false, weaponSwitch: 'SHOTGUN', pitch: 0.05, fire: true }, tag: 'shotgun_1' },
    { dur: 0.5, input: { fire: false }, tag: 'pump_1' },
    { dur: 0.5, input: { fire: true }, tag: 'shotgun_2' },
    { dur: 0.5, input: { fire: false }, tag: 'pump_2' },
    { dur: 0.5, input: { fire: true }, tag: 'shotgun_3' },
    { dur: 0.5, input: { fire: false }, tag: 'pump_3' },
    { dur: 4.4, input: { forward: 1, right: 0, reload: true }, yawRate: 0.8, tag: 'reload_shotgun_walk' },
    { dur: 1.0, input: { forward: 1, right: 0, sprint: false, reload: false, weaponSwitch: 'CARBINE' }, yawRate: 1.6, tag: 'turn_left' },
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
  // P3 지표 판정: 게이트는 단일 씬 패스(scene 계열), 전 패스 합산은 정보용 병기
  const calls = stats.drawCallsScenePerFrame.slice(WARMUP_FRAMES).filter((v) => v >= 0);
  const tris = stats.trianglesScenePerFrame.slice(WARMUP_FRAMES).filter((v) => v >= 0);
  const callsTotal = stats.drawCallsPerFrame.slice(WARMUP_FRAMES);
  const trisTotal = stats.trianglesPerFrame.slice(WARMUP_FRAMES);
  const cpuSimRaw = stats.cpuSimMsPerFrame.slice(WARMUP_FRAMES);
  const cpuSubmitRaw = stats.cpuSubmitMsPerFrame.slice(WARMUP_FRAMES);
  const odRaw = (stats.overdrawPerFrame ?? []).slice(WARMUP_FRAMES).filter((v) => v >= 0);
  const pcRaw = (stats.particlesPerFrame ?? []).slice(WARMUP_FRAMES).filter((v) => v >= 0);
  const dcRaw = (stats.decalsPerFrame ?? []).slice(WARMUP_FRAMES).filter((v) => v >= 0);
  const cpuSim = sortedAsc(cpuSimRaw.filter((v) => v >= 0));
  const cpuSubmit = sortedAsc(cpuSubmitRaw.filter((v) => v >= 0));
  // 프레임별 합(sim+submit)의 분포 — p95(sim)+p95(submit)는 합의 p95가 아니다 (감사 B3)
  const cpuTotal = sortedAsc(pairSum(cpuSimRaw, cpuSubmitRaw));
  const sorted = sortedAsc(ft);
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
      trianglesTotalMax: Math.max(...trisTotal), // 전 패스 합산 (정보용)
      drawCallsTotalMax: Math.max(...callsTotal),
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
      // [P2B §7] 필레이트 선행지표 — CPU 산출, 환경 무관
      overdraw: {
        p95: +percentile(sortedAsc(odRaw), 0.95).toFixed(3),
        worst: +(odRaw.length ? Math.max(...odRaw) : -1).toFixed(3),
      },
      particlesMax: pcRaw.length ? Math.max(...pcRaw) : 0,
      decalsMax: dcRaw.length ? Math.max(...dcRaw) : 0,
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

/* ---- tris_scene + tris_frame_p95 — 11샷 순회 (P1.5-BRIEF §0 정정) ----
 * 삼각형 카운트는 카메라·컬링에만 의존하고 DPR과 무관하므로 스윕은 DPR 1로 돈다
 * (소프트웨어 GL에서 DPR 2 스윕은 분급 낭비). 단일 카메라 측정은 무효 — 11샷 전부. */
const SWEEP_FRAMES = 10;
const gSweep = await openGamePage(browser, {
  baseUrl: server.url, width: W, height: H, dpr: 1, query: 'mode=fixed',
});
const trisScene = await gSweep.page.evaluate(() => window.__harness.getSceneTriangles());
await gSweep.page.evaluate(() => window.__harness.resetState());
for (const shot of SHOTS) {
  await gSweep.page.evaluate((n) => window.__harness.setShot(n), shot.name);
  await gSweep.page.evaluate((n) => window.__harness.stepFrames(n), SWEEP_FRAMES);
}
const sweepStats = await gSweep.page.evaluate(() => window.__harness.getStats());
await gSweep.close();
const trisFrameSamples = sweepStats.trianglesScenePerFrame.filter((v) => v >= 0);
const trisFrameP95 = percentile(sortedAsc(trisFrameSamples), 0.95);
const trisFrameTotalP95 = percentile(sortedAsc(sweepStats.trianglesPerFrame), 0.95);

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
  trisScene: {
    value: trisScene.total,
    budget: budget.trisScene,
    basis: '씬그래프 순회, 인스턴스 전개, 컬링 무관',
    invisibleColliders: trisScene.invisibleColliders,
  },
  trisFrameP95: {
    value: Math.round(trisFrameP95),
    budget: budget.trisFrameP95,
    basis: `11샷 × ${SWEEP_FRAMES}프레임 순회 (${trisFrameSamples.length}샘플), 단일 씬 패스 (P3 지표 판정)`,
    max: Math.max(...trisFrameSamples),
    allPassesP95_reference: Math.round(trisFrameTotalP95), // 그림자 3캐스케이드+프리패스+포스트 합산
  },
  drawCalls: {
    value: Math.max(...runs.map((r) => r.leading.drawCallsMax)),
    budget: budget.drawCalls,
    basis: '단일 씬 패스 (P3 지표 판정)',
    allPassesMax_reference: Math.max(...runs.map((r) => r.leading.drawCallsTotalMax)),
  },
  programs: { value: Math.max(...runs.map((r) => r.leading.programsEnd)), budget: budget.programs },
  cpuFrameMsP95: {
    value: +cpuGatedP95.toFixed(2),
    budget: budget.cpuFrameMsP95,
    basis: environment.softwareGL ? 'sim-only (software GL: submit은 라스터 오염)' : 'sim+submit',
    submitP95_reference: +Math.max(...runs.map((r) => r.leading.cpuSubmitMs.p95)).toFixed(2),
  },
};
// [P2B §7] 필레이트 선행지표 — 예산이 정의된 단계에서만 게이트 (p2b·final)
if (budget.overdrawP95 !== undefined) {
  leading.overdrawP95 = {
    value: +Math.max(...runs.map((r) => r.leading.overdraw.p95)).toFixed(3),
    budget: budget.overdrawP95,
    basis: '(활성 파티클+데칼 화면 투영 면적)/화면 픽셀 — 사격 시나리오 포함, run 간 max',
    worst: +Math.max(...runs.map((r) => r.leading.overdraw.worst)).toFixed(3),
  };
  leading.particlesMax = { value: Math.max(...runs.map((r) => r.leading.particlesMax)), budget: budget.particlesMax };
  leading.decalsMax = { value: Math.max(...runs.map((r) => r.leading.decalsMax)), budget: budget.decalsMax };
}
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
