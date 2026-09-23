#!/usr/bin/env node
/**
 * tools/pixelowner.mjs — "이 픽셀은 누가 그렸나" 진단 도구. **게이트가 아니다** (판정 없음, 항상 exit 0).
 *
 * 배경 (R4 구멍 모양 이상, 발주자 지시 2026-09-23): 캡처에 정체 불명의 모양이 나왔을 때 지금까지는 추측으로
 * 범인을 지목했다 — 한 번은 뷰모델이라고 했다가 틀렸다(샷 3은 뷰모델을 선언하지 않는다). 틀린 이유는 가시성을
 * `o.visible` 만 보고 **부모 체인**을 보지 않아서였다. 그 오진을 도구로 막는다.
 *
 * 방법: 픽셀 하나를 주면 그 픽셀을 덮는 렌더 가능 객체를 전수 열거한다.
 *   - 부모 체인 가시성 (조상 중 하나라도 visible=false 면 제외)
 *   - InstancedMesh 는 **인스턴스마다** 개별 행렬로 (데칼·파티클·기와처럼 객체 원점이 엉뚱한 곳에 있는 풀이 많다)
 *   - 기하 로컬 AABB 8모서리를 화면에 투영하고, 그 점들의 **볼록 껍질** 안에 픽셀이 들어오는지로 판정
 *     (축 정렬 사각형보다 훨씬 좁다 — 무작위 회전한 쿼드에서 차이가 크다)
 *   - 거리 무제한, 카메라에서 가까운 순으로 출력
 *
 * 한계(반드시 같이 읽을 것): 이것은 **후보 목록**이지 광선 히트가 아니다. AABB 껍질 안이라도 그 픽셀에 실제
 * 프래그먼트를 쓰지 않을 수 있다(알파·알파테스트·디스카드·깊이 테스트·컬링). 확정은 `--hide` 로 껐다 켜서
 * 캡처가 바뀌는지 보는 것이다 — 도구는 후보를 좁히고, 판정은 그림으로 한다.
 *
 * 쓰임새:
 *   node tools/pixelowner.mjs --shot hanji_pierced --px 756,546 --px 756,491
 *   node tools/pixelowner.mjs --shot hanji_pierced --px 1512,1092 --project 3024x1964   # 계약 캡처 좌표 그대로
 *   node tools/pixelowner.mjs --shot hanji_silhouette --px 756,546 --hide silhouette_dummy --list
 *   node tools/pixelowner.mjs --root /path/to/old/tree --shot hanji_pierced --px 756,491  # 구 트리 대조
 *
 * 인자: --shot <이름>  --px <x,y> (반복)  --size <WxH, 기본 1512x982>  --project <WxH, 픽셀 좌표계>
 *       --settle <N, 기본 90>  --hide <이름> (반복)  --root <dir>  --list  --json  --max <N, 기본 12>
 */

import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, openGamePage } from './lib/browser.mjs';

