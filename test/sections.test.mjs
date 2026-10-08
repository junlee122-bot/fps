/**
 * test/sections.test.mjs — 절 부분 실행 규칙 (P4B 설계서 §10-5 playtest 행 `--section`, 재검토 #3 · PATCH-001-C).
 *
 * 검사:
 *  1. 양성 — 무인자 = 전 절·무표식, 훅만 = 전 절 + 훅 표식, 훅 + 겨냥 절 = 그 절만 + 훅·부분 실행 표식.
 *  2. 음성 — 훅 없는 --section, 미지 절, 값 없는 --section, 훅의 겨냥 절과 다른 절 → 인자 오류(exit 2).
 *  3. 표 무결성 — 겨냥 절이 순서에 없는 훅 표는 throw.
 *  4. CLI — playtest 가 실제로 이 규칙으로 exit 2 를 내고 브라우저를 띄우지 않는다(JSON 미출력 = 실행 전 종료).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { resolveSections, EXIT_ARG_ERROR } from '../tools/lib/sections.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ORDER = ['alpha', 'beta'];
const INJECTS = {
  'inject-a': { section: 'alpha', marker: 'inject-a(훅 A)' },
  'inject-b': { section: 'beta', marker: 'inject-b(훅 B)' },
};
const SUFFIX = '계약 판정 무효';
/** CLI 종료 상한 — 규칙이 깨져 브라우저가 뜨면 이 안에 끝나지 않으므로 실패로 드러난다(판정 임계 아님) */
const CLI_TIMEOUT_MS = 60000;

test('양성: 무인자 = 전 절 · 무표식', () => {
  const r = resolveSections({ _: [] }, ORDER, INJECTS, SUFFIX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sections, ORDER);
  assert.equal(r.section, undefined);
  assert.equal(r.testOverride, undefined);
  assert.deepEqual(r.activeInjects, []);
});

test('양성: 훅만 = 전 절 + 훅 표식 (부분 실행 표식 없음)', () => {
  const r = resolveSections({ _: [], 'inject-b': true }, ORDER, INJECTS, SUFFIX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sections, ORDER);
  assert.equal(r.testOverride, `inject-b(훅 B) — ${SUFFIX}`);
  assert.ok(!r.testOverride.includes('section='));
});

test('양성: 훅 + 겨냥 절 = 그 절만 + 훅·부분 실행 표식', () => {
  const r = resolveSections({ _: [], 'inject-a': true, section: 'alpha' }, ORDER, INJECTS, SUFFIX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sections, ['alpha']);
  assert.equal(r.section, 'alpha');
  assert.ok(r.testOverride.includes('inject-a(훅 A)'));
  assert.ok(r.testOverride.includes('section=alpha'));
  assert.ok(r.testOverride.endsWith(SUFFIX));
});

test('음성: 훅 없는 --section · 미지 절 · 값 없는 --section · 겨냥 절 불일치 → 인자 오류', () => {
  const cases = [
    [{ _: [], section: 'alpha' }, /--inject-\* 와 함께만/],
    [{ _: [], section: 'gamma', 'inject-a': true }, /중 하나여야/],
    [{ _: [], section: true, 'inject-a': true }, /중 하나여야/],
    [{ _: [], section: 'beta', 'inject-a': true }, /--inject-a\(겨냥 절 alpha\)/],
    [{ _: [], section: 'alpha', 'inject-a': true, 'inject-b': true }, /--inject-b\(겨냥 절 beta\)/],
  ];
  assert.ok(cases.length >= 1);
  for (const [args, re] of cases) {
    const r = resolveSections(args, ORDER, INJECTS, SUFFIX);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.equal(r.exitCode, EXIT_ARG_ERROR);
    assert.match(r.error, re);
  }
});

test('표 무결성: 겨냥 절이 순서에 없는 훅은 throw', () => {
  assert.throws(() => resolveSections({ _: [] }, ORDER, { 'inject-x': { section: 'nowhere', marker: 'x' } }, SUFFIX), /절 순서에 없다/);
});

test('CLI: playtest 는 규칙 위반 인자에 exit 2 — 브라우저를 띄우기 전에 끝난다', () => {
  const runs = [
    { argv: ['--section', 'p4b-exposure'], re: /--inject-\* 와 함께만/ },
    { argv: ['--section', 'core', '--inject-exposure-drift'], re: /겨냥 절 p4b-exposure/ },
    { argv: ['--section', 'p4b-exposure', '--inject-no-holes'], re: /겨냥 절 core/ },
    { argv: ['--section', 'nope', '--inject-exposure-drift'], re: /중 하나여야/ },
  ];
  assert.ok(runs.length >= 1);
  for (const { argv, re } of runs) {
    const r = spawnSync('node', ['tools/playtest.mjs', ...argv], { cwd: ROOT, encoding: 'utf8', timeout: CLI_TIMEOUT_MS });
    assert.equal(r.status, EXIT_ARG_ERROR, `${argv.join(' ')}: exit ${r.status} (stderr ${r.stderr.slice(-200)})`);
    assert.match(r.stderr, re, argv.join(' '));
    assert.equal(r.stdout.trim(), '', '판정 JSON 이 나왔다 — 실행 전에 끝나지 않았다');
  }
});
