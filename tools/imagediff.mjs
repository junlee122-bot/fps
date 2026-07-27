#!/usr/bin/env node
/**
 * tools/imagediff.mjs — 픽셀 게이트.
 *
 * 기본 tolerance 0. 픽셀 하나라도 다르면 exit 1 (HARNESS.md §4).
 * tolerance를 올리지 마라 — 최적화 패스의 "시각적 변화 없음"은
 * 이 도구의 exit 0으로만 증명된다.
 *
 *   node tools/imagediff.mjs <dirA> <dirB> [--tolerance=0] [--diffdir=tmp/diff]
 */

import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { SHOTS } from './shots.js';

const flags = parseArgs();
const positional = flags._;

if (positional.length < 2) {
  console.error('usage: node tools/imagediff.mjs <dirA> <dirB> [--tolerance 0] [--diffdir tmp/diff] [--partial]');
  process.exit(2);
}
const A = resolve(positional[0]);
const B = resolve(positional[1]);
// 값 없는 --tolerance(불리언 true)까지 거부 — Number(true)=1로 게이트가 약화된다 (감사 B2)
const TOL = flags.tolerance === undefined ? 0 : (typeof flags.tolerance === 'string' ? Number(flags.tolerance) : NaN);
if (!Number.isFinite(TOL) || TOL < 0) {
  console.error(`invalid --tolerance: ${flags.tolerance} (값을 명시하라, 예: --tolerance 0)`);
  process.exit(2);
}
/** 기본은 계약 11샷 전수 요구. --partial은 부분 비교 허용(비계약 — 게이트로 쓰지 말 것) */
const PARTIAL = flags.partial === true;
const DIFFDIR = resolve(flags.diffdir ?? 'tmp/diff');

const namesA = readdirSync(A).filter((f) => f.endsWith('.png')).sort();
const namesB = new Set(readdirSync(B).filter((f) => f.endsWith('.png')));
const rows = [];
let fail = false;

// 공허 통과 차단 (감사 B4): 기본 모드에서는 계약 11샷이 양쪽에 전부 있어야 한다.
if (!PARTIAL) {
  for (const s of SHOTS) {
    const f = `${s.name}.png`;
    if (!namesA.includes(f)) { rows.push({ shot: f, status: 'CONTRACT_SHOT_MISSING_IN_A' }); fail = true; }
    if (!namesB.has(f)) { rows.push({ shot: f, status: 'CONTRACT_SHOT_MISSING_IN_B' }); fail = true; }
  }
} else if (namesA.length === 0) {
  console.error('no PNGs to compare in A — 공허 통과 거부');
  process.exit(2);
}

for (const n of namesA) {
  if (!namesB.has(n)) {
    rows.push({ shot: n, status: 'MISSING_IN_B' });
    fail = true;
    continue;
  }
  namesB.delete(n);
  const a = PNG.sync.read(readFileSync(join(A, n)));
  const b = PNG.sync.read(readFileSync(join(B, n)));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push({ shot: n, status: 'SIZE_MISMATCH', a: `${a.width}x${a.height}`, b: `${b.width}x${b.height}` });
    fail = true;
    continue;
  }
  let diffPx = 0, maxD = 0, sum = 0;
  const total = a.width * a.height;
  let diff = null;
  for (let i = 0; i < a.data.length; i += 4) {
    // 알파 포함 4채널 — "픽셀 하나라도 다르면"의 문자 그대로 (감사 B8)
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
      Math.abs(a.data[i + 3] - b.data[i + 3])
    );
    sum += d;
    if (d > maxD) maxD = d;
    if (d > TOL) {
      if (diffPx === 0) {
        // 첫 불일치에서 차분 이미지 준비 (변경 픽셀 = 마젠타, 나머지 = 원본 감광)
        diff = new PNG({ width: a.width, height: a.height });
        for (let j = 0; j < a.data.length; j += 4) {
          diff.data[j] = a.data[j] >> 2;
          diff.data[j + 1] = a.data[j + 1] >> 2;
          diff.data[j + 2] = a.data[j + 2] >> 2;
          diff.data[j + 3] = 255;
        }
      }
      diff.data[i] = 255;
      diff.data[i + 1] = 0;
      diff.data[i + 2] = 255;
      diffPx++;
    }
  }
  const row = {
    shot: n,
    changedPx: diffPx,
    changedPct: +((diffPx / total) * 100).toFixed(4),
    maxDelta: maxD,
    meanDelta: +(sum / total).toFixed(4),
  };
  if (diffPx > 0) {
    fail = true;
    mkdirSync(DIFFDIR, { recursive: true });
    const diffPath = join(DIFFDIR, n.replace('.png', '.diff.png'));
    writeFileSync(diffPath, PNG.sync.write(diff));
    row.diff = diffPath;
  }
  rows.push(row);
}
for (const n of namesB) {
  rows.push({ shot: n, status: 'MISSING_IN_A' });
  fail = true;
}

const identical = !fail;
console.log(JSON.stringify({ a: A, b: B, tolerance: TOL, partial: PARTIAL, identical, rows }, null, 2));
process.exit(identical ? 0 : 1);
