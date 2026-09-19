// vite.config.js — P5 정적 배포 빌드 전용 (발주자 요청 2026-09-18, CONTRACT-NOTES "P5 요구사항").
//
// 하네스·게이트는 vite 를 쓰지 않는다: tools/lib/server.mjs 가 리포 루트를 그대로 서빙하고 index.html 의 import map 이
// /node_modules/three/… 를 가리킨다. 이 설정은 `vite build` 에서만 동작하며 소스 index.html 은 바이트 하나 바꾸지 않는다 —
// 빌드 시 HTML 변환으로 (1) import map 을 제거하고(번들이 three 를 포함) (2) "플레이·확인용 빌드. 게이트 대상 아님" 배너와
// noindex 를 삽입한다. 배포본은 게이트가 검증한 dev 빌드와 동일하다는 보장이 없다(미니파이·트리셰이킹). docs/DEPLOY.md 참조.
//
//   npm run build                      → dist/  (base '/', Vercel)
//   DEPLOY_BASE=/fps/ npm run build    → GitHub Pages 등 하위 경로 호스팅
import { defineConfig } from 'vite';

const BANNER_TEXT = '플레이·확인용 빌드. 게이트 대상 아님';

function deployHtml() {
  return {
    name: 'joseon-cqb-deploy-html',
    apply: 'build',
    transformIndexHtml(html) {
      // (1) import map 제거 — 번들이 three 를 포함하므로 남겨두면 브라우저가 /node_modules 를 찾다 실패한다.
      const stripped = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
      // (2) 배너 + noindex. 캔버스 위 고정 오버레이, 포인터 통과(pointer-events:none) — 입력에 영향 없음.
      const banner =
        `<meta name="robots" content="noindex" />\n` +
        `<style>#deploy-banner{position:fixed;top:0;left:0;right:0;z-index:9999;pointer-events:none;` +
        `font:12px/1.6 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);text-align:center;letter-spacing:.02em}</style>\n`;
      const bannerBody = `<div id="deploy-banner">${BANNER_TEXT} — build ${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}</div>\n`;
      return stripped.replace('</head>', banner + '</head>').replace('<body>', '<body>\n  ' + bannerBody);
    },
  };
}

export default defineConfig({
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [deployHtml()],
  build: {
    target: 'es2022',          // src/main.js 는 top-level await 를 쓴다
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000, // three 단일 청크 경고 억제 (에셋 0, 의존성 1개)
  },
});
