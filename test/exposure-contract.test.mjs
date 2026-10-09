/**
 * test/exposure-contract.test.mjs — 노출 계약 구조 동결 (P4B 설계서 §9-4 방법 3, 단계 1).
 *
 * 검사:
 *  1. 깊은 동결 — 모든 중첩 노드에서 대입·추가가 throw(엄격 문맥), 비엄격 문맥에서는 조용히 무시되고 값 불변.
 *  2. 셰이더에 계약 유도 상수 — 템플릿 상수마다 값을 바꾸면 셰이더가 바뀌고(비공허), 바뀐 값이 제자리에 들어간다.
 *  3. 계약 키 근처 떠도는 리터럴 0 — 정규식 검출기가 exposure.js·pipeline.js 에서 0건이고, 검출기 자체의 합성 음성
 *     (규칙마다 리터럴을 되돌린 사본)을 전부 잡는다.
 *  4. 계약 해시 = CONTRACT-NOTES 기록, 해시는 값 변화에 반응하고 키 순서에 무관.
 *  5. ExposureMeter 런타임 일치 검사 — 가짜 blit 으로 그리기 시점 기록·드리프트 음성(케이스 30 의 노드판)·testOverride 층·
 *     잠금·셰이더 문자열 변조·그리기 기록 없음을 잡는다. "현재 유니폼 대 계약"이 아니라 그리기 시점 값을 본다는 것도 검사한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXPOSURE_CONTRACT, exposureContractHash, canonicalJson } from '../src/render/exposure-contract.js';
import {
  ExposureMeter, buildExposureShaders, flattenContract, EXPOSURE_UNIFORM_KEYS, EXPOSURE_TEMPLATE_KEYS, EC_DRAW_PASSES,
} from '../src/render/exposure.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
/** GLSL 실수 표기(exposure.js 와 같은 규칙) — 기대 문자열을 계약 값에서 유도한다(리터럴 하드코딩 금지) */
const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ 1. 깊은 동결 */

