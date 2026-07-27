/**
 * tools/lib/server.mjs — 정적 파일 서버 (빌드 도구 없음 — import map 서빙).
 *
 * 리포 루트를 그대로 서빙한다: /index.html, /src/*, /tools/shots.js,
 * /node_modules/three/*. 캐시는 끈다 — 도구 실행 사이 stale 방지.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize, sep } from 'node:path';

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

export async function startServer(root = resolve(import.meta.dirname, '../..')) {
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
    close: () => new Promise((r) => server.close(r)),
  };
}
