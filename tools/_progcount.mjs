/**
 * 프로그램 수 프로브 (비계약 조건: 378×246 DPR 1) — **델타 측정 전용**.
 * 같은 프로브로 두 트리를 재서 차이만 본다. 절대값은 R4 마감의 계약 프로파일이 소유한다.
 * 프로그램 수는 해상도에 의존하지 않는다(재질 순열에만 의존) — 해상도를 낮춰 시간만 줄였다.
 * 액션(격발) 있는 샷만 계약 프레임 수까지 돌린다 — fx 프로그램은 발사 뒤에 컴파일된다.
 */
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage } from './lib/browser.mjs';
import { SHOTS, FIXED_STEP_FRAMES } from './shots.js';

const server = await startServer();
const browser = await launchBrowser();
const g = await openGamePage(browser, { baseUrl: server.url, width: 378, height: 246, dpr: 1, query: 'mode=fixed' });
for (const s of SHOTS) {
  const frames = s.actions?.length ? FIXED_STEP_FRAMES : 24;
  await g.page.evaluate(() => window.__harness.resetState());
  await g.page.evaluate((n) => window.__harness.setShot(n), s.name);
  await g.page.evaluate((n) => window.__harness.stepFrames(n), frames);
  const st = await g.page.evaluate(() => {
    const x = window.__harness.getStats();
    return { programs: x.programCountPerFrame.at(-1), drawCalls: x.drawCalls };
  });
  console.log(JSON.stringify({ shot: s.name, frames, ...st }));
}
console.log(JSON.stringify({ errors: await g.page.evaluate(() => window.__harness.getErrors()) }));
await g.close(); await browser.close(); await server.close();
