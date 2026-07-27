#!/usr/bin/env node
/**
 * tools/shotset.mjs — 11샷 일괄, 한 페이지 재사용. 빠른 육안 리뷰 전용.
 *
 * ⚠ 재현성 없음 — 게이트로 쓰지 마라 (HARNESS.md §1).
 * 페이지를 재사용하므로 상태(향후: 파티클·데칼·노출)가 앞 샷에서 샌다.
 * 재현 가능한 캡처는 baseline.mjs다.
 *
 *   node tools/shotset.mjs --out=tmp/set [--dpr=1] [--settle=24]
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng } from './lib/browser.mjs';
import { SHOTS, VIEW } from './shots.js';

const args = parseArgs();
const OUTDIR = resolve(args.out ?? 'tmp/set');
// 리뷰용이므로 기본은 가볍게: DPR 1, 24프레임
const DPR = Number(args.dpr ?? 1);
const SETTLE = Number(args.settle ?? 24);

mkdirSync(OUTDIR, { recursive: true });
const server = await startServer();
const browser = await launchBrowser();
const report = { ok: true, outDir: OUTDIR, reused_page: true, reproducible: false, shots: [] };

try {
  const g = await openGamePage(browser, {
    baseUrl: server.url,
    width: Number(args.w ?? VIEW.width),
    height: Number(args.h ?? VIEW.height),
    dpr: DPR,
    query: 'mode=fixed',
  });
  // 의도적으로 resetState를 샷 사이에 호출하지 않는다 — 이 도구는
  // "상태가 새는 빠른 리뷰"가 정의다. 첫 1회만 초기화.
  await g.page.evaluate(() => window.__harness.resetState());
  for (const shot of SHOTS) {
    await g.page.evaluate((n) => window.__harness.setShot(n), shot.name);
    await g.page.evaluate((n) => window.__harness.stepFrames(n), SETTLE);
    const out = `${OUTDIR}/${shot.name}.png`;
    await capturePng(g.page, out);
    report.shots.push({ shot: shot.name, out });
  }
  report.errors = g.errors;
  if (g.errors.length) report.ok = false;
  await g.close();
} catch (e) {
  report.ok = false;
  report.error = e.message;
} finally {
  await browser.close();
  await server.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
