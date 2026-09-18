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
 * 동일 커밋 2회 실행 → 12 PNG(+ 12 `.emask.png` 태그 마스크, PATCH-007-C) 전부 바이트 동일이어야 한다. 아니면
 * 게임 코드의 결정성(HARNESS.md §2) 위반이다. 하네스가 아니라 게임을 고쳐라.
 *
 *   node tools/baseline.mjs --out=baseline [--dpr=2] [--shots=a,b] [--settle=90]
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage, parseArgs, capturePng, captureMask } from './lib/browser.mjs';
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
// 장시간 실행 내성: 소프트웨어 GL의 GPU 프로세스 누적으로 브라우저가 수십 분 뒤
// 죽는 사례(11샷 중 10~11번째) 재발 방지 — 4샷마다 선제 재기동 + 실패 샷 1회 재시도.
// 샷마다 어차피 새 페이지이므로 브라우저 재기동은 캡처 픽셀에 영향이 없다.
let browser = await launchBrowser();
let shotsOnBrowser = 0;
async function freshBrowser() {
  await browser.close().catch(() => {});
  browser = await launchBrowser();
  shotsOnBrowser = 0;
}

// 비계약 조건 표식 (감사 B5 / PATCH-001-C 일반 원칙): 축소 해상도·부분 샷·짧은 settle로
// 재생성한 쌍이 무표식으로 픽셀 게이트를 통과하는 것을 막는다.
const NON_CONTRACT =
  DPR < VIEW.dpr || W < VIEW.width || H < VIEW.height ||
  SETTLE !== FIXED_STEP_FRAMES || wanted.length !== SHOTS.length;
const report = {
  ok: true, outDir: OUTDIR, size: `${W}x${H}@${DPR}x`, settle: SETTLE, isolated: true,
  nonContract: NON_CONTRACT,
  ...(NON_CONTRACT ? { banner: 'NON-CONTRACT CAPTURE — 계약 조건(DPR2/1512×982/settle90/전샷) 미달. 게이트 baseline으로 쓰지 마라' } : {}),
  shots: [],
};
if (NON_CONTRACT) console.error(report.banner);

async function captureShot(name) {
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
      const e = window.__harness.getExposure(); // C4: 샷별 적응 노출 (계측 기록 — 게이트는 픽셀 동일성)
      return { triangles: s.triangles, drawCalls: s.drawCalls, programs: s.programCountPerFrame.at(-1), bootMs: Math.round(s.bootMs),
        exposure: { ev100: e.ev100, evTarget: e.evTarget, avgLum: e.avgLum, exposure: e.exposure } };
    });
    const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
    // 하네스 오류([determinism] 트립와이어 포함)와 트랩 상태를 게이트에 편입 —
    // 페이지 이벤트(g.errors)만 보면 시뮬 창 난수 소비가 픽셀 게이트에 도달하지 않는다 (C2 검토)
    const harnessErrors = await g.page.evaluate(() => window.__harness.getErrors());
    const determinism = await g.page.evaluate(() => window.__harness.getDeterminism());
    // PATCH-007-C: 자발광·일시광 태그 마스크 — 캡처·통계·오류 수집 **뒤** (오버라이드 재질 컴파일이 프레임 통계에 섞이지 않게)
    const emissiveMask = await captureMask(g.page, `${OUTDIR}/${name}.emask.png`);
    return { shot: name, sha256: sha, ...stats, determinism, emissiveMask, errors: [...g.errors, ...harnessErrors] };
  } finally {
    await g?.close().catch(() => {});
  }
}

for (const name of wanted) {
  if (shotsOnBrowser >= 4) await freshBrowser();
  let entry;
  try {
    entry = await captureShot(name);
  } catch (e) {
    console.error(`[retry] ${name}: ${e.message} — 브라우저 재기동 후 1회 재시도`);
    await freshBrowser();
    try {
      entry = await captureShot(name);
      entry.retried = true;
    } catch (e2) {
      entry = { shot: name, error: e2.message };
    }
  }
  shotsOnBrowser++;
  if (entry.error || entry.errors?.length) report.ok = false;
  report.shots.push(entry);
}

await browser.close();
await server.close();

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
