#!/usr/bin/env node
/**
 * tools/albedoaudit.mjs — 알베도 정직성 게이트 (P3-BRIEF §5).
 *
 * 참조 레포의 유일한 "원인을 알고도 못 고친" 결함(알베도 위조)을 구조로 막는다.
 *  5-1 휘도 정합: 카드 0.04/0.18/0.90 렌더 → L(0.18)/L(0.04)≈4.5,
 *      L(0.90)/L(0.18)≈5.0 (±15%). 이탈 = 파이프라인이 알베도를 비선형으로 취급.
 *      (감사 렌더는 NoToneMapping·저강도 태양 — 카드 클리핑 방지, 표식 출력)
 *  5-2 매니페스트: src/materials/albedo-manifest.json의 의도 알베도와 실제
 *      씬 머티리얼(조명 BRDF 대상 = MeshStandardMaterial) 대조 — 편차 >10% exit 1.
 *      미선언 머티리얼·사문 항목도 실패다.
 *  5-3 검정 카드(0.0)가 배경보다 밝으면 즉시 exit 1.
 *
 * 음성 훅: --test-scale-albedo 0.333 은 씬 알베도를 1/3로 깎은 입력 —
 * 매니페스트 대조가 반드시 exit 1 (harnesstest 케이스 13).
 *
 *   node tools/albedoaudit.mjs [--dpr=2] [--test-scale-albedo=0.333]
 */

import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng } from './lib/browser.mjs';
import { VIEW, FIXED_STEP_FRAMES } from './shots.js';

const args = parseArgs();
const DPR = Number(args.dpr ?? VIEW.dpr);
const SCALE = Number(args['test-scale-albedo'] ?? 1);
const RATIO_TOL = 0.15;
const MANIFEST_TOL = 0.10;

const manifest = JSON.parse(readFileSync(resolve('src/materials/albedo-manifest.json'), 'utf8'));
delete manifest._doc;

const server = await startServer();
const browser = await launchBrowser();
let g = null;
let exitCode = 1;
const report = { ok: false, tool: 'albedoaudit' };

try {
  g = await openGamePage(browser, {
    baseUrl: server.url, width: VIEW.width, height: VIEW.height, dpr: DPR, query: 'mode=fixed',
  });
  const page = g.page;
  await page.evaluate(() => window.__harness.resetState());
  const setup = await page.evaluate((s) => window.__harness.albedoAuditSetup({ scaleAlbedo: s }), SCALE);
  await page.evaluate((n) => window.__harness.stepFrames(n), FIXED_STEP_FRAMES);
  const shotPath = resolve('tmp/albedoaudit.png');
  await capturePng(page, shotPath);
  const png = PNG.sync.read(readFileSync(shotPath));

  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const scale = png.width / VIEW.width;
  const meanLum = (rect) => {
    const x0 = Math.round(rect.x * scale), y0 = Math.round(rect.y * scale);
    const x1 = Math.round((rect.x + rect.w) * scale), y1 = Math.round((rect.y + rect.h) * scale);
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const i = (y * png.width + x) * 4;
        sum += 0.2126 * lin(png.data[i]) + 0.7152 * lin(png.data[i + 1]) + 0.0722 * lin(png.data[i + 2]);
        n++;
      }
    }
    return n ? sum / n : 0;
  };

  const L004 = meanLum(setup.rects.a004);
  const L018 = meanLum(setup.rects.a018);
  const L090 = meanLum(setup.rects.a090);
  const Lblack = meanLum(setup.rects.black);
  const Lbackdrop = meanLum(setup.rects.backdrop);

  const r1 = L018 / L004, r2 = L090 / L018;
  const r1Ok = Math.abs(r1 / 4.5 - 1) <= RATIO_TOL;
  const r2Ok = Math.abs(r2 / 5.0 - 1) <= RATIO_TOL;
  const blackOk = Lblack < Lbackdrop;

  // 5-2 매니페스트 대조
  const deviations = [];
  for (const [name, intended] of Object.entries(manifest)) {
    const actual = setup.materials[name];
    if (actual === undefined) {
      deviations.push({ name, intended, actual: null, problem: '씬에 없음 (사문 항목)' });
      continue;
    }
    const dev = Math.abs(actual - intended) / intended;
    if (dev > MANIFEST_TOL) {
      deviations.push({ name, intended, actual, deviationPct: +(dev * 100).toFixed(1) });
    }
  }
  for (const name of Object.keys(setup.materials)) {
    if (!(name in manifest)) deviations.push({ name, actual: setup.materials[name], problem: '매니페스트 미선언' });
  }

  Object.assign(report, {
    ok: r1Ok && r2Ok && blackOk && deviations.length === 0,
    luminance: {
      L004: +L004.toFixed(5), L018: +L018.toFixed(5), L090: +L090.toFixed(5),
      black: +Lblack.toFixed(5), backdrop: +Lbackdrop.toFixed(5),
    },
    ratios: {
      'L018/L004': +r1.toFixed(3), expected1: 4.5, r1Ok,
      'L090/L018': +r2.toFixed(3), expected2: 5.0, r2Ok,
    },
    blackCardOk: blackOk,
    manifestDeviations: deviations,
    auditState: setup.auditState,
    ...(setup.testOverride ? { testOverride: setup.testOverride } : {}),
    errors: await page.evaluate(() => window.__harness.getErrors()),
  });
  exitCode = report.ok ? 0 : 1;
} catch (err) {
  report.error = String(err?.message ?? err);
  exitCode = 1;
} finally {
  if (g) await g.close().catch(() => {});
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(exitCode);