test('계약은 깊게 얼어 있다 — 모든 중첩 노드 대입·추가 throw (엄격), 비엄격에서는 조용히 무시', () => {
  const nodes = [];
  (function walk(o, path) {
    if (o && typeof o === 'object') { nodes.push([path, o]); for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`); }
  })(EXPOSURE_CONTRACT, 'EXPOSURE_CONTRACT');
  // 비공허: 루트 + range·speed·metering·provenance·evidence 배열 ≥ 6 노드
  assert.ok(nodes.length >= 6, `얼어 있어야 할 노드 수 ${nodes.length}`);
  for (const [path, o] of nodes) {
    assert.ok(Object.isFrozen(o), `${path} 가 얼어 있지 않다`);
    assert.throws(() => { o.__harnesstest_new = 1; }, TypeError, `${path} 에 키 추가가 throw 하지 않았다`);
  }
  assert.throws(() => { EXPOSURE_CONTRACT.speed.rateUp = 9; }, TypeError);
  assert.throws(() => { EXPOSURE_CONTRACT.version = 2; }, TypeError);
  assert.throws(() => { EXPOSURE_CONTRACT.provenance.evidence.push('x'); }, TypeError);
  // 비엄격 문맥(page.evaluate 의 호출자 코드와 같은 조건) — TypeError 없이 무시되고 값은 그대로(설계서 §9-2, 재검토 #11 정정)
  const sloppy = new Function('o', 'o.speed.rateUp = 9; return o.speed.rateUp;');
  assert.equal(sloppy(EXPOSURE_CONTRACT), flattenContract().rateUp);
});

test('평탄 뷰는 계약과 같은 값이고 얼어 있다 — 키 표 두 개가 계약의 모든 수치 잎을 덮는다', () => {
  const flat = flattenContract();
  assert.ok(Object.isFrozen(flat));
  const leaves = [];
  for (const grp of ['range', 'speed', 'metering']) for (const k of Object.keys(EXPOSURE_CONTRACT[grp])) leaves.push(`${grp}.${k}`);
  const covered = [...Object.values(EXPOSURE_UNIFORM_KEYS), ...Object.values(EXPOSURE_TEMPLATE_KEYS)].map(([g, k]) => `${g}.${k}`);
  assert.ok(leaves.length >= 1);
  assert.deepEqual([...covered].sort(), [...leaves].sort(), '계약 잎과 키 표가 어긋남 — 새 키가 유니폼/템플릿 어느 쪽에도 배선되지 않았다');
  for (const [name, [g, k]] of Object.entries({ ...EXPOSURE_UNIFORM_KEYS, ...EXPOSURE_TEMPLATE_KEYS })) {
    assert.equal(flat[name], EXPOSURE_CONTRACT[g][k], name);
  }
});

test('ExposureMeter 는 params 주입을 거부한다 (단일 출처, §9-2)', () => {
  assert.throws(() => new ExposureMeter({ renderer: null, blit: () => {}, params: { rateUp: 9 } }), /params 인자는 폐지/);
});

/* ------------------------------------------------------------- 2. 셰이더 템플릿 */

test('셰이더에 계약 유도 상수가 제자리에 들어간다', () => {
  const p = flattenContract();
  const sh = buildExposureShaders();
  const cells = p.meterN / p.reduceN;
  assert.ok(sh.meter.includes(`vUv - 0.5 / ${f(p.meterN)};`));
  assert.ok(sh.meter.includes(`j < ${p.tapsPerAxis}; j++`));
  assert.ok(sh.meter.includes(`/ (${f(p.meterN)} * ${f(p.tapsPerAxis)})`));
  assert.ok(sh.meter.includes(`sum / ${f(p.tapsPerAxis * p.tapsPerAxis)},`));
  assert.ok(sh.reduce.includes(`vUv - 0.5 / ${f(p.reduceN)};`));
  assert.ok(sh.reduce.includes(`j < ${cells}; j++`));
  assert.ok(sh.reduce.includes(`/ (${f(p.reduceN)} * ${f(cells)})`));
  assert.ok(sh.adapt.includes(`j < ${p.reduceN}; j++`));
  assert.ok(sh.adapt.includes(`+ 0.5) / ${f(p.reduceN)}).rg`));
  assert.ok(sh.adapt.includes(`log2(${f(p.k)} * lavg)`));
  assert.ok(sh.adapt.includes(`evMin - ${f(p.floorOffset)}, evMax`));
  // 측정 잠금은 ADAPT 유니폼(프로그램 수 불변, §9-5)
  assert.match(sh.adapt, /uniform float [^;]*\blockOn\b[^;]*\blockEv\b/);
  assert.ok(sh.adapt.includes('if (lockOn > 0.5) ev = lockEv;'));
});

test('템플릿 상수마다 값을 바꾸면 셰이더가 바뀌고 새 값이 들어간다 (비공허 — 리터럴로 남은 자리 0)', () => {
  const base = buildExposureShaders();
  const alt = { floorOffset: 2.5, k: 7, meterN: 128, reduceN: 16, tapsPerAxis: 3 };
  const keys = Object.keys(EXPOSURE_TEMPLATE_KEYS);
  assert.ok(keys.length >= 1);
  assert.deepEqual([...keys].sort(), Object.keys(alt).sort(), '대체값 표가 템플릿 키와 어긋남');
  for (const name of keys) {
    const [g, k] = EXPOSURE_TEMPLATE_KEYS[name];
    const c = clone(EXPOSURE_CONTRACT);
    c[g][k] = alt[name];
    const sh = buildExposureShaders(c);
    const changed = ['meter', 'reduce', 'adapt'].filter((s) => sh[s] !== base[s]);
    assert.ok(changed.length >= 1, `${name} 를 바꿔도 셰이더가 그대로 — 템플릿에 배선되지 않았다`);
  }
  // 바뀐 값이 제자리에 (원래 값이 그 자리에 남아 있지 않다)
  const p = flattenContract();
  const c = clone(EXPOSURE_CONTRACT);
  c.metering.k = alt.k; c.range.floorOffset = alt.floorOffset; c.metering.tapsPerAxis = alt.tapsPerAxis;
  const sh = buildExposureShaders(c);
  assert.ok(sh.adapt.includes(`log2(${f(alt.k)} * lavg)`) && !sh.adapt.includes(`log2(${f(p.k)} * lavg)`));
  assert.ok(sh.adapt.includes(`evMin - ${f(alt.floorOffset)},`) && !sh.adapt.includes(`evMin - ${f(p.floorOffset)},`));
  assert.ok(sh.meter.includes(`sum / ${f(alt.tapsPerAxis ** 2)},`) && !sh.meter.includes(`sum / ${f(p.tapsPerAxis ** 2)},`));
  assert.ok(sh.meter.includes(`j < ${alt.tapsPerAxis}; j++) for (int i = 0; i < ${alt.tapsPerAxis};`));
  assert.ok(!sh.meter.includes(`< ${p.tapsPerAxis};`), '탭 루프 상한 중 계약에서 오지 않은 리터럴이 남았다');
});

test('셰이더 빌더는 템플릿에 쓸 수 없는 계약을 거부한다', () => {
  const bad = (mut) => { const c = clone(EXPOSURE_CONTRACT); mut(c); return () => buildExposureShaders(c); };
  assert.throws(bad((c) => { c.metering.meterN = 60; }), /배수가 아니다/);      // 셀 수가 정수가 아니다
  assert.throws(bad((c) => { c.metering.tapsPerAxis = 2.5; }), /양의 정수/);    // GLSL 루프 상한
  assert.throws(bad((c) => { c.metering.k = 1e-7; }), /GLSL 실수 리터럴/);       // 지수 표기
  assert.throws(bad((c) => { c.speed.rateUp = Number.NaN; }), /유한수/);
});

/* -------------------------------------------------- 3. 떠도는 리터럴 검출기 + 합성 음성 */

/** 계약 키(평탄 이름) + 종전 별칭 — "키 근처 리터럴"의 키 */
const KEYS = [...Object.keys(EXPOSURE_UNIFORM_KEYS), ...Object.keys(EXPOSURE_TEMPLATE_KEYS), 'METER_N', 'REDUCE_N'];
const K = `(?:${KEYS.join('|')})`;
const NUM = '[-+]?(?:\\d|\\.\\d)';
/**
 * 규칙(주석 제거 뒤 원문에 적용 — 템플릿 `${…}` 자리는 숫자가 아니므로 걸리지 않는다):
 *  A 키: 리터럴          `rateUp: 3.0`, `evMin: { value: 1.0 }`
 *  B 키 연산 리터럴      `evMin - 3.0`, `0.35 * centerWeight`
 *  C 목표식 계수          `log2(8.0 * …)` (k)
 *  D GLSL 루프 상한 리터럴 `j < 4;` (탭·셀·축소 격자) — exposure.js 전용(미터 셰이더의 모든 루프는 격자에서 온다)
 *  E 격자 나눗셈 리터럴    `/ 16.0`, `/ (64.0 * …)` — exposure.js 전용
 *  F 키 대입 리터럴        `ec.value = 1.0`, `rateUp = 9`
 */
const RULES = [
  { id: 'A', re: new RegExp(`\\b${K}\\b\\s*:\\s*(?:\\{\\s*value\\s*:\\s*)?${NUM}`, 'g') },
  { id: 'B', re: new RegExp(`\\b${K}\\b\\s*[-+*/]\\s*${NUM}|(?<![\\w.])(?:\\d+\\.?\\d*|\\.\\d+)\\s*[-+*/]\\s*\\b${K}\\b`, 'g') },
  { id: 'C', re: /log2\(\s*(?:\d|\.\d)/g },
  { id: 'D', re: /<\s*\d+\s*;/g, only: 'src/render/exposure.js' },
  { id: 'E', re: /\/\s*\(?\s*\d+\.0\b/g, only: 'src/render/exposure.js' },
  { id: 'F', re: new RegExp(`\\b${K}\\b(?:\\.value)?\\s*=(?!=)\\s*${NUM}`, 'g') },
];
const SCANNED = ['src/render/exposure.js', 'src/render/pipeline.js'];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function floatingLiterals(src, file) {
  const code = stripComments(src);
  const hits = [];
  for (const r of RULES) {
    if (r.only && r.only !== file) continue;
    for (const m of code.matchAll(r.re)) hits.push({ rule: r.id, text: m[0], at: m.index });
  }
  return hits;
}
const keyOccurrences = (src) => [...stripComments(src).matchAll(new RegExp(`\\b${K}\\b`, 'g'))].length;

test('계약 키 근처 떠도는 리터럴 0 — exposure.js · pipeline.js (비공허: 키 출현 ≥ 1)', () => {
  for (const file of SCANNED) {
    const src = read(file);
    assert.ok(keyOccurrences(src) >= 1, `${file}: 검사할 키 출현이 없다 — 검출기가 아무것도 보지 않았다`);
    const hits = floatingLiterals(src, file);
    assert.deepEqual(hits, [], `${file}: 계약 키 근처 리터럴 ${JSON.stringify(hits)}`);
  }
  assert.ok(!/EXPOSURE_PARAMS/.test(stripComments(read('src/render/pipeline.js'))), 'EXPOSURE_PARAMS 가 되살아났다 (단일 출처 위반)');
});

test('검출기 합성 음성 — 규칙마다 리터럴을 되돌린 사본을 잡는다', () => {
  const p = flattenContract();
  const ex = read('src/render/exposure.js'), pl = read('src/render/pipeline.js');
  const cases = [
    { file: 'src/render/exposure.js', src: ex, from: 'rateUp: { value: p.rateUp }', to: `rateUp: { value: ${f(p.rateUp)} }`, rule: 'A' },
    { file: 'src/render/exposure.js', src: ex, from: 'evMin - ${glslFloat(p.floorOffset)}', to: `evMin - ${f(p.floorOffset)}`, rule: 'B' },
    { file: 'src/render/exposure.js', src: ex, from: 'log2(${glslFloat(p.k)} * lavg)', to: `log2(${f(p.k)} * lavg)`, rule: 'C' },
    { file: 'src/render/exposure.js', src: ex, from: 'j < ${tapLoop}; j++', to: `j < ${p.tapsPerAxis}; j++`, rule: 'D' },
    { file: 'src/render/exposure.js', src: ex, from: 'sum / ${glslFloat(p.tapsPerAxis * p.tapsPerAxis)}', to: `sum / ${f(p.tapsPerAxis ** 2)}`, rule: 'E' },
    { file: 'src/render/pipeline.js', src: pl, from: 'const BLOOM_PARAMS', to: `const EXPOSURE_PARAMS = Object.freeze({ ec: ${f(p.ec)}, evMin: ${f(p.evMin)} });\nconst BLOOM_PARAMS`, rule: 'A' },
    { file: 'src/render/pipeline.js', src: pl, from: 'ou.ec.value = this.exposure.ec;', to: `ou.ec.value = ${f(p.ec)};`, rule: 'F' },
  ];
  assert.ok(cases.length >= RULES.length, '규칙마다 합성 음성이 하나 이상');
  for (const id of RULES.map((r) => r.id)) assert.ok(cases.some((c) => c.rule === id), `규칙 ${id} 의 합성 음성이 없다`);
  for (const c of cases) {
    const mutated = c.src.replace(c.from, c.to);
    assert.notEqual(mutated, c.src, `합성 음성 대상 문자열을 찾지 못했다(공허한 음성): ${c.from}`);
    const hits = floatingLiterals(mutated, c.file);
    assert.ok(hits.some((h) => h.rule === c.rule), `규칙 ${c.rule} 이 ${c.to} 를 못 잡았다: ${JSON.stringify(hits)}`);
  }
});

/* ---------------------------------------------------------------- 4. 계약 해시 */

test('계약 해시 = CONTRACT-NOTES 기록 (현재 version 기록이 정확히 하나)', () => {
  const notes = read('docs/CONTRACT-NOTES.md');
  const recs = [...notes.matchAll(/`EXPOSURE_CONTRACT v(\d+) (\w+) ([0-9a-f]{8})`/g)]
    .filter((m) => Number(m[1]) === EXPOSURE_CONTRACT.version);
  assert.equal(recs.length, 1, `CONTRACT-NOTES 에 v${EXPOSURE_CONTRACT.version} 해시 기록이 ${recs.length}건`);
  const [, , status, hash] = recs[0];
  assert.equal(status, EXPOSURE_CONTRACT.status, '기록된 status ≠ 계약');
  assert.equal(hash, exposureContractHash(), '기록된 해시 ≠ 계약 해시 — 계약 파일이 기록 없이 바뀌었다');
});

test('해시는 값 변화에 반응하고 키 순서에 무관하다', () => {
  const h0 = exposureContractHash();
  assert.match(h0, /^[0-9a-f]{8}$/);
  const c = clone(EXPOSURE_CONTRACT);
  c.speed.rateUp = 9;
  assert.notEqual(exposureContractHash(c), h0);
  const reordered = { metering: c.metering, provenance: c.provenance, status: c.status, version: c.version, range: c.range, speed: { rateDown: c.speed.rateDown, rateUp: EXPOSURE_CONTRACT.speed.rateUp } };
  assert.equal(exposureContractHash(reordered), h0);
  assert.equal(canonicalJson(reordered), canonicalJson(EXPOSURE_CONTRACT));
});

/* ------------------------------------------------ 5. ExposureMeter 런타임 일치 검사 */

/** 가짜 blit — 드로우 시점에 머티리얼에 묶인 유니폼 값을 찍어 둔다(그리기 시점 기록의 정답) */
function makeMeter() {
  const draws = [];
  const blit = (m) => {
    const u = {};
    for (const [k, v] of Object.entries(m.uniforms)) if (typeof v.value === 'number') u[k] = v.value;
    draws.push({ name: m.name, u });
  };
  const meter = new ExposureMeter({ renderer: null, blit });
  return { meter, draws };
}
/** 파이프라인 1프레임 등가: 미터 3패스 + 블룸·출력 드로우의 ec 기록(pipeline._blit 이 하는 일) */
function frame(meter) {
  meter.render(null, 4, 4, 1 / 60);
  for (const pass of EC_DRAW_PASSES) meter.noteDrawnEc(pass, meter.ec);
}

test('그리기 시점 기록 = 실제 드로우에 묶인 값, 계약과 일치하면 ok', () => {
  const { meter, draws } = makeMeter();
  frame(meter);
  const r = meter.contractCheck();
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
  assert.equal(r.drawnFrames, 1);
  assert.equal(r.hash, exposureContractHash());
  assert.equal(r.version, EXPOSURE_CONTRACT.version);
  assert.deepEqual(draws.map((d) => d.name), ['C4_EXPOSURE_METER', 'C4_EXPOSURE_REDUCE', 'C4_EXPOSURE_ADAPT']);
  const adapt = draws[2].u, reduce = draws[1].u;
  for (const k of ['rateUp', 'rateDown', 'evMin', 'evMax', 'kneeSlope']) assert.equal(r.drawn[k], adapt[k], k);
  assert.equal(r.drawn.centerWeight, reduce.centerWeight);
  assert.deepEqual(r.measurement, { exposure: 'adaptive' });
});

test('드리프트 음성 (케이스 30 노드판): 계약을 쓴 직후 rateUp=9 → 다음 드로우가 9 → ok=false, mismatches ∋ rateUp', () => {
  const { meter, draws } = makeMeter();
  const orig = meter._applyContract.bind(meter);
  meter._applyContract = () => { orig(); meter.adaptMat.uniforms.rateUp.value = 9; };
  frame(meter);
  const r = meter.contractCheck();
  assert.equal(r.ok, false);
  assert.equal(r.overrideActive, false, '드리프트는 testOverride 층이 아니다 — 그리기 값으로 잡혀야 한다');
  const m = r.mismatches.find((x) => x.key === 'rateUp');
  assert.ok(m, JSON.stringify(r.mismatches));
  assert.equal(m.drawn, 9);
  assert.equal(draws.find((d) => d.name === 'C4_EXPOSURE_ADAPT').u.rateUp, 9, '실제 드로우가 9 로 그려졌다');
});

test('드리프트 음성 — 미터 그리기 기록 키마다(rateUp·rateDown·evMin·evMax·kneeSlope·centerWeight) 그려진 값으로 잡힌다', () => {
  // 키 하나의 기록이 "계약값 기록"으로 회귀하면 그 키의 검사는 항등이 된다(검토 #15) — 키마다 따로 막는다
  const KEYS = { rateUp: 'adaptMat', rateDown: 'adaptMat', evMin: 'adaptMat', evMax: 'adaptMat', kneeSlope: 'adaptMat', centerWeight: 'reduceMat' };
  const DRAW = { adaptMat: 'C4_EXPOSURE_ADAPT', reduceMat: 'C4_EXPOSURE_REDUCE' };
  const flat = flattenContract();
  assert.ok(Object.keys(KEYS).length >= 1);
  for (const [k, mat] of Object.entries(KEYS)) {
    const { meter, draws } = makeMeter();
    const drift = flat[k] + 0.5;
    const orig = meter._applyContract.bind(meter);
    meter._applyContract = () => { orig(); meter[mat].uniforms[k].value = drift; };
    frame(meter);
    const r = meter.contractCheck();
    assert.equal(r.ok, false, `${k}: 드리프트가 잡혀야 한다`);
    const m = r.mismatches.find((x) => x.key === k);
    assert.ok(m, `${k}: ${JSON.stringify(r.mismatches)}`);
    assert.equal(m.drawn, drift, `${k}: 기록 = 그려진 값`);
    assert.equal(draws.find((d) => d.name === DRAW[mat]).u[k], drift, `${k}: 실제 드로우가 드리프트 값으로 그려졌다`);
  }
});

test('ec 그리기 기록은 pipeline._blit 이 드로우에 묶인 머티리얼 값을 남긴다(미터 값이 아니라)', async () => {
  const { RenderPipeline } = await import('../src/render/pipeline.js');
  const { meter } = makeMeter();
  meter.render(null, 4, 4, 1 / 60);
  const mats = { bloom: { uniforms: { ec: { value: meter.ec } } }, output: { uniforms: { ec: { value: meter.ec } } } };
  const fake = {
    exposure: meter,
    _ecDraws: new Map([[mats.bloom, 'bloom'], [mats.output, 'output']]),
    _fsQuad: {}, _fsScene: {}, _fsCam: {},
    renderer: { getRenderTarget: () => null, setRenderTarget: () => {}, render: () => {} },
  };
  // 대조군: 머티리얼 ec = 미터 ec → ec 불일치 없음
  for (const m of Object.values(mats)) RenderPipeline.prototype._blit.call(fake, m, null);
  assert.ok(!meter.contractCheck().mismatches.some((x) => x.key === 'ec'));
  // 음성: 출력 드로우에 묶인 ec 만 어긋나면 그 값이 기록되어 잡힌다
  mats.output.uniforms.ec.value = meter.ec + 2;
  for (const m of Object.values(mats)) RenderPipeline.prototype._blit.call(fake, m, null);
  const r = meter.contractCheck();
  assert.ok(r.mismatches.some((x) => x.key === 'ec' && x.pass === 'output' && x.drawn === meter.ec + 2), JSON.stringify(r.mismatches));
  assert.ok(!r.mismatches.some((x) => x.key === 'ec' && x.pass === 'bloom'));
});

test('그리기 뒤 유니폼만 바꾸면 ok 유지 — 검사는 현재 유니폼이 아니라 그리기 시점 값을 본다', () => {
  const { meter } = makeMeter();
  frame(meter);
  meter.adaptMat.uniforms.rateUp.value = 9; // 드로우 뒤 변경: 다음 _applyContract 가 덮으므로 그려지지 않는다
  assert.equal(meter.contractCheck().ok, true);
  frame(meter);
  assert.equal(meter.contractCheck().ok, true, '다음 프레임 _applyContract 가 계약으로 되돌려 그린다');
});

test('ec 는 블룸·출력 드로우마다 기록된다 — 한 드로우라도 기록이 없거나 다르면 mismatch', () => {
  const { meter } = makeMeter();
  meter.render(null, 4, 4, 1 / 60);
  meter.noteDrawnEc('bloom', meter.ec); // 출력 드로우 기록 누락
  let r = meter.contractCheck();
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.key === 'ec' && m.pass === 'output' && m.drawn === null));
  meter.noteDrawnEc('output', meter.ec + 1);
  r = meter.contractCheck();
  assert.ok(r.mismatches.some((m) => m.key === 'ec' && m.pass === 'output' && m.drawn === meter.ec + 1));
});

test('그리기 기록이 없으면 ok 가 아니다 (공허 통과 금지)', () => {
  const { meter } = makeMeter();
  const r = meter.contractCheck();
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.key === 'drawn'));
});

test('컴파일 대상 셰이더 문자열 변조를 잡는다', () => {
  const { meter } = makeMeter();
  frame(meter);
  meter.adaptMat.fragmentShader = meter.adaptMat.fragmentShader.replace(/evMin - [\d.]+,/, 'evMin - 9.0,');
  const r = meter.contractCheck();
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.key === 'shader:C4_EXPOSURE_ADAPT'), JSON.stringify(r.mismatches));
});

test('params 는 frozen 뷰 — 엄격 문맥 대입 throw, 비엄격 대입은 무시되고 그리기 값 불변', () => {
  const { meter } = makeMeter();
  assert.throws(() => { meter.params.rateUp = 9; }, TypeError);
  new Function('m', 'm.params.rateUp = 9;')(meter);
  frame(meter);
  const r = meter.contractCheck();
  assert.equal(r.ok, true);
  assert.equal(r.drawn.rateUp, EXPOSURE_CONTRACT.speed.rateUp);
});

test('testOverride 층 — 그려지고, contractCheck 가 잡고(ok=false), reset 이 해제한다', () => {
  const { meter } = makeMeter();
  const ks = EXPOSURE_CONTRACT.range.kneeSlope + 0.1;
  meter.setTestOverride({ kneeSlope: ks });
  frame(meter);
  let r = meter.contractCheck();
  assert.equal(r.ok, false);
  assert.equal(r.overrideActive, true);
  assert.deepEqual(r.override, { kneeSlope: ks });
  assert.ok(r.mismatches.some((m) => m.key === 'kneeSlope' && m.drawn === ks));
  // 값이 계약과 같아도 층이 켜져 있으면 ok=false (후보로 찍은 화면이 계약 판정에 섞이지 않게)
  meter.setTestOverride({ rateUp: EXPOSURE_CONTRACT.speed.rateUp });
  frame(meter);
  r = meter.contractCheck();
  assert.equal(r.mismatches.length, 0);
  assert.equal(r.ok, false);
  // ec 층은 블룸·출력 ec 로 흐른다
  meter.setTestOverride({ ec: EXPOSURE_CONTRACT.metering.ec + 0.5 });
  frame(meter);
  r = meter.contractCheck();
  assert.equal(r.mismatches.filter((m) => m.key === 'ec').length, EC_DRAW_PASSES.length);
  meter.reset();
  frame(meter);
  r = meter.contractCheck();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.overrideActive, false);
});

test('testOverride 층은 템플릿 상수·미지 키·비유한수·빈 객체를 거부한다', () => {
  const { meter } = makeMeter();
  for (const k of Object.keys(EXPOSURE_TEMPLATE_KEYS)) assert.throws(() => meter.setTestOverride({ [k]: 1 }), /템플릿 상수/, k);
  assert.throws(() => meter.setTestOverride({ notAKey: 1 }), /미지 키/);
  assert.throws(() => meter.setTestOverride({ rateUp: Number.POSITIVE_INFINITY }), /유한수/);
  assert.throws(() => meter.setTestOverride({}), /하나 이상/);
  assert.equal(meter._override, null, '거부된 호출이 층을 남겼다');
});

test('측정 잠금 — 그리기 기록에 잠금 상태가 남고, 계약 위반이 아니며, reset 이 푼다', () => {
  const { meter, draws } = makeMeter();
  const ev = 2.5;
  meter.lock(ev);
  frame(meter);
  let r = meter.contractCheck();
  assert.equal(r.ok, true, '잠금은 측정 상태 — 계약 값은 그대로 그려진다');
  assert.deepEqual(r.measurement, { exposure: 'locked', ev100: ev });
  const adapt = draws.filter((d) => d.name === 'C4_EXPOSURE_ADAPT').at(-1).u;
  assert.equal(adapt.lockOn, 1);
  assert.equal(adapt.lockEv, ev);
  assert.throws(() => meter.lock(Number.NaN), /유한수/);
  meter.reset();
  frame(meter);
  r = meter.contractCheck();
  assert.deepEqual(r.measurement, { exposure: 'adaptive' });
  assert.equal(draws.filter((d) => d.name === 'C4_EXPOSURE_ADAPT').at(-1).u.lockOn, 0);
});
