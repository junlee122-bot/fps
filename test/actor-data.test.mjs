/**
 * test/actor-data.test.mjs — P4B 단계 3a 캐릭터 데이터 층 검증 (설계서 §2, §13 3a, HANDOFF §4-3).
 *
 * 검사 목록:
 *   1. 8종(v0 로스터 4 + v1 fixture 4) 이 주입 목록까지 포함한 전수 검증을 통과한다.
 *   2. 음성 fixture 마다 기대한 문제 코드가 그 정의에서 나오고 getRoster 가 throw 한다.
 *      대조군(같은 base, ops 없음)은 통과한다 — 검사 조건을 상태가 아니라 변화에 건다(PATCH-016-A).
 *   3. src/** 에 로스터 id 문자열 리터럴 0(캐릭터 데이터 파일 제외, §2-1 "코드는 캐릭터를 모른다").
 *   4. 데이터 순수성: JSON 왕복 동일 + 캐릭터 파일 린트(import·함수·계산식 0) + roster.js 린트.
 *   5. buildRest 결정성(같은 입력 → 같은 바이트, 입력이 바뀌면 출력이 바뀐다).
 *   6. 외견 해석(rigOf): 외견 A 인 B 의 시각 리그 = A 의 리그(같은 객체), 진짜 값은 B 그대로.
 *   7. estimateTris ≤ TRIS_PER_CHARACTER_MAX(PATCH-010-C, 무기 포함).
 *   8. actors-data 묶음의 import 는 actors-data·src/core 안에서 닫힌다(결정 #14, §1-1).
 *
 * "모든 X 가 Y" 검사는 X ≥ 1 을 함께 단언한다(비공허 규칙).
 * fixture 는 test/ 밖(test-fixtures/)에 둔다 — node --test 는 test/ 아래 모든 .js/.mjs 를 테스트로 실행한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  getRoster, ROSTER_DEFS, resolveAppearance, visualRigOf, characterOf,
  VISUAL_RIG_KEYS, TRUE_KEYS, deriveAgentClasses, agentOf,
} from '../src/actors/data/index.js';
import { validateRoster, estimateTris, primTris, tessOf } from '../src/actors/data/schema.js';
import { BIPED, buildRest, buildRestFor, massFractions } from '../src/actors/data/skeletons/biped.js';
import { isDeepFrozen } from '../src/actors/data/freeze.js';
import {
  TRIS_PER_CHARACTER_MAX, PRIMS_PER_ACTOR_MAX, DEFAULT_STATE, SELF, ABILITY_NAMES, SKILL_PRIMITIVES,
  HITBOX_SURFACE, CANDIDATE_LIMITS,
} from '../src/actors/data/limits.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SURFACES } from '../src/core/surfaces.js';
import { WEAPONS } from '../src/weapons/params.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DATA_DIR = join(SRC, 'actors', 'data');
const CHAR_DIR = join(DATA_DIR, 'characters');
const V1_DIR = join(ROOT, 'test-fixtures', 'characters-v1');
const NEG_DIR = join(ROOT, 'test-fixtures', 'characters-negative');

/**
 * 재질 키 — materials 가 단계 6 에서 만들 ACTOR_* 목록(설계서 §3-6). 시뮬은 materials 를 import 하지
 * 않으므로 main.js·테스트가 주입한다(§2-1). 단계 6 이 ACTOR_RECIPES 를 내면 그 키로 바꾼다.
 */
const MATERIAL_KEYS = Object.freeze([
  'ACTOR_FABRIC', 'ACTOR_WOOD', 'ACTOR_HIDE', 'ACTOR_METAL',
  'ACTOR_DANCHEONG_ISEGYE', 'ACTOR_DANCHEONG_INGAN', 'ACTOR_BRONZE_ISEGYE',
  'ACTOR_ACCENT_ISEGYE', 'ACTOR_ACCENT_INGAN',
]);
const CTX = Object.freeze({ materialKeys: MATERIAL_KEYS, weaponFamilies: Object.keys(WEAPONS) });

const jsFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

async function loadDir(dir) {
  const out = [];
  for (const f of jsFiles(dir)) out.push({ file: f, def: (await import(pathToFileURL(join(dir, f)).href)).default });
  return out;
}

const V1 = (await loadDir(V1_DIR)).map((x) => x.def);
const NEG = await loadDir(NEG_DIR);
const ALL8 = [...ROSTER_DEFS, ...V1];
/**
 * 발소리 프로파일 키 — 오디오가 아직 목록을 내지 않는다(P4C). 테스트는 8종이 쓰는 키를 주입 목록으로 쓴다.
 * 오디오가 목록을 내면 그 키로 바꾼다.
 */
const FOOTSTEPS = Object.freeze([...new Set(ALL8.map((d) => d.audio.footstep))].sort());
const CTX_FULL = Object.freeze({ ...CTX, footstepProfiles: FOOTSTEPS });

