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
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? true]; }));

if (positional.length < 2) {
  console.error('usage: node tools/imagediff.mjs <dirA> <dirB> [--tolerance=0] [--diffdir=tmp/diff]');
  process.exit(2);
}
const A = resolve(positional[0]);
const B = resolve(positional[1]);
const TOL = Number(flags.tolerance ?? 0);
const DIFFDIR = resolve(flags.diffdir ?? 'tmp/diff');

const namesA = readdirSync(A).filter((f) => f.endsWith('.png')).sort();
const namesB = new Set(readdirSync(B).filter((f) => f.endsWith('.png')));
const rows = [];
let fail = false;

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
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2])
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
console.log(JSON.stringify({ a: A, b: B, tolerance: TOL, identical, rows }, null, 2));
process.exit(identical ? 0 : 1);
