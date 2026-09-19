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

/**
 * [PATCH-010-D] 실 GPU 측정 경로 — 기본(LAUNCH_ARGS)은 SwiftShader 를 **강제**하므로 실기에서 그대로 쓰면 항상 GPU-INVALID 다.
 * gpu=true(또는 환경변수 FPS_GPU=1)면 소프트웨어 강제 플래그를 빼고 GPU 차단 목록을 무시한다(Windows: ANGLE D3D11, Linux: 드라이버
 * 기본, macOS: Metal). headful=true(FPS_HEADFUL=1)는 창을 띄워 실행 — 헤드리스 셸이 GPU 를 못 잡는 환경(일부 Windows·원격 데스크톱)의
 * 대체 경로. 픽셀 게이트(baseline/imagediff)는 이 경로를 쓰지 않는다 — 실 GPU 결정성은 CONTRACT-NOTES A3/B5 대로 로컬 재생성.
 */
export const LAUNCH_ARGS_GPU = [
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-lcd-text',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

export function launchOptions({ gpu = process.env.FPS_GPU === '1', headful = process.env.FPS_HEADFUL === '1' } = {}) {
  return { headless: !headful, args: gpu ? LAUNCH_ARGS_GPU : LAUNCH_ARGS, gpu, headful };
}

export async function launchBrowser(opts = {}) {
  const o = launchOptions(opts);
  return chromium.launch({ headless: o.headless, args: o.args });
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
/**
 * 드로잉 버퍼 해상도 캡처 (C2 교정): clip.scale 없는 captureScreenshot은 CSS 해상도
 * (1512×982)로 2×2 박스평균된 이미지를 돌려줘 'DPR 2 (5.94MP)' 계약이 픽셀 게이트에서
 * 실행되지 않았고, 버퍼 1픽셀 Δ≤3 LSB 변화가 평균 후 반올림으로 소실돼 tolerance 0의
 * 감도가 4× 희석됐다. clip.scale=DPR로 디바이스 픽셀 그대로 받는다 (측정 대상 교정 —
 * 임계값 불변). 측정 도구들은 png.width로 스케일을 유도하므로 호환.
 */
/**
 * 페이지 수명 동안 유지되는 캡처용 CDP 세션 (C2 교정 2차).
 * Chromium의 Page.captureScreenshot(clip.scale)은 호출 세션의 Emulation 파라미터를
 * "원본"으로 삼아 스케일을 곱하고 촬영 후 그 원본으로 복원한다. 새 세션은 원본이
 * 비어 있어 복원 = ClearDeviceMetricsOverride → Playwright가 건 DPR 2 에뮬레이션이
 * 지워져 두 번째 캡처부터 devicePixelRatio 1(1512×982)로 떨어졌다 (프로브 실측:
 * 1회차 3024×1964, 2회차 1512×982). 해법: 캡처 세션이 스스로 동일 메트릭
 * (CSS 크기·DPR)을 명시 등록하고 페이지가 닫힐 때까지 detach하지 않는다 —
 * 복원 대상이 세션 자신의 DPR 2라 에뮬레이션이 보존되고, clip.scale=1이면
 * 출력 = CSS × DPR = 드로잉 버퍼 해상도(3024×1964)가 된다.
 */
const _captureSessions = new WeakMap();
async function captureSession(page) {
  let cdp = _captureSessions.get(page);
  if (cdp) return cdp;
  cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: false,
  });
  _captureSessions.set(page, cdp);
  page.once('close', () => _captureSessions.delete(page));
  return cdp;
}

export async function capturePng(page, path) {
  const cdp = await captureSession(page);
  const vp = page.viewportSize();
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 },
  });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(data, 'base64'));
}

/**
 * PATCH-007-C 자발광·일시광 태그 마스크 저장 — 캡처와 같은 카메라·지터로 태그 오브젝트(src/render/tagmask.js 규칙)의
 * 가시 픽셀을 흰색(255), 나머지를 검정(0)으로 그린 PNG. paletteaudit 가 `<shot>.emask.png` 를 읽어 그 픽셀에만
 * 자발광 밴드를 적용한다. 캡처·getStats **뒤**에 호출한다 (오버라이드 재질 컴파일이 캡처 프레임 통계에 섞이지 않게).
 * @returns {{width,height,taggedPixels,ratioPct,taggedObjects,taggedMaterials,drawCalls,rule}}
 */
export async function captureMask(page, path) {
  const m = await page.evaluate(() => window.__harness.renderTagMask());
  const { PNG } = await import('pngjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const bytes = Buffer.from(m.bits, 'base64');
  const png = new PNG({ width: m.width, height: m.height });
  for (let i = 0; i < m.width * m.height; i++) {
    const v = (bytes[i >> 3] >> (7 - (i & 7))) & 1 ? 255 : 0;
    png.data[i * 4] = v; png.data[i * 4 + 1] = v; png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
  const { bits, ...meta } = m;
  return meta;
}

// 인자 파서는 args.mjs가 소유 — playwright 의존이 없는 도구(imagediff)도 쓴다
export { parseArgs } from './args.mjs';