/**
 * JS 소스 토큰 분리(정규식 리터럴은 다루지 않는다 — 데이터·검사 대상 파일에 따옴표를 담은 정규식이 있으면
 * 보수적으로 오검출한다). 반환 {code: 주석 제거·문자열을 ''로 비운 코드, strings: 문자열 내용들}.
 * 템플릿 리터럴은 ${…} 안의 코드를 code 로 돌려보내고 바깥 텍스트를 문자열로 모은다(여러 줄 포함).
 */
function tokenize(src) {
  let code = '';
  const strings = [];
  let i = 0;
  const n = src.length;
  const tmplDepth = []; // ${ 안으로 들어간 템플릿마다 중괄호 깊이
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
    if (c === "'" || c === '"') {
      let s = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { s += src[i + 1]; i += 2; } else s += src[i++]; }
      i++;
      strings.push(s);
      code += "''";
      continue;
    }
    if (c === '`' || (c === '}' && tmplDepth.length && tmplDepth[tmplDepth.length - 1] === 0)) {
      if (c === '}') tmplDepth.pop();
      let s = '';
      i++;
      while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) { if (src[i] === '\\') { s += src[i + 1]; i += 2; } else s += src[i++]; }
      strings.push(s);
      code += "''";
      if (src[i] === '$') { tmplDepth.push(0); i += 2; code += ' '; } else i++;
      continue;
    }
    if (tmplDepth.length) {
      if (c === '{') tmplDepth[tmplDepth.length - 1]++;
      else if (c === '}') tmplDepth[tmplDepth.length - 1]--;
    }
    code += c;
    i++;
  }
  return { code, strings };
}

/** 주석만 제거한 소스(문자열 보존) — 줄 구조 린트용 */
const stripComments = (src) => {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') { const s = i; i++; while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; out += src.slice(s, ++i); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    out += c;
    i++;
  }
  return out;
};

/* ================================ 1. 8종 검증 ================================ */

test('3a: v0 로스터 4종이 주입 목록 포함 전수 검증을 통과한다', () => {
  assert.ok(ROSTER_DEFS.length >= 1);
  const r = getRoster(CTX_FULL);
  assert.deepEqual(r.ids, ROSTER_DEFS.map((d) => d.id));
  assert.deepEqual(r.skipped, [], '모든 주입 목록을 넘기면 건너뛴 검사가 없어야 한다');
  assert.ok(isDeepFrozen(r), '레지스트리 결과는 깊은 동결');
  for (const d of ROSTER_DEFS) assert.ok(isDeepFrozen(d), `${d.id}: 정의 깊은 동결`);
});

test('3a: 발소리 목록을 주입하지 않으면 정의마다 skipped 에 이름·사유가 남는다(조용한 생략 금지)', () => {
  const r = getRoster(CTX);
  assert.equal(r.skipped.length, ROSTER_DEFS.length);
  for (const d of ROSTER_DEFS) {
    assert.ok(r.skipped.some((s) => s.startsWith(`${d.id}:`) && s.includes('audio.footstep') && s.includes(d.audio.footstep) && s.includes('주입 없음')), `${d.id}: skipped 기록`);
  }
  // 주입하면 소속을 실제로 검사한다(목록 밖 키는 문제)
  assert.throws(() => getRoster({ ...CTX, footstepProfiles: [] }), /audio\.footstep/);
});

test('3a: 경계 — 계약 상수 고정, 원시 정확히 상한은 통과·하나 넘으면 문제', () => {
  assert.equal(TRIS_PER_CHARACTER_MAX, 25000, 'PATCH-010-C 계약값');
  assert.equal(PRIMS_PER_ACTOR_MAX, 24, '차폐 텍스처 행 수(결정 #1 후보)');
  assert.ok(CANDIDATE_LIMITS.includes('PRIMS_PER_ACTOR_MAX') && CANDIDATE_LIMITS.includes('HITBOX_SURFACE'), '후보 표시');
  assert.equal(HITBOX_SURFACE, 'FABRIC', '결정 #9 후보값');
  const base = ROSTER_DEFS[0];
  const filler = (k) => ({ id: `fill_${k}`, bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: base.shape.primitives[1].slot, surface: HITBOX_SURFACE, zone: 'torso' });
  const withPrims = (count) => {
    const d = clone(base);
    d.id = 'bound_prims';
    while (d.shape.primitives.length < count) d.shape.primitives.push(filler(d.shape.primitives.length));
    return d;
  };
  assert.ok(base.shape.primitives.length < PRIMS_PER_ACTOR_MAX);
  const at = validateRoster([...ALL8, withPrims(PRIMS_PER_ACTOR_MAX)], fullCtx());
  assert.deepEqual(at.problems, [], `원시 ${PRIMS_PER_ACTOR_MAX} = 상한은 통과`);
  const over = validateRoster([...ALL8, withPrims(PRIMS_PER_ACTOR_MAX + 1)], fullCtx());
  assert.deepEqual([...new Set(over.problems.map((p) => p.code))], ['prims.count'], '상한 + 1 은 prims.count 하나');
});

