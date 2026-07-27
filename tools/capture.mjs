#!/usr/bin/env node
/**
 * tools/capture.mjs — 지정 샷 1장 빠른 캡처. 재현성 보장 안 함 (게이트 금지).
 *
 *   node tools/capture.mjs --shot=courtyard_noon --out=tmp/shot.png [--dpr=2] [--list]
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng } from './lib/browser.mjs';
import { SHOTS, SHOTS_BY_NAME, FIXED_STEP_FRAMES, VIEW } from './shots.js';

const args = parseArgs();

if (args.list) {
  console.log(SHOTS.map((s) => s.name).join('\n'));
  process.exit(0);
}

const shotName = args.shot ?? SHOTS[0].name;
if (!SHOTS_BY_NAME.has(shotName)) {
  console.error(`unknown shot: ${shotName}`);
  process.exit(2);
}
const OUT = resolve(args.out ?? `tmp/${shotName}.png`);
const DPR = Number(args.dpr ?? VIEW.dpr);
const SETTLE = Number(args.settle ?? FIXED_STEP_FRAMES);

const server = await startServer();
const browser = await launchBrowser();
let failed = null;
try {
  const g = await openGamePage(browser, {
    baseUrl: server.url,
    width: Number(args.w ?? VIEW.width),
    height: Number(args.h ?? VIEW.height),
    dpr: DPR,
    query: 'mode=fixed',
  });
  await g.page.evaluate(() => window.__harness.resetState());
  await g.page.evaluate((n) => window.__harness.setShot(n), shotName);
  await g.page.evaluate((n) => window.__harness.stepFrames(n), SETTLE);
  mkdirSync(dirname(OUT), { recursive: true });
  await capturePng(g.page, OUT);
  const errs = g.errors;
  console.log(JSON.stringify({ ok: errs.length === 0, out: OUT, shot: shotName, dpr: DPR, settle: SETTLE, errors: errs }, null, 2));
  if (errs.length) failed = new Error('page errors');
  await g.close();
} catch (e) {
  failed = e;
  console.error(JSON.stringify({ ok: false, error: e.message }));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
