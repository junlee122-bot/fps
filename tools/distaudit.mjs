#!/usr/bin/env node
/**
 * tools/distaudit.mjs — 배포물 검사 (P4-BRIEF §7 「배포물 검사」, 하네스 공백 메움).
 *
 * 게이트는 import map + 자체 정적 서버에서 돌지만 배포는 `vite build` 의 `dist/` 다. 이 도구는 **실제로 배포되는 것**을 검사한다:
 *  [1] `npm run build` (DEPLOY_BASE '/') → dist/
 *  [2] dist/ 를 자체 정적 서버로 띄워 페이지를 부팅(fixed 모드, `__harness.ready`) — 그동안 **HTTP ≥ 400 응답 0 · 콘솔 오류 0 · 페이지 오류 0**
 *  [3] 매니페스트(src/audio/assets/manifest.js, 이후 모델·FX 텍스처)에 적힌 에셋 전부가 번들에 실려 **200** — 동적 URL 로 조립한 에셋이
 *      번들에서 빠지는 실패 모드(P4A 에서 실제로 날 뻔함)를 잡는다. vite 는 파일명에 해시를 붙이므로 `<stem>-<hash>.<ext>` 로 대응한다
 *  [4] dist/index.html 에 import map 이 남아 있지 않고 배포 배너가 있다(vite.config.js 의 약속)
 *
 * 음성 훅 (harnesstest 케이스 29): --inject-missing <stem>  매니페스트에 없는 파일명을 하나 더한 입력 → 반드시 exit 1 + testOverride.
 * 출력 JSON(stdout). exit 0 = 통과.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser } from './lib/browser.mjs';

const args = parseArgs();
const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const INJECT = args['inject-missing'] ? String(args['inject-missing']) : null;
const SKIP_BUILD = args['skip-build'] === true;
const BOOT_TIMEOUT_MS = Number(args['boot-timeout'] ?? 900000);
const problems = [];
const out = { ok: false, tool: 'distaudit', dist: DIST, ...(INJECT ? { testOverride: `inject-missing(${INJECT}) — harnesstest 전용, 계약 판정 무효` } : {}) };

/* [1] 빌드 */
if (!SKIP_BUILD) {
  const t0 = Date.now();
  const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DEPLOY_BASE: '/' } });
  out.build = { exit: b.status, ms: Date.now() - t0, stderrTail: (b.stderr ?? '').slice(-400) };
  if (b.status !== 0) problems.push(`[1] vite build exit ${b.status}`);
}
if (!existsSync(resolve(DIST, 'index.html'))) problems.push('[1] dist/index.html 없음');

/* [4] index.html 약속 */
if (existsSync(resolve(DIST, 'index.html'))) {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  out.indexHtml = { importmap: /type="importmap"/.test(html), banner: /deploy-banner/.test(html), bytes: html.length };
  if (out.indexHtml.importmap) problems.push('[4] dist/index.html 에 import map 잔존 — 번들이 아니라 소스 경로를 가리킨다');
  if (!out.indexHtml.banner) problems.push('[4] 배포 배너 없음 (vite.config.js 약속)');
}

/* [3] 매니페스트 에셋 → dist/assets 대응 */
const manifest = await import(pathToFileURL(resolve(ROOT, 'src/audio/assets/manifest.js')).href);
const wanted = []; // { stem, ext, from }
const pushUrl = (u, from) => { const name = basename(new URL(u).pathname); wanted.push({ stem: name.slice(0, -extname(name).length), ext: extname(name), from }); };
for (const [key, entry] of Object.entries(manifest.GUN_FAMILIES ?? {})) {
  for (const u of entry.files ?? []) pushUrl(u, `manifest:${key}`);
}
if (wanted.length === 0) {
  // 매니페스트 형태가 바뀌었으면 전수 스캔으로 대체하되 문제로 기록 — 조용한 0 은 금지 (PATCH-001-D)
  problems.push('[3] 매니페스트에서 파일 URL 을 하나도 찾지 못했다 — manifest.js 형태 확인');
}
if (INJECT) wanted.push({ stem: INJECT, ext: '.wav', from: 'inject-missing' });
const assetDir = resolve(DIST, 'assets');
const built = existsSync(assetDir) ? readdirSync(assetDir) : [];
out.assets = [];
for (const w of wanted) {
  const re = new RegExp(`^${w.stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[A-Za-z0-9_-]+\\${w.ext}$`);
  const match = built.find((f) => re.test(f)) ?? null;
  out.assets.push({ stem: w.stem + w.ext, from: w.from, built: match });
  if (!match) problems.push(`[3] 번들에 없음: ${w.stem}${w.ext} (${w.from})`);
}

/* [2] 부팅 — 정적 서버로 dist 서빙, 응답·콘솔 감시 */
if (existsSync(resolve(DIST, 'index.html'))) {
  const server = await startServer(DIST);
  const browser = await launchBrowser();
  const badResponses = [], consoleErrors = [], pageErrors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('response', (r) => { if (r.status() >= 400) badResponses.push({ url: r.url().replace(server.url, ''), status: r.status() }); });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
    const t0 = Date.now();
    await page.goto(`${server.url}/?mode=fixed`, { waitUntil: 'domcontentloaded', timeout: BOOT_TIMEOUT_MS });
    await page.waitForFunction('window.__harness !== undefined', null, { timeout: BOOT_TIMEOUT_MS });
    await page.evaluate(() => window.__harness.ready);
    out.boot = { ms: Date.now() - t0, programs: await page.evaluate(() => window.__harness.getStats()?.programs ?? null) };
    // 에셋 HTTP 200 — 번들 안에 있어도 서버가 내주는지 확인
    for (const a of out.assets) {
      if (!a.built) continue;
      const r = await page.evaluate(async (u) => { const res = await fetch(u); return { status: res.status, bytes: (await res.arrayBuffer()).byteLength }; }, `${server.url}/assets/${a.built}`);
      a.status = r.status; a.bytes = r.bytes;
      if (r.status !== 200 || r.bytes === 0) problems.push(`[3] ${a.built} → HTTP ${r.status}, ${r.bytes} B`);
    }
    await ctx.close();
  } catch (e) {
    problems.push(`[2] 부팅 실패: ${e.message.slice(0, 200)}`);
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
  out.badResponses = badResponses; out.consoleErrors = consoleErrors; out.pageErrors = pageErrors;
  if (badResponses.length) problems.push(`[2] HTTP ≥ 400 응답 ${badResponses.length}건: ${badResponses.slice(0, 3).map((b) => `${b.status} ${b.url}`).join(', ')}`);
  if (consoleErrors.length) problems.push(`[2] 콘솔 오류 ${consoleErrors.length}건: ${consoleErrors[0]}`);
  if (pageErrors.length) problems.push(`[2] 페이지 오류 ${pageErrors.length}건: ${pageErrors[0]}`);
}

out.problems = problems;
out.ok = problems.length === 0;
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
