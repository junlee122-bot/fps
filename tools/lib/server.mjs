/**
 * tools/lib/server.mjs — 정적 파일 서버 (빌드 도구 없음 — import map 서빙).
 *
 * 리포 루트를 그대로 서빙한다: /index.html, /src/*, /tools/shots.js,
 * /node_modules/three/*. 캐시는 끈다 — 도구 실행 사이 stale 방지.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, extname, normalize, sep } from 'node:path';
import { pinnedRoot } from './pinned.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

// FPS_SERVE_ROOT: 서빙 루트 재지정 (기본 리포 루트). 프로덕션 빌드(dist/)에 baseline 을 1회 돌려 dev 와 픽셀 동일한지
// 확인하는 선택 경로(docs/DEPLOY.md). 게이트 판정은 기본 루트(dev 빌드)에서만 유효 — 이 값이 설정된 실행은 계약 판정이 아니다.
/**
 * 서빙 루트 결정 (발주자 지시 2026-09-23):
 *  1) 인자로 루트를 직접 주면 그대로 (pixelowner --root 로 구 트리 대조 등)
 *  2) FPS_SERVE_ROOT 가 있으면 그대로 (dist/ 픽셀 동일 검증 — 계약 판정 아님)
 *  3) 그 외에는 **고정 스냅샷 워크트리**. 작업 트리를 편집해도 도는 프로브가 영향을 받지 않고,
 *     결과가 어느 상태의 것인지 SHA 로 확정된다. FPS_NO_PIN=1 로 끌 수 있다.
 */
function resolveRoot(root) {
  if (root !== undefined) return { root: resolve(root), pin: null };
  if (process.env.FPS_SERVE_ROOT) return { root: resolve(process.env.FPS_SERVE_ROOT), pin: null };
  if (process.env.FPS_NO_PIN === '1') return { root: resolve(import.meta.dirname, '../..'), pin: null };
  const pin = pinnedRoot();
  if (!pin) return { root: resolve(import.meta.dirname, '../..'), pin: null };
  if (pin.untracked.length) {
    console.error(`[pinned] 경고 — 서빙 경로에 추적되지 않은 파일이 있어 스냅샷에 들어가지 않는다: ${pin.untracked.join(', ')}`);
  }
  return { root: pin.root, pin };
}

/**
 * 렌더 프로브 단독 실행 잠금 (발주자 지시 4 를 기억이 아니라 구조로).
 * 같은 머신에서 브라우저 도구 둘이 겹쳐 돌면 4코어 소프트웨어 GL 을 나눠 쓰다 한쪽이 죽거나
 * 측정이 흔들린다(실제로 두 번 겪었다). 살아 있지 않은 PID 의 잠금은 스스로 치운다.
 * FPS_NO_LOCK=1 로 끈다 — 끌 때는 왜 끄는지 알고 끄는 것이다.
 */
const LOCK = process.env.FPS_LOCK_FILE ?? '/tmp/fps-render.lock';
function acquireLock() {
  if (process.env.FPS_NO_LOCK === '1') return () => {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK, `${process.pid} ${process.argv.slice(1).join(' ')}\n`, { flag: 'wx' });
      return () => { try { if (readFileSync(LOCK, 'utf8').startsWith(`${process.pid} `)) unlinkSync(LOCK); } catch { /* 이미 없음 */ } };
    } catch {
      let holder = '';
      try { holder = readFileSync(LOCK, 'utf8').trim(); } catch { continue; }
      const pid = Number(holder.split(' ')[0]);
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      if (alive) {
        throw new Error(`렌더 프로브가 이미 돌고 있다 (pid ${pid}: ${holder.slice(String(pid).length + 1)}). `
          + `끝난 뒤에 실행하라 — 겹쳐 돌리면 측정이 흔들린다. 의도한 병렬이면 FPS_NO_LOCK=1.`);
      }
      try { unlinkSync(LOCK); } catch { /* 경쟁 */ }
    }
  }
  return () => {};
}

export async function startServer(rootArg) {
  const releaseLock = acquireLock();
  const { root, pin } = resolveRoot(rootArg);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (path === '/') path = '/index.html';
      const file = normalize(resolve(root + path));
      // 루트 밖 탈출 차단
      if (!file.startsWith(root + sep) && file !== root) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    /** 서빙 중인 루트와, 고정 스냅샷이면 그 SHA·더티 여부 (결과 출처 확정용) */
    root,
    sha: pin?.sha ?? null,
    pinned: !!pin,
    dirty: pin?.dirty ?? null,
    close: () => new Promise((r) => server.close(() => { releaseLock(); r(); })),
  };
}
