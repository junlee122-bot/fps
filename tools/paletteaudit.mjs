#!/usr/bin/env node
/**
 * tools/paletteaudit.mjs — 팔레트 색역 게이트 (P3-BRIEF §4 + PATCH-007-C 자발광 밴드).
 *
 * 팔레트 규율은 절차적 생성의 약점을 감추는 주 수단이다 — 산문 규칙이 아니라
 * 수치 게이트로 강제한다. 캡처 PNG 디렉터리의 전 픽셀을 HSV로 변환해 검사한다.
 *
 * 허용 색역 (채도 ≥ 0.10인 픽셀만 대상):
 *   청+하늘 175°–240° / 적 355°–15° / 황 40°–60° / 목재·흙 20°–40°(채도 ≤0.35)
 *   중성(채도 <0.10)은 임의.
 * 샷당 위반율 > 1.5% → exit 1. 임계값을 올리지 마라 — 위반이 나오면 색을 고친다.
 *
 * [PATCH-007-C] 자발광·일시광 밴드 15°–55°: `<shot>.emask.png`(baseline.mjs 가 캡처마다 저장하는 태그 마스크 —
 *   등롱 점등·총구화염·예광 재질의 **가시 픽셀**, 규칙은 src/render/tagmask.js 한 곳)가 있으면 그 픽셀에만 15°–55° 를
 *   채도 무관 추가 허용한다. 태그되지 않은 픽셀(발광체가 비춘 목재, 블룸 헤일로 포함)에는 어떤 완화도 없다.
 *   샷당 태그 픽셀 비율 > 8% → exit 1 (발광체로 화면을 덮어 규율을 피하는 것을 막는 상한 — 올리지 마라).
 *   마스크가 없는 디렉토리(구 baseline)는 밴드 없이 종전 규칙만 적용하고 emissiveMask:'absent' 로 표식한다.
 *
 * 음성 훅 (HARNESS.md §0) — 전부 exit 코드와 별도로 testOverride 표식, 계약 판정 무효:
 *   --inject-patch          첫 샷 중앙에 자색(300°) 패치 3% → 반드시 exit 1 (harnesstest 케이스 12)
 *   --inject-orange         첫 샷 중앙에 주황(30°, s .8) 패치 3% 를 **비태그** 픽셀로(마스크 0 강제) → 반드시 exit 1 (케이스 20)
 *   --inject-orange-tagged  같은 패치를 **태그** 픽셀로(마스크 1 강제) → 밴드가 살아 있으면 패치는 위반이 아니다 (케이스 20 대조)
 *   --inject-mask-ratio R   첫 샷 마스크의 앞 R(0~1) 비율을 1로 강제 → R > 8% 이면 반드시 exit 1 (케이스 20 상한)
 *
 *   node tools/paletteaudit.mjs [dir=baseline] [--inject-patch|--inject-orange|--inject-orange-tagged|--inject-mask-ratio R]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const DIR = resolve(args._?.[0] ?? 'baseline');
const INJECT = args['inject-patch'] === true;
const INJECT_ORANGE = args['inject-orange'] === true;
const INJECT_ORANGE_TAGGED = args['inject-orange-tagged'] === true;
const INJECT_MASK_RATIO = args['inject-mask-ratio'] !== undefined ? Number(args['inject-mask-ratio']) : null;
const LIMIT_PCT = 1.5;
const EMISSIVE_LIMIT_PCT = 8;     // 태그 픽셀 비율 상한 (PATCH-007-C)
const EMISSIVE_BAND = [15, 55];   // 태그 픽셀 추가 허용 색상 (도)
const MASK_SUFFIX = '.emask.png';

if (INJECT_MASK_RATIO !== null && !(INJECT_MASK_RATIO >= 0 && INJECT_MASK_RATIO <= 1)) {
  console.error(`--inject-mask-ratio 는 0~1 (got ${args['inject-mask-ratio']})`);
  process.exit(2);
}

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
  return [h, s, v, d];
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

/** 태그(자발광·일시광) 픽셀 추가 허용 — 채도 무관 (PATCH-007-C) */
function emissiveAllowed(h) {
  return h >= EMISSIVE_BAND[0] && h <= EMISSIVE_BAND[1];
}

const allPngs = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
const files = allPngs.filter((f) => !f.endsWith(MASK_SUFFIX));
if (files.length === 0) {
  console.error(`no PNGs in ${DIR}`);
  process.exit(2);
}

/** 첫 샷 중앙 패치 — 픽셀 수의 3% (해상도 무관). 반환: 패치에 든 픽셀 인덱스 범위 콜백 */
function centerPatch(png, fn) {
  const half = Math.ceil(Math.sqrt(0.03 * png.width * png.height)) >> 1;
  const cx = png.width >> 1, cy = png.height >> 1;
  let n = 0;
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) { fn(y * png.width + x); n++; }
  }
  return n;
}

