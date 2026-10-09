/**
 * test/ragdoll-rig.test.mjs — 시각 리그 → 래그돌 템플릿 컴파일 (P4B 설계서 §6-2, 부록 R3 D3).
 *
 * 로스터 4종(+ v1 fixture 4종)의 시각 리그가 physics 템플릿 검증을 통과하고, 질량 분율·반지름·한계·경첩이
 * biped 표와 §6-2 유도 규칙 그대로 나오는지 본다. "모든 X 가 Y" 는 X ≥ 1 을 함께 단언한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ROSTER_DEFS } from '../src/actors/data/index.js';
import { BIPED, buildRest, massFractions } from '../src/actors/data/skeletons/biped.js';
import { compileRagdollRig, primRagdollRadius } from '../src/actors/sim/ragdoll-rig.js';
import { compileRagdollTemplate } from '../src/physics/ragdoll.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V1_DIR = join(ROOT, 'test-fixtures', 'characters-v1');
const V1 = [];
for (const f of readdirSync(V1_DIR).filter((x) => x.endsWith('.js')).sort()) V1.push((await import(pathToFileURL(join(V1_DIR, f)).href)).default);
const ALL = [...ROSTER_DEFS, ...V1];
const PS = BIPED.ragdoll.particles;
const pIdx = (n) => PS.findIndex((p) => p.name === n);
const clone = (o) => JSON.parse(JSON.stringify(o));

test('리그 컴파일: 8종 모두 physics 템플릿 검증 통과, 구조는 biped 표 순서 그대로', () => {
  assert.equal(ALL.length, 8);
  for (const d of ALL) {
    const t = compileRagdollRig(d);
    assert.ok(compileRagdollTemplate(t), d.id);
    assert.deepEqual(t.parent, PS.map((p) => (p.parent === null ? -1 : pIdx(p.parent))), `${d.id}: 입자 부모`);
    assert.equal(t.rods.length, 30);
    for (let r = 0; r < 15; r++) assert.equal(t.parent[t.rods[r * 2 + 1]], t.rods[r * 2], `${d.id}: 막대 ${r} = 부모 간선`);
    assert.deepEqual(t.braces, BIPED.ragdoll.braces.pairs.flat().map(pIdx));
    assert.deepEqual(t.massFrac, Array.from(massFractions(d.ragdoll.massScale)), `${d.id}: 분율 = massScale 정규화`);
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.radius));
  }
});

test('반지름 유도(§6-2): rc (ra+rb)/2, el 최단 반축 — 입자 = 자기 뼈 몸 원시 최솟값, 없으면 들어오는 막대', () => {
  assert.equal(primRagdollRadius({ kind: 'rc', ra: 0.1, rb: 0.06 }), 0.08);
  assert.equal(primRagdollRadius({ kind: 'el', r: [0.3, 0.12, 0.2] }), 0.12);
  let own = 0, inherited = 0;
  for (const d of ALL) {
    const t = compileRagdollRig(d);
    const body = d.shape.primitives.filter((p) => p.zone !== 'prop');
    PS.forEach((p, i) => {
      const mine = body.filter((q) => q.bone === p.bone).map(primRagdollRadius);
      if (mine.length) { own++; assert.equal(t.radius[i], Math.min(...mine), `${d.id}.${p.name}`); }
      else { inherited++; assert.equal(t.radius[i], t.rodRadius[t.rods.findIndex((v, k) => k % 2 === 1 && v === i) >> 1], `${d.id}.${p.name}: 들어오는 막대`); }
    });
    // 무기·장비(zone 'prop') 원시는 반지름에 들어가지 않는다
    const withFatProp = clone(d);
    withFatProp.shape.primitives.push({ id: 'fat_prop', bone: 'chest', kind: 'el', c: [0, 0, 0], r: [0.001, 0.001, 0.001], rotDeg: [0, 0, 0], slot: d.shape.primitives[0].slot, surface: 'FABRIC', zone: 'prop', hitbox: false });
    assert.deepEqual(compileRagdollRig(withFatProp).radius, t.radius, `${d.id}: prop 원시 무시`);
  }
  assert.ok(own >= 1 && inherited >= 1, '두 경로 모두 실행됨(비공허)');
});

test('거리 한계: 내각 θ = 180° − 굽힘, 데이터 ragdoll.limits 가 덮어쓴다', () => {
  const d = clone(ROSTER_DEFS[0]);
  const base = compileRagdollRig(d);
  BIPED.ragdoll.limits.forEach((l, k) => {
    assert.ok(Math.abs(base.limitAngle[k * 2] - (180 - l.bendDeg[1]) * Math.PI / 180) < 1e-15);
    assert.ok(Math.abs(base.limitAngle[k * 2 + 1] - (180 - l.bendDeg[0]) * Math.PI / 180) < 1e-15);
  });
  d.ragdoll.limits = { knee: [10, 120] };
  const over = compileRagdollRig(d);
  const knees = BIPED.ragdoll.limits.map((l, k) => [l, k]).filter(([l]) => l.key === 'knee');
  assert.ok(knees.length >= 1);
  for (const [, k] of knees) {
    assert.ok(Math.abs(over.limitAngle[k * 2] - 60 * Math.PI / 180) < 1e-15);
    assert.ok(Math.abs(over.limitAngle[k * 2 + 1] - 170 * Math.PI / 180) < 1e-15);
  }
  assert.notDeepEqual(over.limitAngle, base.limitAngle);
});

test('경첩 법선 = 프레임 정면(lateral × up): 휴지 자세에서 정면(+z) 쪽, 무릎 +1 · 팔꿈치 −1', () => {
  let n = 0;
  for (const d of ALL) {
    const t = compileRagdollRig(d);
    const x = buildRest(d.skeleton.proportions, d.skeleton.posture).particlePos;
    const v = (a, b) => [x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    BIPED.ragdoll.hinges.forEach((h, k) => {
      const [, , , upFrom, upTo, left, right, sign] = t.hinges.slice(k * 8, k * 8 + 8);
      const f = BIPED.ragdoll.frames[h.frame];
      const ours = cross(v(upFrom, upTo), v(left, right));
      const design = cross(v(pIdx(f.lateral[0]), pIdx(f.lateral[1])), v(pIdx(f.up[0]), pIdx(f.up[1])));
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(ours[c] - design[c]) < 1e-12, `${d.id} ${h.joint}: cross(up, right−left) = lateral × up`);
      assert.ok(ours[2] > 0, `${d.id} ${h.joint}: 정면은 +z`);
      assert.equal(sign, h.sign);
      n++;
    });
  }
  assert.ok(n >= 1);
});

test('리그 컴파일 음성: 템플릿 불일치·반지름을 정할 몸 원시 없음은 throw', () => {
  const d = clone(ROSTER_DEFS[0]);
  assert.throws(() => compileRagdollRig({ ...d, skeleton: { ...d.skeleton, template: 'quadruped' } }), /템플릿/);
  const bare = clone(d);
  bare.shape.primitives = bare.shape.primitives.filter((p) => p.zone === 'prop');
  assert.throws(() => compileRagdollRig(bare), /반지름을 정할 몸 원시가 없다/);
});

test('import 전이 폐포: ragdoll-rig.js ⊆ {actors-data, actors-sim, src/core} (결정 #14, §1-1)', () => {
  const seen = new Set();
  const stack = ['src/actors/sim/ragdoll-rig.js'];
  let edges = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    const src = readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
      edges++;
      assert.ok(m[1].startsWith('.'), `${p}: 패키지 import '${m[1]}'`);
      const q = join(dirname(p), m[1]).replace(/\\/g, '/');
      assert.ok(/^src\/(actors\/(data|sim)|core)\//.test(q), `${p} → ${q}`);
      stack.push(q);
    }
  }
  assert.ok(edges >= 1);
});
