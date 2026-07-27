#!/usr/bin/env node
/**
 * tools/baseline.mjs — 재현 가능 캡처. 유일한 픽셀 게이트 소스.
 *
 * 샷마다 완전히 새 페이지(새 컨텍스트)를 연다:
 *   ready 대기 → resetState() → setShot(name) → stepFrames(FIXED_N) → 촬영 → 폐기
 *
 * 페이지는 fixed 모드로 떠서 자체 프레임 루프가 없다(lockstep) — 셔터 시점의
 * 시뮬레이션 프레임 인덱스가 부팅 소요 시간과 무관하게 상수다.
 *
 * 동일 커밋 2회 실행 → 11 PNG 전부 바이트 동일이어야 한다. 아니면
 * 게임 코드의 결정성(HARNESS.md §2) 위반이다. 하네스가 아니라 게임을 고쳐라.
 *
 *   node tools/baseline.mjs --out=baseline [--dpr=2] [--shots=a,b] [--settle=90]
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng } from './lib/browser.mjs';
import { SHOTS, FIXED_STEP_FRAMES, VIEW } from './shots.js';

const args = parseArgs();
const OUTDIR = resolve(args.out ?? 'baseline');
const DPR = Number(args.dpr ?? VIEW.dpr);
const SETTLE = Number(args.settle ?? FIXED_STEP_FRAMES);
const W = Number(args.w ?? VIEW.width);
const H = Number(args.h ?? VIEW.height);
const wanted = args.shots
  ? String(args.shots).split(',').map((s) => s.trim())
  : SHOTS.map((s) => s.name);

mkdirSync(OUTDIR, { recursive: true });
const server = await startServer();
const browser = await launchBrowser();

// 비계약 조건 표식 (감사 B5 / PATCH-001-C 일반 원칙): 축소 해상도·부분 샷·짧은 settle로
// 재생성한 쌍이 무표식으로 픽셀 게이트를 통과하는 것을 막는다.
const NON_CONTRACT =
  DPR < VIEW.dpr || W < VIEW.width || H < VIEW.height ||
  SETTLE !== FIXED_STEP_FRAMES || wanted.length !== SHOTS.length;
const report = {
  ok: true, outDir: OUTDIR, size: `${W}x${H}@${DPR}x`, settle: SETTLE, isolated: true,
  nonContract: NON_CONTRACT,
  ...(NON_CONTRACT ? { banner: 'NON-CONTRACT CAPTURE — 계약 조건(DPR2/1512×982/settle90/11샷) 미달. 게이트 baseline으로 쓰지 마라' } : {}),
  shots: [],
};
if (NON_CONTRACT) console.error(report.banner);

for (const name of wanted) {
  let g = null;
  try {
    g = await openGamePage(browser, {
      baseUrl: server.url,
      width: W,
      height: H,
      dpr: DPR,
      query: 'mode=fixed',
    });
    await g.page.evaluate(() => window.__harness.resetState());
    await g.page.evaluate((n) => window.__harness.setShot(n), name);
    await g.page.evaluate((n) => window.__harness.stepFrames(n), SETTLE);
    const out = `${OUTDIR}/${name}.png`;
    await capturePng(g.page, out);
    const stats = await g.page.evaluate(() => {
      const s = window.__harness.getStats();
      return { triangles: s.triangles, drawCalls: s.drawCalls, programs: s.programCountPerFrame.at(-1), bootMs: Math.round(s.bootMs) };
    });
    const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
    report.shots.push({ shot: name, sha256: sha, ...stats, errors: g.errors });
    if (g.errors.length) report.ok = false;
  } catch (e) {
    report.ok = false;
    report.shots.push({ shot: name, error: e.message });
  } finally {
    await g?.close();
  }
}

await browser.close();
await server.close();

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