const args = parseArgs();
const ROOT = resolve(args.root ?? resolve(import.meta.dirname, '..'));
const SHOT = args.shot;
const [W, H] = String(args.size ?? '1512x982').split('x').map(Number);
const [PW, PH] = String(args.project ?? `${W}x${H}`).split('x').map(Number);
const SETTLE = Number(args.settle ?? 90);
const MAX = Number(args.max ?? 12);
const LIST = args.list === true;
// 반복 플래그는 parseArgs 가 마지막 것만 남긴다(키 덮어쓰기) — 원시 argv 에서 전부 거둔다.
// (첫 실행에서 --px 4개 중 1개만 쓰여 결과가 한 줄만 나왔다. 조용한 손실이라 여기서 막는다.)
const repeated = (flag) => {
  const argv = process.argv.slice(2), out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${flag}`) { if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out.push(argv[++i]); }
    else if (a.startsWith(`--${flag}=`)) out.push(a.slice(flag.length + 3));
  }
  return out;
};
const PIXELS = repeated('px').flatMap((s) => s.split(';')).map((s) => s.split(',').map(Number));
const HIDE = repeated('hide').flatMap((s) => s.split(','));

if (!SHOT || PIXELS.length === 0) {
  console.error('사용: node tools/pixelowner.mjs --shot <이름> --px <x,y> [--px …] [--project WxH] [--hide 이름] [--list]');
  process.exit(2);
}

/** 페이지 안에서 도는 본체 — 픽셀을 덮는 후보 열거. THREE 없이 객체가 쥔 생성자만 쓴다. */
function ownersAt({ pixels, PW, PH, MAX }) {
  const p = window.__harness._internal.pipeline;
  const cam = p.camera;
  const chainVisible = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
  const V3 = cam.position.constructor;
  const M4 = cam.matrixWorld.constructor;

  const hull = (pts) => { // Andrew monotone chain
    const s = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (arr) => { const h = [];
      for (const q of arr) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
      h.pop(); return h; };
    return half(s).concat(half(s.reverse()));
  };
  const inHull = (h, x, y) => { // 볼록 다각형 포함 (경계 포함, 1px 여유)
    if (h.length < 3) return false;
    let neg = false, pos = false;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      const d = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (d < -1) neg = true; else if (d > 1) pos = true;
      if (neg && pos) return false;
    }
    return true;
  };

  const shapeOf = (geom, m) => {
    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const pts = []; let dmin = Infinity, dmax = -Infinity, front = false;
    for (let i = 0; i < 8; i++) {
      const v = new V3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(m);
      const d = v.distanceTo(cam.position); if (d < dmin) dmin = d; if (d > dmax) dmax = d;
      const q = v.clone().project(cam);
      if (q.z > -1 && q.z < 1) front = true;
      pts.push([(q.x * 0.5 + 0.5) * PW, (1 - (q.y * 0.5 + 0.5)) * PH]);
    }
    return { pts, dmin, dmax, front };
  };
  const describe = (o, inst) => ({
    name: (o.name || '(무명)') + (inst === undefined ? '' : `#${inst}`),
    type: o.type,
    material: o.material?.name || '(무명)',
    transparent: !!o.material?.transparent,
    opacity: o.material?.opacity ?? 1,
    renderOrder: o.renderOrder,
  });

  const rows = pixels.map(() => []);
  const all = [];
  p.scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isSprite || o.isLine)) return;
    if (!chainVisible(o)) return;
    if (o.isSprite || o.isPoints || o.isLine) { all.push({ ...describe(o), count: undefined, note: '껍질 판정 미지원' }); return; }
    if (o.isInstancedMesh) {
      all.push({ ...describe(o), count: o.count });
      const m = new M4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); const mm = m.clone().premultiply(o.matrixWorld);
        const s = shapeOf(o.geometry, mm); if (!s.front) continue;
        const h = hull(s.pts);
        for (let k = 0; k < pixels.length; k++)
          if (inHull(h, pixels[k][0], pixels[k][1])) rows[k].push({ ...describe(o, i), dNear: +s.dmin.toFixed(4), dFar: +s.dmax.toFixed(4) });
      }
      return;
    }
    all.push(describe(o));
    const s = shapeOf(o.geometry, o.matrixWorld); if (!s.front) return;
    const h = hull(s.pts);
    for (let k = 0; k < pixels.length; k++)
      if (inHull(h, pixels[k][0], pixels[k][1])) rows[k].push({ ...describe(o), dNear: +s.dmin.toFixed(4), dFar: +s.dmax.toFixed(4) });
  });
  return { rows: rows.map((r) => r.sort((a, b) => a.dNear - b.dNear).slice(0, MAX)), all, total: all.length };
}

const server = await startServer(ROOT);
const browser = await launchBrowser();
let out = null;
try {
  const g = await openGamePage(browser, { baseUrl: server.url, width: W, height: H, dpr: 1, query: 'mode=fixed' });
  const ev = (fn, a) => g.page.evaluate(fn, a);
  await ev(() => window.__harness.resetState());
  await ev((s) => window.__harness.setShot(s), SHOT);
  for (const name of HIDE) {
    const r = await ev((n) => { const o = window.__harness._internal.pipeline.scene.getObjectByName(n);
      if (!o) return 'NOT_FOUND'; o.visible = false; return 'hidden'; }, name);
    if (r === 'NOT_FOUND') console.error(`[경고] --hide ${name}: 그런 오브젝트가 없다`);
  }
  await ev((n) => window.__harness.stepFrames(n), SETTLE);
  out = await ev(ownersAt, { pixels: PIXELS, PW, PH, MAX });
  await g.close();
} finally {
  await browser.close();
  await server.close();
}

if (args.json === true) {
  console.log(JSON.stringify({ shot: SHOT, size: [W, H], project: [PW, PH], settle: SETTLE, pixels: PIXELS, ...out }, null, 2));
} else {
  console.log(`# pixelowner — 샷 ${SHOT}  렌더 ${W}×${H}  좌표계 ${PW}×${PH}  수렴 ${SETTLE}프레임  트리 ${ROOT}`);
  console.log(`# 렌더 가능 객체 ${out.total}개 (부모 체인 가시). 아래는 **후보**이며 확정은 --hide 로 껐다 켜 그림으로 한다.`);
  PIXELS.forEach(([x, y], k) => {
    console.log(`\n## 픽셀 (${x}, ${y}) — 후보 ${out.rows[k].length}개 (가까운 순)`);
    if (out.rows[k].length === 0) console.log('  (없음 — 하늘 돔조차 덮지 않는다면 좌표나 좌표계를 의심할 것)');
    for (const r of out.rows[k])
      console.log(`  ${r.dNear.toFixed(3)}m  ${r.name}  [${r.material}]  ${r.type}` +
        `${r.transparent ? ` 반투명(op ${r.opacity})` : ''}${r.renderOrder ? ` order ${r.renderOrder}` : ''}`);
  });
  if (LIST) {
    console.log('\n## 렌더 가능 객체 전수');
    for (const a of out.all) console.log(`  ${a.name}  [${a.material}]  ${a.type}${a.count !== undefined ? ` ×${a.count}` : ''}${a.note ? `  — ${a.note}` : ''}`);
  }
}
