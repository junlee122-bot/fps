#!/usr/bin/env node
/**
 * tools/viewmodelaudit.mjs — 뷰모델 조도 단위 게이트 (P2A-BRIEF §3).
 *
 * 참조 레포의 영구 결함(뷰모델 광원 리그가 월드 대비 ~20× 조도 → 전 무기
 * 알베도 1/3 조작)을 구조적으로 차단한다. 검사:
 *  1. 알베도 0.18 중성 그레이 카드를 월드 공간과 뷰모델 공간(카메라 자식)에
 *     나란히 배치, 동일 조명에서 렌더 → 선형 휘도 비율이 1.0 ± 0.10 이내
 *  2. 순수 검정(알베도 0) 뷰모델 카드가 배경(인접 배경 샘플)보다 밝으면 즉시 실패
 *
 * 음성 훅 (HARNESS.md §0 원칙): --test-boost <n> 은 뷰모델 카드 조도를
 * 인위로 n배 (리그 불일치와 등가인 휘도 편차 주입). 반드시 exit 1이어야 하며
 * 출력에 testOverride가 박힌다. 게이트 판정 경로의 기본값은 바꾸지 않는다.
 *
 *   node tools/viewmodelaudit.mjs [--dpr=2] [--test-boost=2]
 */

import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng } from './lib/browser.mjs';
import { VIEW, FIXED_STEP_FRAMES } from './shots.js';

const args = parseArgs();
const DPR = Number(args.dpr ?? VIEW.dpr);
const BOOST = Number(args['test-boost'] ?? 1);
const RATIO_TOL = 0.10;

const server = await startServer();
const browser = await launchBrowser();
let g = null;
let exitCode = 1;
const report = { ok: false, tool: 'viewmodelaudit' };

try {
  g = await openGamePage(browser, {
    baseUrl: server.url,
    width: VIEW.width,
    height: VIEW.height,
    dpr: DPR,
    query: 'mode=fixed',
  });
  const page = g.page;

  await page.evaluate(() => window.__harness.resetState());
  const setup = await page.evaluate(
    (boost) => window.__harness.viewmodelAuditSetup({ boost }),
    BOOST
  );
  await page.evaluate((n) => window.__harness.stepFrames(n), FIXED_STEP_FRAMES);
  const shotPath = resolve('tmp/viewmodelaudit.png');
  await capturePng(page, shotPath);
  const png = PNG.sync.read(readFileSync(shotPath));

  // sRGB → 선형
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  /** rect {x,y,w,h} (CSS px) → 평균 선형 휘도. 스케일은 실제 PNG 크기에서 도출
   * (CDP 캡처가 CSS 크기로 나오는 환경과 디바이스 크기로 나오는 환경 모두 대응) */
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

  const world = meanLum(setup.rects.world);
  const vm = meanLum(setup.rects.vm);
  const black = meanLum(setup.rects.black);
  const backdrop = meanLum(setup.rects.backdrop);

  const ratio = world > 0 ? vm / world : Infinity;
  const ratioOk = Math.abs(ratio - 1) <= RATIO_TOL;
  const blackOk = black < backdrop;

  Object.assign(report, {
    ok: ratioOk && blackOk,
    size: `${VIEW.width}x${VIEW.height}@${DPR}x`,
    luminanceLinear: {
      worldCard: +world.toFixed(5),
      viewmodelCard: +vm.toFixed(5),
      blackCard: +black.toFixed(5),
      backdrop: +backdrop.toFixed(5),
    },
    ratio: +ratio.toFixed(4),
    ratioTolerance: RATIO_TOL,
    ratioOk,
    blackCardOk: blackOk,
    rects: setup.rects,
    ...(BOOST !== 1
      ? { testOverride: `boost=${BOOST} — harnesstest 전용, 계약 판정 무효` }
      : {}),
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