test('3a: 경계 — 추정 삼각형 정확히 상한은 통과, 상한 초과 최소값은 문제', () => {
  // 원시별 seg(1..8) 조합으로 만들 수 있는 합을 동적 계획으로 찾는다(정확히 상한 · 상한 초과 최소)
  const base = ROSTER_DEFS[0];
  const prims = base.shape.primitives;
  const SEGS = [1, 2, 3, 4, 5, 6, 7, 8];
  let reach = new Map([[0, []]]);
  for (const p of prims) {
    const next = new Map();
    const opts = SEGS.map((s) => primTris({ ...p, seg: s }));
    for (const [sum, segs] of reach) {
      opts.forEach((t, k) => { const v = sum + t; if (v <= TRIS_PER_CHARACTER_MAX + 64 && !next.has(v)) next.set(v, [...segs, SEGS[k]]); });
    }
    reach = next;
  }
  const exact = reach.get(TRIS_PER_CHARACTER_MAX);
  const aboveKey = [...reach.keys()].filter((k) => k > TRIS_PER_CHARACTER_MAX).sort((a, b) => a - b)[0];
  assert.ok(exact, '정확히 상한인 seg 조합이 있다');
  assert.ok(aboveKey !== undefined, '상한 초과 조합이 있다');
  const make = (segs) => { const d = clone(base); d.id = 'bound_tris'; d.shape.primitives.forEach((p, i) => { p.seg = segs[i]; }); return d; };
  const dAt = make(exact);
  assert.equal(estimateTris(dAt), TRIS_PER_CHARACTER_MAX);
  assert.deepEqual(validateRoster([...ALL8, dAt], fullCtx()).problems, [], '정확히 상한은 통과');
  const dOver = make(reach.get(aboveKey));
  assert.equal(estimateTris(dOver), aboveKey);
  assert.deepEqual([...new Set(validateRoster([...ALL8, dOver], fullCtx()).problems.map((p) => p.code))], ['tris.budget']);
});

test('3a: 밴드 경계 고리는 삼각형 추정에 고리마다 2R 을 더한다(§3-7)', () => {
  // 원시 종류(rc·el)마다 따로 — 한 종류의 공식만 고장 나도 잡히게
  const prims = ALL8.flatMap((d) => d.shape.primitives);
  for (const kind of ['rc', 'el']) {
    const p = prims.find((x) => x.kind === kind && (x.bands || []).length >= 1);
    assert.ok(p, `밴드 있는 ${kind} 원시 ≥ 1`);
    const plain = { ...p, bands: [] };
    const t = tessOf(p);
    assert.ok(t.rings.length >= 1);
    assert.equal(primTris(p) - primTris(plain), 2 * t.R * t.rings.length, `${kind}: 고리마다 2R`);
  }
});

test('3a: getRoster 는 넘겨받은 정의를 깊은 동결하고, 정규화가 생략 필드 기본값을 명시한다', () => {
  const defs = ALL8.map(clone);
  assert.ok(defs.every((d) => !Object.isFrozen(d)));
  const r = getRoster(CTX_FULL, defs);
  for (const d of defs) assert.ok(isDeepFrozen(d), `${d.id}: 넘겨받은 정의 깊은 동결`);
  let omittedHit = 0, omittedOcc = 0, omittedBands = 0;
  r.defs.forEach((nd, i) => {
    nd.shape.primitives.forEach((p, j) => {
      const raw = defs[i].shape.primitives[j];
      if (!('hitbox' in raw)) { omittedHit++; assert.equal(p.hitbox, true); } else assert.equal(p.hitbox, raw.hitbox);
      if (!('occluder' in raw)) { omittedOcc++; assert.equal(p.occluder, true); } else assert.equal(p.occluder, raw.occluder);
      if (!('bands' in raw)) { omittedBands++; assert.deepEqual(p.bands, []); }
    });
  });
  assert.ok(omittedHit >= 1 && omittedOcc >= 1 && omittedBands >= 1, '생략 필드가 실제로 있다(비공허)');
});

