#!/usr/bin/env node
/**
 * tools/paletteaudit.mjs — 팔레트 색역 게이트 (P3-BRIEF §4).
 *
 * 팔레트 규율은 절차적 생성의 약점을 감추는 주 수단이다 — 산문 규칙이 아니라
 * 수치 게이트로 강제한다. 캡처 PNG 디렉터리의 전 픽셀을 HSV로 변환해 검사한다.
 *
 * 허용 색역 (채도 ≥ 0.10인 픽셀만 대상):
 *   청+하늘 175°–240° / 적 355°–15° / 황 40°–60° / 목재·흙 20°–40°(채도 ≤0.35)
 *   중성(채도 <0.10)은 임의.
 * 샷당 위반율 > 1.5% → exit 1. 임계값을 올리지 마라 — 위반이 나오면 색을 고친다.
 *
 * 음성 훅 (HARNESS.md §0): --inject-patch 는 첫 샷에 자색(300°) 패치를 합성
 * 주입한 입력 — 반드시 exit 1 + testOverride 표식 (harnesstest 케이스 12).
 *
 *   node tools/paletteaudit.mjs [dir=baseline] [--inject-patch]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const DIR = resolve(args._?.[0] ?? 'baseline');
const INJECT = args['inject-patch'] === true;
const LIMIT_PCT = 1.5;

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

/** 허용 판정 — §4 표 그대로 */
function allowed(h, s) {
  if (s < 0.10) return true;                       // 중성
  if (h >= 175 && h <= 240) return true;           // 청 + 하늘
  if (h >= 355 || h <= 15) return true;            // 적
  if (h >= 40 && h <= 60) return true;             // 황
  if (h >= 20 && h < 40 && s <= 0.35) return true; // 목재·흙 (저채도만)
  return false;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
if (files.length === 0) {
  console.error(`no PNGs in ${DIR}`);
  process.exit(2);
}

const shots = [];
let anyFail = false;
for (let fi = 0; fi < files.length; fi++) {
  const png = PNG.sync.read(readFileSync(join(DIR, files[fi])));
  // 음성 훅: 첫 샷 중앙에 128×128 자색(300°) 패치 합성 주입
  if (INJECT && fi === 0) {
    const cx = png.width >> 1, cy = png.height >> 1;
    for (let y = cy - 64; y < cy + 64; y++) {
      for (let x = cx - 64; x < cx + 64; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = 200; png.data[i + 1] = 40; png.data[i + 2] = 200;
      }
    }
  }
  let violations = 0;
  const total = png.width * png.height;
  const histo = new Array(36).fill(0); // 위반 픽셀 색상 10° 버킷
  for (let i = 0; i < png.data.length; i += 4) {
    const [h, s] = rgbToHsv(png.data[i], png.data[i + 1], png.data[i + 2]);
    if (!allowed(h, s)) {
      violations++;
      histo[Math.min(35, Math.floor(h / 10))]++;
    }
  }
  const pct = (violations / total) * 100;
  const topHues = histo
    .map((n, b) => ({ hue: `${b * 10}–${b * 10 + 10}°`, n }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const ok = pct <= LIMIT_PCT;
  if (!ok) anyFail = true;
  shots.push({ shot: files[fi], violationPct: +pct.toFixed(4), ok, topViolationHues: topHues });
}

const report = {
  ok: !anyFail,
  dir: DIR,
  limitPct: LIMIT_PCT,
  ...(INJECT ? { testOverride: 'inject-patch(자색 300°) — harnesstest 전용, 계약 판정 무효' } : {}),
  shots,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
