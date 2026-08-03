#!/usr/bin/env node
/**
 * tools/determinismaudit.mjs — 결정성 정적 게이트 (PATCH-004-B 조치 2).
 *
 * 검사 1 — src/**: Math.random · performance.now · Date.now · new Date 직접 호출.
 *   예외 스코프(허용 목록 아님 — 파일 역할 자체가 해당 API의 소유자):
 *   - core/clock.js      : 벽시계의 유일한 소유자
 *   - core/determinism.js: Math.random 트랩 자신
 *   그 외 1건이라도 발견 시 exit 1. 파일·행·컨텍스트 출력.
 *
 * 검사 2 — 서드파티 표면(three/addons 전이 임포트): 동일 패턴 + `= Math`
 *   기본 인자 앨리어싱(GTAOPass의 SimplexNoise(r = Math) 재발 클래스).
 *   발견 자체는 exit 사유가 아니다 — 대신 **런타임 완화가 장착되어 있는지**를
 *   검증한다: main.js의 armCaptureDeterminism() 배선이 없으면 exit 1.
 *   (근거: three 코어 generateUUID가 Math.random을 쓰므로 서드파티 발견을
 *   전부 금지하면 three 자체가 금지된다. 정적 게이트는 조기 경보,
 *   구조 보증은 고정 시드 트랩이 담당 — CONTRACT-NOTES P3 판정.)
 *
 * --inject-test: 가상 위반 소스를 검사 대상에 합성 주입 (harnesstest 케이스 14
 *   전용 — PATCH-003-B 음성 테스트 원칙). 계약 판정에 쓰지 마라.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const INJECT = !!args['inject-test'];
const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** 시간·난수 직접 호출 패턴 (주석 행 제외 후 매칭) */
const PATTERNS = [
  { re: /Math\.random\s*\(/, tag: 'Math.random' },
  { re: /performance\.now\s*\(/, tag: 'performance.now' },
  { re: /\bDate\.now\s*\(/, tag: 'Date.now' },
  { re: /new\s+Date\s*\(/, tag: 'new Date' },
];
const ALIAS_PATTERN = { re: /=\s*Math\b(?!\.)/, tag: 'Math 앨리어싱 (r = Math)' };

/** 파일 역할상 해당 API를 소유하는 스코프 (허용 목록 아님 — 구조적 예외) */
const OWNER_SCOPES = new Set(['core/clock.js', 'core/determinism.js']);

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

function stripComments(line) {
  // 행 주석·블록 주석 시작 이후는 매칭 제외 (간이 — 문자열 내 // 는 드물고
  // 위양성은 사람이 컨텍스트로 판별)
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

function scanSource(text, relPath, patterns) {
  const hits = [];
  const lines = text.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const blockStart = line.indexOf('/*');
    if (blockStart >= 0 && line.indexOf('*/', blockStart) < 0) {
      line = line.slice(0, blockStart);
      inBlock = true;
    }
    const code = stripComments(line);
    for (const p of patterns) {
      if (p.re.test(code)) hits.push({ file: relPath, line: i + 1, tag: p.tag, context: lines[i].trim().slice(0, 120) });
    }
  }
  return hits;
}

/* ---- 검사 1: src/ ---- */
const srcHits = [];
for (const f of walk(SRC)) {
  const rel = f.slice(SRC.length + 1).replaceAll('\\', '/');
  if (OWNER_SCOPES.has(rel)) continue;
  srcHits.push(...scanSource(readFileSync(f, 'utf8'), `src/${rel}`, PATTERNS));
}
if (INJECT) {
  srcHits.push(...scanSource(
    'export function evil() {\n  return Math.random() * 2;\n}\n',
    'src/__inject_test__.js', PATTERNS,
  ));
}

/* ---- 검사 2: three/addons 전이 임포트 표면 ---- */
const addonFiles = new Set();
const queue = [];
for (const f of walk(SRC)) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) {
    queue.push(join(ROOT, 'node_modules/three/examples/jsm', m[1]));
  }
}
while (queue.length) {
  const p = queue.pop();
  if (addonFiles.has(p)) continue;
  addonFiles.add(p);
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    queue.push(resolve(dirname(p), m[1].endsWith('.js') ? m[1] : `${m[1]}.js`));
  }
}
const addonHits = [];
for (const p of addonFiles) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { continue; }
  const rel = p.slice(ROOT.length + 1).replaceAll('\\', '/');
  addonHits.push(...scanSource(text, rel, [...PATTERNS, ALIAS_PATTERN]));
}

/* ---- 런타임 완화 장착 검증 (서드파티 발견이 있을 때 필수) ---- */
const mainText = readFileSync(join(SRC, 'main.js'), 'utf8');
const trapArmed = /armCaptureDeterminism\s*\(\s*\)/.test(mainText);

const report = {
  ok: true,
  ...(INJECT ? { testOverride: 'inject-test(가상 위반 소스) — harnesstest 전용, 계약 판정 무효' } : {}),
  srcViolations: srcHits,
  thirdPartySurface: {
    filesScanned: addonFiles.size,
    findings: addonHits,
    runtimeTrapArmed: trapArmed,
  },
};
if (srcHits.length > 0) report.ok = false;
if (addonHits.length > 0 && !trapArmed) {
  report.ok = false;
  report.reason = '서드파티 난수·시간 사용 발견 + 런타임 트랩 미장착 (armCaptureDeterminism 배선 없음)';
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