test('3a: 로스터 데이터가 깨져 있으면 actors/data/index.js 를 import 하는 순간 throw 한다(PATCH-001-D)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'actordata-import-'));
  try {
    for (const sub of ['actors/data', 'core']) cpSync(join(SRC, ...sub.split('/')), join(dir, 'src', ...sub.split('/')), { recursive: true });
    // 저장소와 같은 ESM 판정(Node 의 모듈 자동 판별에 기대지 않는다)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    const entry = pathToFileURL(join(dir, 'src', 'actors', 'data', 'index.js')).href;
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(entry)});`], { encoding: 'utf8' });
    const ok = run();
    assert.equal(ok.status, 0, `대조군(무변경 사본) import 성공: ${ok.stderr}`);
    const file = join(dir, 'src', 'actors', 'data', 'characters', `${ROSTER_DEFS[0].id}.js`);
    const src = readFileSync(file, 'utf8');
    const broken = src.replace(/radius: [0-9.]+/, 'radius: 0.9');
    assert.notEqual(broken, src, '변조가 실제로 일어났다');
    writeFileSync(file, broken);
    const bad = run();
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /actors\/data: 로스터 데이터 구조 검증 실패/);
    assert.match(bad.stderr, /capsule\.radius/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('3a: 무대 대역 경고(§2-5 규칙 7) — 대역 밖 최고점만 경고, 판정 아님', () => {
  const band = [0.68, 1.875]; // L0 현행 대역(설계서 §4-7 표, 보고용 입력 — 판정 임계 아님)
  const r = getRoster({ ...CTX_FULL, stageBand: band }, ALL8);
  const outside = ALL8.filter((d) => r.reports[d.id].topY < band[0] || r.reports[d.id].topY > band[1]).map((d) => d.id);
  const inside = ALL8.map((d) => d.id).filter((id) => !outside.includes(id));
  assert.ok(outside.length >= 1 && inside.length >= 1, '대역 안·밖이 모두 있다(비공허)');
  const warned = [...new Set(r.warnings.filter((w) => w.code === 'silhouette.band').map((w) => w.path.split(':')[0]))].sort();
  assert.deepEqual(warned, [...outside].sort());
});

test('3a: v0 4 + v1 fixture 4 = 8종이 같은 경로로 검증을 통과한다', (t) => {
  assert.equal(V1.length, 4, 'v1 fixture 4종(견우·직녀·심청·흥부)');
  const r = getRoster(CTX_FULL, ALL8);
  assert.equal(r.ids.length, 8);
  assert.equal(new Set(r.ids).size, 8, 'id 유일');
  assert.deepEqual(r.skipped, []);
  for (const id of r.ids) {
    const rep = r.reports[id];
    t.diagnostic(`${id}: 원시 ${rep.prims} · 추정 tris ${rep.tris} · 최고점 ${rep.topY.toFixed(3)} m(${rep.topPrim}) · 수평 돌출 ${rep.protrusionM.toFixed(3)} m`);
  }
  for (const p of r.rigPairs) t.diagnostic(`외견 쌍 ${p.id}:${p.state} → 리그 ${p.rigId}: 리그 최고점 ${p.rigTopY.toFixed(3)} m / 진짜 키 ${p.trueHeight} m, 돌출 ${p.protrusionM.toFixed(3)} m`);
});

test('3a: 주입 목록 없이 getRoster 를 부르면 조용히 완화하지 않고 throw 한다(PATCH-001-C)', () => {
  assert.throws(() => getRoster({ weaponFamilies: CTX.weaponFamilies }), /materialKeys/);
  assert.throws(() => getRoster({ materialKeys: CTX.materialKeys }), /weaponFamilies/);
  assert.throws(() => getRoster(null), TypeError);
});

/* ================================ 2. 음성 fixture ================================ */

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function applyOps(def, ops) {
  for (const [op, path, value] of ops) {
    const keys = path.split('.');
    let o = def;
    for (const k of keys.slice(0, -1)) o = o[k];
    const last = keys[keys.length - 1];
    if (op === 'set') o[last] = clone(value);
    else if (op === 'push') o[last].push(clone(value));
    else throw new Error(`음성 fixture: 미지 op '${op}'`);
  }
  return def;
}

const BASES = Object.fromEntries(ALL8.map((d) => [d.id, d]));

function build(spec, withOps) {
  const base = BASES[spec.base];
  if (!base) throw new Error(`음성 fixture: 미지 base '${spec.base}'`);
  const d = clone(base);
  d.id = spec.id;
  return withOps ? applyOps(d, spec.ops) : d;
}

/** 음성 fixture → {defs, ctx, id}. 로스터 전체(8종)에 음성 정의를 붙인다 — 교차 참조·id 중복을 같은 경로로 */
function negCase(spec, withOps) {
  const main = build(spec, withOps);
  // 대조군에서 id 중복 fixture 는 base 와 같은 id 라 그 자체가 위반이다 — 대조군만 이름을 바꾼다
  if (!withOps && BASES[main.id]) main.id = `ctl_${main.id}`;
  const extras = (spec.extra || []).map((e) => build(e, withOps));
  return { defs: [...ALL8, main, ...extras], ctx: fullCtx(spec.skeletons || []), id: main.id };
}

/** validateRoster 는 레지스트리의 기본 문맥을 모른다 — getRoster 와 같은 문맥(+ 발소리 목록)을 직접 짠다 */
function fullCtx(altSkeletons = []) {
  const skeletons = { [BIPED.name]: BIPED };
  for (const name of altSkeletons) skeletons[name] = { ...BIPED, name };
  return { ...CTX_FULL, surfaces: SURFACES, abilityNames: ABILITY_NAMES, skillPrimitives: SKILL_PRIMITIVES, skeletons };
}

test('3a 음성: fixture 가 있고 형식이 닫혀 있다', () => {
  assert.ok(NEG.length >= 1, '음성 fixture ≥ 1');
  for (const { file, def } of NEG) {
    for (const k of Object.keys(def)) assert.ok(['why', 'base', 'id', 'ops', 'expect', 'extra', 'skeletons'].includes(k), `${file}: 모르는 키 '${k}'`);
    assert.ok(typeof def.why === 'string' && def.why.length > 0, `${file}: why`);
    assert.ok(Array.isArray(def.expect) && def.expect.length >= 1, `${file}: expect ≥ 1`);
    assert.ok(Array.isArray(def.ops), `${file}: ops`);
  }
});

for (const { file, def: spec } of NEG) {
  test(`3a 음성 ${file}: ${spec.why}`, () => {
    // 대조군 — ops 를 빼면 통과해야 한다. 아니면 문제가 ops 가 아니라 base 에서 나온 것이다
    const ctl = negCase(spec, false);
    const ctlRes = validateRoster(ctl.defs, ctl.ctx);
    assert.deepEqual(ctlRes.problems, [], `${file}: 대조군(ops 없음)이 통과해야 한다`);

    const neg = negCase(spec, true);
    const res = validateRoster(neg.defs, neg.ctx);
    assert.ok(res.problems.length >= 1, `${file}: 문제 ≥ 1`);
    const codes = new Set(res.problems.map((p) => p.code));
    for (const c of spec.expect) assert.ok(codes.has(c), `${file}: 기대 코드 '${c}' 없음 — 실제 ${[...codes].join(', ')}`);
    assert.throws(() => getRoster(neg.ctx, neg.defs), /getRoster: 로스터 검증 실패/);
  });
}

/* ================================ 3. id 리터럴 0 ================================ */

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * 소스의 문자열 리터럴('…'·"…"·`…`, 여러 줄 템플릿 포함) 안에서 id 를 낱말로 찾는다.
 * 낱말 경계 = [a-z0-9_] 가 아닌 문자 — `'jara,dokkaebi'.split(',')` 같은 묶음도 잡는다.
 */
function idLiterals(source, ids) {
  const hits = [];
  const { code, strings } = tokenize(source);
  for (const s of strings) {
    for (const w of s.split(/[^a-z0-9_]+/)) if (ids.has(w)) hits.push(w);
  }
  // 코드 자리 식별자(따옴표 없는 객체 키 `{ jara: … }`·변수 이름)도 캐릭터 분기 우회로다(검증자 X07)
  for (const m of code.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) if (ids.has(m[0])) hits.push(m[0]);
  return hits;
}

test('3a: src/** 에 로스터 id 문자열 리터럴 0 (캐릭터 데이터 파일·roster.js 제외)', () => {
  const ids = new Set(ALL8.map((d) => d.id));
  assert.equal(ids.size, 8);
  const [a, b] = ALL8.map((d) => d.id);
  // 검출기 자체가 반응하는지 먼저 본다 — 공허 통과 방지(검증자 지적 X01·X05·X06 포함)
  assert.deepEqual(idLiterals(`if (id === '${a}') x();`, ids), [a]);
  assert.deepEqual(idLiterals(`const u = 'http://a'; if (id === '${a}') x();`, ids), [a], '같은 줄 앞 문자열의 // 뒤도 본다');
  assert.deepEqual(idLiterals(`const t = \`\n  ${a}\n\`;`, ids), [a], '여러 줄 템플릿');
  assert.deepEqual(idLiterals(`const l = '${a},${b}'.split(',');`, ids), [a, b], '묶음 문자열');
  assert.deepEqual(idLiterals(`const t = \`x\${'${a}'}y\`;`, ids), [a], '템플릿 안 식의 문자열');
  assert.deepEqual(idLiterals(`const m = { ${a}: 1 };`, ids), [a], '따옴표 없는 객체 키');
  assert.deepEqual(idLiterals(`// '${a}'\n/* "${a}" */\nconst y = "${b}x"; const ${b}x = 1;`, ids), [], '주석·다른 낱말은 무시');

  const files = walk(SRC).filter((p) => !p.startsWith(CHAR_DIR + sep) && p !== join(DATA_DIR, 'roster.js'));
  assert.ok(files.length >= 1, '검사 파일 ≥ 1');
  const bad = [];
  for (const p of files) {
    for (const h of idLiterals(readFileSync(p, 'utf8'), ids)) bad.push(`${relative(ROOT, p)}: '${h}'`);
  }
  assert.deepEqual(bad, [], '캐릭터 ID 분기 0(P4-BRIEF:336-337)');
});