const shots = [];
let anyFail = false;
const overrides = [];
for (let fi = 0; fi < files.length; fi++) {
  const png = PNG.sync.read(readFileSync(join(DIR, files[fi])));
  const total = png.width * png.height;
  // 태그 마스크 — 같은 크기여야 한다 (다르면 도구 오류: 캡처와 마스크가 다른 조건)
  const maskPath = join(DIR, files[fi].replace(/\.png$/, MASK_SUFFIX));
  let mask = null; // Uint8Array(total) 0/1
  if (existsSync(maskPath)) {
    const mp = PNG.sync.read(readFileSync(maskPath));
    if (mp.width !== png.width || mp.height !== png.height) {
      console.error(`mask size mismatch: ${files[fi]} ${png.width}x${png.height} vs mask ${mp.width}x${mp.height}`);
      process.exit(2);
    }
    mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) mask[i] = mp.data[i * 4] > 127 ? 1 : 0;
  }
  const maskPresent = mask !== null;

  // ---- 음성 훅 (첫 샷만) ----
  let injectedPatchPixels = 0;
  if (fi === 0 && INJECT) {
    // 자색(300°) 패치 3% (고정 256²는 DPR2 드로잉 버퍼 3024×1964에서 1.1%로 LIMIT 미만이 된다)
    injectedPatchPixels = centerPatch(png, (i) => { png.data[i * 4] = 200; png.data[i * 4 + 1] = 40; png.data[i * 4 + 2] = 200; });
    overrides.push('inject-patch(자색 300°) — harnesstest 전용, 계약 판정 무효');
  }
  if (fi === 0 && (INJECT_ORANGE || INJECT_ORANGE_TAGGED)) {
    // 주황 30°, s .8, v .5 — 종전 규칙으로는 위반(목재 대역 채도 초과), 자발광 밴드(15–55°)로는 허용
    if (!mask) mask = new Uint8Array(total);
    const tagVal = INJECT_ORANGE_TAGGED ? 1 : 0;
    injectedPatchPixels = centerPatch(png, (i) => { png.data[i * 4] = 128; png.data[i * 4 + 1] = 77; png.data[i * 4 + 2] = 26; mask[i] = tagVal; });
    overrides.push(INJECT_ORANGE_TAGGED
      ? 'inject-orange-tagged(주황 30° 패치, 마스크 1 강제) — harnesstest 전용, 계약 판정 무효'
      : 'inject-orange(주황 30° 패치, 마스크 0 강제) — harnesstest 전용, 계약 판정 무효');
  }
  if (fi === 0 && INJECT_MASK_RATIO !== null) {
    if (!mask) mask = new Uint8Array(total);
    const n = Math.floor(INJECT_MASK_RATIO * total);
    for (let i = 0; i < n; i++) mask[i] = 1;
    overrides.push(`inject-mask-ratio(${INJECT_MASK_RATIO}) — harnesstest 전용, 계약 판정 무효`);
  }

  let violations = 0;
  let violationsNoFloor = 0; // 제외·밴드 미적용 참조치 — 투명성 병기 (게이트 아님)
  let quantExcluded = 0;
  let taggedPixels = 0;
  let exemptedByEmissiveBand = 0; // 종전 규칙 위반이나 태그+밴드로 허용된 픽셀
  let taggedViolations = 0;       // 태그 픽셀인데 밴드로도 허용되지 않은 위반 (예: 자홍 발광)
  const histo = new Array(36).fill(0); // 위반 픽셀 색상 10° 버킷
  for (let p = 0, i = 0; i < png.data.length; i += 4, p++) {
    const tagged = mask ? mask[p] === 1 : false;
    if (tagged) taggedPixels++;
    const [h, s, , d] = rgbToHsv(png.data[i], png.data[i + 1], png.data[i + 2]);
    if (!allowed(h, s)) {
      violationsNoFloor++;
      // 양자화 잡음 제외 (C2 교정 — CONTRACT-NOTES): 제외 기준은 명도(V)가 아니라
      // **크로마 d=max−min ≤ 2양자**다. 크로마 ≤2/255에선 색상·채도가 반올림 산물이라
      // 무의미하고, 크로마 ≥3인 어두운 픽셀(암부 자홍 등)은 실색이므로 검사한다.
      // (C1의 V<0.10 하한은 야간 프레임 13%를 색상 무관 블라인드스팟으로 만들었다.)
      // LIMIT(1.5%)는 불변.
      if (d <= 2) { quantExcluded++; continue; }
      if (tagged && emissiveAllowed(h)) { exemptedByEmissiveBand++; continue; } // PATCH-007-C — 태그 픽셀만
      if (tagged) taggedViolations++;
      violations++;
      histo[Math.min(35, Math.floor(h / 10))]++;
    }
  }
  const pct = (violations / total) * 100;
  const pctNoFloor = (violationsNoFloor / total) * 100;
  const emissivePct = (taggedPixels / total) * 100;
  const topHues = histo
    .map((n, b) => ({ hue: `${b * 10}–${b * 10 + 10}°`, n }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const paletteOk = pct <= LIMIT_PCT;
  const emissiveOk = emissivePct <= EMISSIVE_LIMIT_PCT;
  const ok = paletteOk && emissiveOk;
  if (!ok) anyFail = true;
  shots.push({
    shot: files[fi], violationPct: +pct.toFixed(4), ok,
    violationPctNoFloor_reference: +pctNoFloor.toFixed(4), // 양자화 제외·자발광 밴드 미적용 참조치
    quantExcluded,
    examinedPct: +((100 * (total - quantExcluded)) / total).toFixed(2),
    topViolationHues: topHues,
    // PATCH-007-C
    emissiveMask: maskPresent ? 'present' : 'absent',
    emissivePct: +emissivePct.toFixed(4), emissiveOk,
    exemptedByEmissiveBand, taggedViolations,
    ...(injectedPatchPixels ? { injectedPatchPixels } : {}),
  });
}

const report = {
  ok: !anyFail,
  dir: DIR,
  limitPct: LIMIT_PCT,
  emissiveLimitPct: EMISSIVE_LIMIT_PCT,
  emissiveBandDeg: EMISSIVE_BAND,
  ...(overrides.length ? { testOverride: overrides.join(' + ') } : {}),
  shots,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
