/**
 * tools/lib/browser.mjs — 헤드리스 Chromium 공통 런처.
 *
 * 이 컨테이너에는 GPU 장치가 없어 SwiftShader(소프트웨어 GL)로 렌더한다.
 * SwiftShader는 같은 머신에서 결정적이므로 비트 동일 게이트에 오히려 유리하다.
 * (실 GPU 머신에서는 해당 백엔드의 결정성에 따라 baseline을 로컬 재생성한다 —
 * CONTRACT-NOTES A3/B5.)
 */

import { chromium } from 'playwright';

export const LAUNCH_ARGS = [
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-lcd-text',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

export async function launchBrowser() {
  return chromium.launch({ headless: true, args: LAUNCH_ARGS });
}

/**
 * 격리 컨텍스트에서 게임 페이지 열기.
 * @returns {{context, page, errors: string[], close(): Promise}}
 */
export async function openGamePage(browser, { baseUrl, width, height, dpr, query = '', timeout = 120000 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
  });
  await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction('window.__harness !== undefined', null, { timeout });
  await page.evaluate(() => window.__harness.ready);
  return {
    context,
    page,
    errors,
    close: async () => {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    },
  };
}

/**
 * CDP 직접 스크린샷.
 *
 * page.screenshot()은 "페이지 안정화"를 기다리는데, fixed 모드처럼 우리가
 * 프레임 진행을 직접 제어하는 페이지에서는 그 휴리스틱이 컴포지터 상태와
 * 교착할 수 있다 (hanji_pierced 샷에서 재현 — 결정적으로 30s 타임아웃).
 * 프레임은 stepFrames가 이미 확정했으므로 안정화 대기 없이 표면을 그대로 찍는다.
 */
export async function capturePng(page, path) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(data, 'base64'));
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** --key=value 인자 파서 (참조 레포 관례) */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
}
