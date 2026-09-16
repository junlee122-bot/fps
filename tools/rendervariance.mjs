#!/usr/bin/env node
/**
 * tools/rendervariance.mjs — 렌더 결정성 게이트 (C3 교정, HARNESS.md 도구표).
 *
 * 각 샷에 대해 resetState → setShot → stepFrames(F)를 R회 반복하고 하네스 getSceneHash()(HDR 씬 RT
 * HalfFloat 전체 해시)를 비교한다. 같은 입력의 반복 렌더는 해시가 단일이어야 한다. 8비트 픽셀 게이트
 * (baseline ×2)는 서브LSB 변동을 90프레임에 1픽셀꼴로만 드러냈다(hanji_silhouette 실측) — 이 게이트는
 * 매 렌더의 변동을 그대로 잡는다(교정 전 POM 암시 미분: 12회 중 10종 해시). 축소 해상도(640×416)라도
 * 변동 검출은 해상도와 무관한 성질이다(비계약 픽셀이 아니라 결정성 성질 검사).
 *
 * 사용: node tools/rendervariance.mjs [--repeats 4] [--frames 1] [--shots a,b] [--inject-drift]
 *   --inject-drift: 음성 테스트 — 하네스 debugDrift(지터 드리프트 주입) → 반드시 변동 검출·exit 1·testOverride.
 * 출력: JSON { ok, repeats, frames, size, shots: { name: { unique, hashes } }, varying: [...], testOverride? }
 */
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage } from './lib/browser.mjs';
import { SHOTS } from './shots.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const REPEATS = +arg('--repeats', 4);
const FRAMES = +arg('--frames', 1);
const wanted = arg('--shots', '') ? arg('--shots', '').split(',') : SHOTS.map((s) => s.name);
const INJECT = argv.includes('--inject-drift');
const W = +arg('--w', 640), H = +arg('--h', 416);

const server = await startServer();
const browser = await launchBrowser();
const out = { ok: false, repeats: REPEATS, frames: FRAMES, size: `${W}x${H}@1x`, shots: {}, varying: [] };
try {
  const g = await openGamePage(browser, { baseUrl: server.url, width: W, height: H, dpr: 1, query: 'mode=fixed' });
  if (INJECT) await g.page.evaluate(() => window.__harness.debugDrift(true));
  for (const shot of wanted) {
    const hashes = await g.page.evaluate(async ([shot, n, frames]) => {
      const hs = [];
      for (let i = 0; i < n; i++) {
        window.__harness.resetState();
        window.__harness.setShot(shot);
        await window.__harness.stepFrames(frames);
        // C4: 씬 RT + 포스트(안개·TAA·MB) 출력 RT + 노출 적응값을 함께 해시 — 체인 전체의 결정성
        const e = window.__harness.getExposure ? window.__harness.getExposure() : null;
        hs.push(window.__harness.getSceneHash('sceneRT').hash + '|' + window.__harness.getSceneHash('mbRT').hash + (e ? `|ev${e.ev100}` : ''));
      }
      return hs;
    }, [shot, REPEATS, FRAMES]);
    const unique = [...new Set(hashes)];
    out.shots[shot] = { unique: unique.length, hashes: unique, sequence: hashes.map((h) => unique.indexOf(h)) }; // sequence: 반복별 해시 인덱스 (어느 반복이 이탈했는지)
    if (unique.length !== 1) out.varying.push(shot);
  }
  const st = await g.page.evaluate(() => window.__harness.getStats());
  if (st.testOverride) out.testOverride = st.testOverride;
  out.errors = [...g.errors, ...(await g.page.evaluate(() => window.__harness.getErrors()))];
  out.ok = out.varying.length === 0 && out.errors.length === 0 && !out.testOverride;
  await g.close();
} catch (e) {
  out.error = e.message;
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