/* ================================ 4. 데이터 순수성 ================================ */

test('3a: 8종 정의가 JSON 왕복에 동일하다(함수·undefined·형식 배열 0)', () => {
  assert.equal(ALL8.length, 8);
  for (const d of ALL8) assert.deepEqual(JSON.parse(JSON.stringify(d)), d, `${d.id}: JSON 왕복`);
});

test('3a: 캐릭터 파일 린트 — export default Object.freeze({...}) 하나, import·함수·계산식 0', () => {
  const files = [...jsFiles(CHAR_DIR).map((f) => join(CHAR_DIR, f)), ...jsFiles(V1_DIR).map((f) => join(V1_DIR, f))];
  assert.equal(files.length, 8);
  for (const p of files) assert.deepEqual(dataFileProblems(readFileSync(p, 'utf8')), [], relative(ROOT, p));
});

/**
 * 캐릭터 데이터 파일 린트 — 파일 전체가 `export default Object.freeze({ … });` 문 하나이고, 그 안은
 * 키 · 리터럴(문자열·수·true·false·null) · 괄호 · 쉼표 · 단항 음수뿐이어야 한다.
 * 반환: 문제 목록(빈 배열 = 통과).
 */
function dataFileProblems(source) {
  if (source.includes('`')) return ['템플릿 문자열 금지'];
  const { code } = tokenize(source);
  const body = code.trim();
  const m = /^export default Object\.freeze\(\{([\s\S]*)\}\);$/.exec(body);
  if (!m) return ['파일은 export default Object.freeze({…}); 문 하나여야 한다'];
  const inner = m[1];
  const out = [];
  if (/;/.test(inner)) out.push('문 하나만(세미콜론 금지)');
  // 식별자: 키(뒤에 ':')만 허용, 값 자리 식별자는 true·false·null 만
  for (const t of inner.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
    const rest = inner.slice(t.index + t[0].length);
    if (/^\s*:/.test(rest)) continue;
    if (['true', 'false', 'null'].includes(t[0])) continue;
    out.push(`값 자리 식별자 '${t[0]}'(참조·호출·선언 금지)`);
  }
  if (/[^\s\w$.,:{}\[\]'\-+]/.test(inner.replace(/''/g, ''))) out.push('허용되지 않은 기호(연산·호출)');
  if (/\.\.\./.test(inner)) out.push('펼침 금지');
  // 이항 연산자는 값(숫자 끝·닫는 괄호·문자열) 바로 뒤에만 온다 — 단항 음수(`[-0.11`, `, -0.5`)는 걸리지 않는다
  if (/[0-9)\]']\s*[-+]/.test(inner.replace(/\d[eE][-+]?\d/g, '0'))) out.push('계산식 금지');
  return out;
}

test('3a: 데이터 파일 린트 검출기가 반응한다(검증자 지적 X03·X04 포함)', () => {
  const ok = "/** c */\nexport default Object.freeze({ a: 1, b: [-0.5, 1e-3], c: { d: 'x // y', e: null, f: true } });\n";
  assert.deepEqual(dataFileProblems(ok), []);
  const bad = {
    'export const 추가': ok + 'export const x = 1;\n',
    'const 선언·참조': "const k = 2;\nexport default Object.freeze({ a: k });\n",
    '값 자리 참조': "export default Object.freeze({ a: k });\n",
    '산술': "export default Object.freeze({ a: 0.1 + 0.2 });\n",
    '곱셈': "export default Object.freeze({ a: 2 * 3 });\n",
    '함수': "export default Object.freeze({ a: () => 1 });\n",
    '호출': "export default Object.freeze({ a: Math.max(1, 2) });\n",
    'import': "import x from './x.js';\nexport default Object.freeze({ a: 1 });\n",
    '템플릿': 'export default Object.freeze({ a: `x` });\n',
    '단항 뒤 이항(X10)': "export default Object.freeze({ a: 81 - -0 });\n",
    '문자열 연결(X11)': "export default Object.freeze({ a: 'heavy_' + 'shell' });\n",
    '펼침(X12)': "export default Object.freeze({ ...Math, a: 1 });\n",
  };
  for (const [why, src] of Object.entries(bad)) assert.ok(dataFileProblems(src).length >= 1, why);
});

test('3a: roster.js 린트 — import 줄과 배열만, 캐릭터 파일 전부를 import 순서대로', () => {
  const code = stripComments(readFileSync(join(DATA_DIR, 'roster.js'), 'utf8'));
  const lines = code.split('\n').map((s) => s.trim()).filter(Boolean);
  const imports = [];
  let exportLine = null;
  for (const l of lines) {
    const m = /^import ([a-z][a-z0-9_]*) from '\.\/characters\/([a-z][a-z0-9_]*)\.js';$/.exec(l);
    if (m) { assert.equal(m[1], m[2], `import 이름 = 파일 이름: ${l}`); imports.push(m[1]); continue; }
    assert.equal(exportLine, null, `export 줄은 하나: ${l}`);
    exportLine = l;
  }
  assert.ok(imports.length >= 1, 'import ≥ 1');
  const m = /^export const ROSTER_DEFS = Object\.freeze\(\[([a-z0-9_, ]*)\]\);$/.exec(exportLine || '');
  assert.ok(m, `export 줄 형식: ${exportLine}`);
  const listed = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(listed, imports, '배열 = import 순서');
  assert.deepEqual([...imports].sort(), jsFiles(CHAR_DIR).map((f) => f.replace(/\.js$/, '')), '캐릭터 파일 전부가 로스터에 있다');
  assert.deepEqual(ROSTER_DEFS.map((d) => d.id), imports, '정의 id = 파일 이름');
});

/* ================================ 5. buildRest 결정성 ================================ */

const REST_KEYS = ['localPos', 'localQuat', 'worldPos', 'worldQuat', 'particlePos'];
const bytesOf = (r) => Buffer.concat(REST_KEYS.map((k) => Buffer.from(r[k].buffer, r[k].byteOffset, r[k].byteLength)));

test('3a: buildRest — 같은 입력 → 같은 바이트, 입력이 바뀌면 출력이 바뀐다', () => {
  assert.equal(ALL8.length, 8);
  for (const d of ALL8) {
    const { proportions, posture } = d.skeleton;
    const a = buildRest(proportions, posture);
    const b = buildRest(clone(proportions), clone(posture));
    const c = buildRestFor(BIPED, proportions, posture);
    for (const k of REST_KEYS) assert.ok(a[k] instanceof Float64Array, `${d.id}.${k}: Float64Array`);
    assert.equal(a.boneCount, BIPED.bones.length);
    assert.ok(bytesOf(a).equals(bytesOf(b)), `${d.id}: 반복 바이트 동일`);
    assert.ok(bytesOf(a).equals(bytesOf(c)), `${d.id}: buildRest = buildRestFor(BIPED)`);
    for (const v of bytesOf(a).length ? a.worldPos : []) assert.ok(Number.isFinite(v));
    // 변화 대조 — 출력이 입력을 실제로 반영하는지(상수 출력이면 위 동일성은 공허하다)
    const moved = buildRest({ ...proportions, hip: proportions.hip + 0.01 }, posture);
    assert.ok(!bytesOf(a).equals(bytesOf(moved)), `${d.id}: hip 변경이 출력을 바꾼다`);
  }
});

test('3a: buildRest — 키가 없거나 유한수가 아니면 throw(기본값 없음)', () => {
  const { proportions, posture } = ROSTER_DEFS[0].skeleton;
  const { hip, ...noHip } = proportions;
  assert.throws(() => buildRest(noHip, posture), /hip/);
  assert.throws(() => buildRest({ ...proportions, thigh: Number.NaN }, posture), /thigh/);
  assert.throws(() => buildRest(proportions, { ...posture, shoulderWidth: undefined }), /shoulderWidth/);
});

test('3a: 래그돌 질량 분율 — 캐릭터마다 합 1, 양수', () => {
  for (const d of ALL8) {
    const f = massFractions(d.ragdoll.massScale);
    assert.equal(f.length, BIPED.ragdoll.particles.length);
    let s = 0;
    for (const x of f) { assert.ok(x > 0); s += x; }
    assert.ok(Math.abs(s - 1) < 1e-12, `${d.id}: 합 ${s}`);
  }
});

/* ================================ 6. 외견 해석 ================================ */

test('3a: 외견 해석 — default 는 자기 리그·자기 진영', () => {
  const r = getRoster(CTX, ALL8);
  for (const d of ALL8) {
    const a = resolveAppearance(r, d.id);
    assert.equal(a.rigId, d.id);
    assert.equal(a.team, d.faction);
    assert.equal(a, resolveAppearance(r, d.id, DEFAULT_STATE), '부팅 동결 객체 재사용(호출마다 할당 없음)');
    assert.deepEqual(Object.keys(visualRigOf(r, d.id)).sort(), ['rigId', ...VISUAL_RIG_KEYS].sort());
  }
  assert.throws(() => resolveAppearance(r, ALL8[0].id, 'no_such_state'), /no_such_state/);
  assert.throws(() => resolveAppearance(r, 'no_such_character'), /no_such_character/);
  assert.throws(() => visualRigOf(r, 'no_such_character'), /no_such_character/);
});

test('3a: 외견 해석 — 외견 A 인 B 의 시각 리그는 A 의 리그 객체, 진짜 값은 B 그대로', () => {
  const r = getRoster(CTX, ALL8);
  const pairs = [];
  for (const d of ALL8) {
    for (const [state, s] of Object.entries(d.appearance.states)) {
      if (s.rigOf !== SELF && s.rigOf !== d.id) pairs.push({ d, state, s });
    }
  }
  assert.ok(pairs.length >= 1, '다른 리그를 쓰는 외견 상태 ≥ 1(흥부 변장)');
  for (const { d, state, s } of pairs) {
    const ap = resolveAppearance(r, d.id, state);
    const target = characterOf(r, ap.rigId);
    assert.equal(ap.rigId, s.rigOf);
    // 외견 리그 = 대상이 default 로 쓰는 리그 객체 그 자체, 자기 리그와는 다른 객체(비트 동일이 구성으로 성립)
    const targetDefaultRig = visualRigOf(r, resolveAppearance(r, s.rigOf, DEFAULT_STATE).rigId);
    assert.equal(visualRigOf(r, ap.rigId), targetDefaultRig);
    assert.notEqual(visualRigOf(r, ap.rigId), visualRigOf(r, resolveAppearance(r, d.id, DEFAULT_STATE).rigId));
    assert.equal(visualRigOf(r, ap.rigId).skeleton, target.skeleton, '골격 비례·자세도 대상 것');
    assert.equal(visualRigOf(r, ap.rigId).auditPose, target.silhouette.auditPose);
    assert.equal(ap.team, target.faction, '외견 팀 = rigOf 대상 진영');
    assert.notEqual(ap.team, d.faction, `${d.id}:${state}: 이 fixture 는 상대 진영으로 보인다`);
    // 시각 리그는 대상 것, 진짜 값은 자기 것
    const rig = visualRigOf(r, ap.rigId);
    assert.equal(rig.shape, target.shape);
    assert.notEqual(rig.shape, characterOf(r, d.id).shape);
    const self = characterOf(r, d.id);
    for (const path of TRUE_KEYS) {
      const get = (o) => path.split('.').reduce((x, k) => x[k], o);
      assert.deepEqual(get(self), get(BASES[d.id]), `${d.id}: 진짜 값 ${path} 는 자기 정의`);
    }
    assert.notDeepEqual(self.body.capsule, target.body.capsule, '진짜 캡슐이 대상과 실제로 다르다(비교가 공허하지 않다)');
  }
});

test('3a: 선언쌍(identicalTo)의 해석된 rigOf 가 같다', () => {
  const r = getRoster(CTX, ALL8);
  let n = 0;
  for (const d of ALL8) {
    for (const e of d.silhouette.identicalTo) {
      n++;
      assert.equal(resolveAppearance(r, d.id, e.state).rigId, resolveAppearance(r, e.character, e.characterState).rigId);
    }
  }
  assert.ok(n >= 1, '선언쌍 ≥ 1');
});

/* ================================ 7. 삼각형 예산 ================================ */

test('3a: 추정 삼각형 ≤ TRIS_PER_CHARACTER_MAX(PATCH-010-C, 무기 포함)', (t) => {
  assert.equal(ALL8.length, 8);
  for (const d of ALL8) {
    const n = estimateTris(d);
    t.diagnostic(`${d.id}: ${n}`);
    assert.ok(Number.isInteger(n) && n > 0, `${d.id}: 양의 정수`);
    assert.ok(n <= TRIS_PER_CHARACTER_MAX, `${d.id}: ${n} > ${TRIS_PER_CHARACTER_MAX}`);
  }
});

/* ================================ 이동 클래스(§5-5) ================================ */

test('3a: 이동 클래스 — 입력 순서 무관, 모든 정의가 표 안에 있다', () => {
  const a = deriveAgentClasses(ALL8);
  const b = deriveAgentClasses([...ALL8].reverse());
  assert.deepEqual(a, b);
  assert.ok(a.length >= 1);
  for (const d of ALL8) {
    const ag = agentOf(d, a);
    assert.ok(ag.navClass >= 0 && ag.navClass < a.length);
    assert.equal(ag.radius, d.body.capsule.radius);
  }
  assert.throws(() => agentOf(ALL8[0], []), /classes 에 없다/);
});

/* ================================ 8. import 폐포(결정 #14) ================================ */

/** 정적 import·export-from 지정자(동적 import 는 데이터 묶음에 없다 — 있으면 따로 실패) */
function importSpecifiers(source) {
  const code = stripComments(source);
  assert.doesNotMatch(code, /\bimport\s*\(/, '동적 import 금지');
  return [...code.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2]);
}

test('3a: actors-data 묶음의 import 전이 폐포 ⊆ {src/actors/data, src/core} (결정 #14, §1-1)', () => {
  const allowed = [DATA_DIR + sep, join(SRC, 'core') + sep];
  const seen = new Set();
  const stack = walk(DATA_DIR);
  assert.ok(stack.length >= 1);
  let edges = 0;
  const bad = [];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    for (const spec of importSpecifiers(readFileSync(p, 'utf8'))) {
      edges++;
      if (!spec.startsWith('.')) { bad.push(`${relative(ROOT, p)} → '${spec}'(패키지)`); continue; }
      const q = resolve(dirname(p), spec);
      if (!allowed.some((a) => q.startsWith(a))) bad.push(`${relative(ROOT, p)} → ${relative(ROOT, q)}`);
      else stack.push(q);
    }
  }
  assert.ok(edges >= 1, 'import 간선 ≥ 1(검사가 공허하지 않다)');
  assert.deepEqual(bad, []);
});
