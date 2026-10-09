/**
 * test/ragdoll.test.mjs — PBD 래그돌 (P4B 설계서 §6-5, 단계 5 검증).
 *
 * 합성 장면(바닥 · 0.6 m 단 · 0.3 mm 판 · 24 mm 살)과 헤드리스 경내 4곳에서 합성 템플릿으로 돈다.
 * 3a(`biped.js`) 병합 뒤 템플릿을 바꿔 끼운다 — 시나리오·장면은 `test-fixtures/ragdoll/`(test/ 밖, HANDOFF §4-3).
 *
 * 판정하지 않는 것: 슬립. 720 서브스텝이면 강제 슬립이라 "720 안 슬립"은 공허하다(재검토 #13) —
 * `steps < 720`·`forced` 는 진단으로 보고만 한다.
 * "모든 X 가 Y" 단언은 X ≥ 1 을 함께 단언한다(PATCH-016-A 비공허).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RagdollWorld, compileRagdollTemplate, RAGDOLL_PARTICLES } from '../src/physics/ragdoll.js';
import { PhysicsWorld, MASK } from '../src/physics/index.js';
import { makeClosest, makeHitRecord, segTriangleClosest } from '../src/physics/math.js';
import { installDeathWiring } from '../src/ai/death.js';
import { bus } from '../src/core/events.js';
import { SYNTH_A, SYNTH_B, posePositions } from '../test-fixtures/ragdoll/synthetic-biped.mjs';
import { SYNTH, buildSynthetic } from '../test-fixtures/ragdoll/worlds.mjs';
import {
  SCENARIOS, PHYSICS_DT, FINAL_POSE_SUBSTEPS, MASS_KG,
  physicsFor, newRagdoll, activateScenario, runScenario, finalPose,
} from '../test-fixtures/ragdoll/scenarios.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = RAGDOLL_PARTICLES;

function rodErrors(rd, x, t = SYNTH_A, slot = 0) {
  let max = 0;
  for (let r = 0; r < 15; r++) {
    const a = t.rods[r * 2], b = t.rods[r * 2 + 1];
    const d = Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]);
    max = Math.max(max, Math.abs(d - rd.restRod[slot * 15 + r]));
  }
  return max;
}

/** 이름이 맞는 정적 객체의 삼각형과 뼈 선분 교차 수 (d² = 0) */
function boneCrossings(physics, objName, x, t = SYNTH_A) {
  const o = physics.static.objects.find((ob) => ob && ob.name === objName);
  assert.ok(o, `static object ${objName} exists`);
  const cl = makeClosest();
  let n = 0;
  for (let r = 0; r < 15; r++) {
    const a = t.rods[r * 2] * 3, b = t.rods[r * 2 + 1] * 3;
    for (let k = 0; k < o.triCount; k++) {
      const p = o.tris.subarray(k * 9, k * 9 + 9);
      if (segTriangleClosest(x[a], x[a + 1], x[a + 2], x[b], x[b + 1], x[b + 2],
        p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], cl) === 0) { n++; break; }
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */

test('템플릿 컴파일: 합성 A·B 통과, 구조 위반은 throw', () => {
  assert.ok(compileRagdollTemplate(SYNTH_A));
  assert.ok(compileRagdollTemplate(SYNTH_B));
  const bad = [
    { ...SYNTH_A, massFrac: SYNTH_A.massFrac.map((v) => v * 1.01) },       // 분율 합 ≠ 1
    { ...SYNTH_A, parent: [-1, 2, ...SYNTH_A.parent.slice(2)] },            // parent[i] ≥ i
    { ...SYNTH_A, rods: SYNTH_A.rods.slice(0, 28), rodRadius: SYNTH_A.rodRadius.slice(0, 14) }, // 막대 14
    { ...SYNTH_A, braces: SYNTH_A.braces.slice(0, 10) },                    // 버팀대 5
    { ...SYNTH_A, hinges: [...SYNTH_A.hinges.slice(0, 7), 0] },             // 경첩 부호 0
  ];
  assert.ok(bad.length >= 1);
  for (const t of bad) assert.throws(() => compileRagdollTemplate(t), /ragdoll template/);
  const rd = new RagdollWorld(physicsFor('synthetic').static);
  rd.registerTemplate('a', SYNTH_A);
  assert.throws(() => rd.registerTemplate('a', SYNTH_A), /already registered/);
  assert.throws(() => rd.activate(0, 'nope', 70, posePositions(), null, null, null), /unknown template/);
  assert.throws(() => rd.activate(0, 'a', 0, posePositions(), null, null, null), /massKg/);
});

test('외견 리그가 달라도 총질량 = 진짜 massKg (분율 × 활성화 질량, 재검토 #10)', () => {
  const rd = newRagdoll(physicsFor('synthetic'));
  const cases = [['synth_a', 70], ['synth_b', 70], ['synth_a', 54.5], ['synth_b', 91.25]];
  assert.ok(cases.length >= 1);
  // 두 템플릿은 실제로 다른 분포여야 비교가 의미 있다
  assert.ok(SYNTH_A.massFrac.some((v, i) => v !== SYNTH_B.massFrac[i]));
  for (const [key, m] of cases) {
    rd.reset();
    rd.activate(3, key, m, posePositions({ x: -8, z: 8 }), [0, 0, 0], null, null, PHYSICS_DT);
    let sum = 0;
    for (let i = 0; i < N; i++) sum += 1 / rd.invMass[3 * N + i];
    assert.ok(Math.abs(sum - m) <= 1e-12 * m, `${key} ${m}: Σm = ${sum}`);
  }
});

test('최종 자세 해시: 같은 프로세스 2회 · reset 후 · 별도 프로세스 모두 동일', (t) => {
  assert.ok(SCENARIOS.length >= 1);
  const first = {};
  for (const sc of SCENARIOS) {
    const a = finalPose(sc.name);
    const b = finalPose(sc.name);
    assert.deepEqual(b, a, `${sc.name}: 2회`);
    // 같은 RagdollWorld 를 reset 해 재사용
    const rd = newRagdoll(physicsFor(sc.world));
    activateScenario(rd, sc);
    runScenario(rd);
    const h1 = rd.hash();
    rd.reset();
    assert.equal(rd.activeCount(), 0, `${sc.name}: reset 직후 활성 래그돌 0`);
    activateScenario(rd, sc);
    runScenario(rd);
    assert.equal(rd.hash(), h1, `${sc.name}: reset 후`);
    assert.equal(h1, a.hash, `${sc.name}: 새 월드와 재사용 월드`);
    first[sc.name] = a;
    t.diagnostic(`${sc.name}: hash ${a.hash} steps ${a.steps} forced ${a.forced} sleeping ${a.sleeping} (보고만, 판정 아님)`);
  }
  const outText = execFileSync(process.execPath, [
    resolve(ROOT, 'test-fixtures/ragdoll/run-hash.mjs'), ...SCENARIOS.map((s) => s.name),
  ], { cwd: ROOT, encoding: 'utf8' });
  const other = JSON.parse(outText);
  for (const sc of SCENARIOS) assert.deepEqual(other[sc.name], first[sc.name], `${sc.name}: 별도 프로세스`);
});

test('1e-9 충격 섭동이면 해시가 달라진다 (Float64 해시의 비공허성)', () => {
  assert.ok(SCENARIOS.length >= 1);
  for (const sc of SCENARIOS) {
    const base = finalPose(sc.name);
    const pert = finalPose(sc.name, { Jdelta: 1e-9 });
    assert.notEqual(pert.hash, base.hash, `${sc.name}: 섭동 해시가 같다`);
  }
});

test('매 서브스텝: NaN 0 · 입자 중심이 어떤 삼각형도 건너지 않는다 · 판 미관통', (t) => {
  const hit = makeHitRecord();
  let rays = 0;
  for (const sc of SCENARIOS) {
    const physics = physicsFor(sc.world);
    const rd = newRagdoll(physics);
    activateScenario(rd, sc);
    // 판 시나리오: 판 평면(합성 z = paneZ, 경내 na_w_-3 x = −32)의 어느 쪽인지
    const paneAxis = sc.pane === 'synthetic' ? 2 : sc.pane === 'na_w_-3' ? 0 : -1;
    const paneAt = sc.pane === 'synthetic' ? SYNTH.paneZ : -32;
    const x0 = new Float64Array(48);
    rd.particles(0, x0);
    const side0 = paneAxis >= 0 ? Math.sign(x0[paneAxis] - paneAt) : 0; // 골반 쪽
    let nearPane = 0;
    runScenario(rd, FINAL_POSE_SUBSTEPS, (prev, cur, k) => {
      for (let i = 0; i < N; i++) {
        const p = i * 3;
        for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(cur[p + c]), `${sc.name} step ${k}: NaN/Inf at particle ${i}`);
        const dx = cur[p] - prev[p], dy = cur[p + 1] - prev[p + 1], dz = cur[p + 2] - prev[p + 2];
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-12) {
          rays++;
          const crossed = physics.static.raycast(prev[p], prev[p + 1], prev[p + 2], dx / len, dy / len, dz / len, len, MASK.CHARACTER, hit);
          assert.ok(!crossed, `${sc.name} step ${k}: particle ${i} centre crossed tri ${hit.tri}`);
        }
        if (paneAxis >= 0) {
          const s = cur[p + paneAxis] - paneAt;
          assert.equal(Math.sign(s), side0, `${sc.name} step ${k}: particle ${i} on far side of pane`);
          if (Math.abs(s) < 2 * rd.radius[i]) nearPane++;
        }
      }
    });
    if (paneAxis >= 0) {
      // 판 검사가 공허하지 않음: 판에 입자 반지름 2배 안까지 다가간 적이 있다
      assert.ok(nearPane >= 1, `${sc.name}: never approached the pane`);
      t.diagnostic(`${sc.name}: 판 근접 입자-스텝 ${nearPane}`);
    }
  }
  assert.ok(rays >= 1);
  t.diagnostic(`중심 비교차 레이 ${rays}`);
});

test('24 mm 창살: 입자 중심이 살 부피 안에 들어가지 않는다 (합성·경내)', (t) => {
  const latticeScenarios = SCENARIOS.filter((s) => /lattice/.test(s.name));
  assert.ok(latticeScenarios.length >= 1);
  for (const sc of latticeScenarios) {
    const physics = physicsFor(sc.world);
    // 살 부재 상자: 인스턴스 메시(경내)는 부재 단위(memberBoxOfTri), 시나리오 3 m 안만
    const S = physics.static;
    const keys = new Set();
    const boxes = [];
    for (let tri = 0; tri < S.triCount; tri++) {
      const o = S.objectOf(tri);
      if (!o || !/lat/.test(o.name) || S.surfaceOf(tri) === undefined) continue;
      const b = S.memberBoxOfTri(tri);
      if (!b) continue;
      const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
      if (Math.hypot(cx - sc.pose.x, cz - sc.pose.z) > 3) continue;
      const key = Array.from(b).join(',');
      if (keys.has(key)) continue;
      keys.add(key);
      boxes.push([[b[0], b[1], b[2]], [b[3], b[4], b[5]]]);
    }
    assert.ok(boxes.length >= 1, `${sc.name}: lattice bars present`);
    t.diagnostic(`${sc.name}: 살 부재 ${boxes.length}`);
    const rd = newRagdoll(physics);
    activateScenario(rd, sc);
    let near = 0;
    runScenario(rd, FINAL_POSE_SUBSTEPS, (prev, cur, k) => {
      for (let i = 0; i < N; i++) {
        const q = [cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]];
        for (const [mn, mx] of boxes) {
          const inside = q[0] > mn[0] && q[0] < mx[0] && q[1] > mn[1] && q[1] < mx[1] && q[2] > mn[2] && q[2] < mx[2];
          assert.ok(!inside, `${sc.name} step ${k}: particle ${i} inside a lattice bar`);
          const dx = Math.max(mn[0] - q[0], 0, q[0] - mx[0]);
          const dy = Math.max(mn[1] - q[1], 0, q[1] - mx[1]);
          const dz = Math.max(mn[2] - q[2], 0, q[2] - mx[2]);
          if (Math.hypot(dx, dy, dz) < 2 * rd.radius[i]) near++;
        }
      }
    });
    assert.ok(near >= 1, `${sc.name}: never approached the lattice`);
    t.diagnostic(`${sc.name}: 살 근접 입자-스텝 ${near}`);
  }
});

test('판 앞 0.3 m 팔 뻗은 사망: 초기 클램프 뒤 뼈–판 교차 0, 막대 수렴', (t) => {
  const reach = SCENARIOS.filter((s) => s.pose.reach);
  assert.ok(reach.length >= 1);
  for (const sc of reach) {
    const physics = physicsFor(sc.world);
    const paneName = sc.pane === 'synthetic' ? 'pane' : 'na_w_-3_hanji_col';
    const raw = posePositions(sc.pose);
    const before = boneCrossings(physics, paneName, raw);
    assert.ok(before >= 1, `${sc.name}: 클램프 전 판을 건너는 뼈가 있어야 시험이 의미 있다`);
    const rd = newRagdoll(physics);
    activateScenario(rd, sc);
    const x = new Float64Array(48);
    rd.particles(0, x);
    assert.equal(boneCrossings(physics, paneName, x), 0, `${sc.name}: 클램프 뒤 뼈–판 교차`);
    const err0 = rodErrors(rd, x);
    assert.ok(err0 > 0, `${sc.name}: 클램프가 막대를 줄였어야 한다`);
    runScenario(rd);
    rd.particles(0, x);
    const err1 = rodErrors(rd, x);
    assert.ok(err1 < err0, `${sc.name}: 막대 오차 ${err0} → ${err1} (수렴 아님)`);
    t.diagnostic(`${sc.name}: 클램프 전 교차 뼈 ${before}, 막대 최대 오차 ${err0.toFixed(4)} → ${err1.toFixed(4)} m`);
  }
});

test('파사드: physics.step = rigid → ragdoll, rigid.bodies 불변·강체 궤적 무영향', () => {
  const mk = () => {
    const physics = buildSynthetic(new PhysicsWorld());
    const crate = physics.addRigidBody({ shape: 'box', halfExtents: [0.2, 0.2, 0.2], mass: 5, surface: 'WOOD_PLANK' });
    crate.position.set(-4, 1.5, -6);
    return { physics, crate };
  };
  const A = mk(), B = mk();
  assert.equal(A.physics.gravity, A.physics.rigid.gravity);
  const rd = A.physics.initRagdoll({ slots: 6 });
  assert.throws(() => A.physics.initRagdoll(), /already/);
  rd.registerTemplate('synth_a', SYNTH_A);
  const bodies0 = A.physics.rigid.bodies.slice();
  assert.ok(bodies0.length >= 1);
  rd.activate(0, 'synth_a', MASS_KG, posePositions({ x: -4, z: -6.6 }), [0, 0, 1], null, null, PHYSICS_DT);
  for (let k = 0; k < 240; k++) { A.physics.step(PHYSICS_DT); B.physics.step(PHYSICS_DT); }
  assert.ok(rd.state(0).steps >= 1, 'physics.step 이 래그돌을 돌렸다');
  assert.equal(A.physics.rigid.bodies.length, bodies0.length);
  bodies0.forEach((b, i) => assert.equal(A.physics.rigid.bodies[i], b));
  assert.deepEqual(A.crate.position.toArray(), B.crate.position.toArray(), '래그돌이 강체 궤적을 바꿨다');
  assert.deepEqual(A.crate.quaternion.toArray(), B.crate.quaternion.toArray());
});

test('사망 배선: actor:death → ragdollSeed(외견 rigKey, 진짜 massKg) → activate', () => {
  const physics = physicsFor('synthetic');
  const rd = newRagdoll(physics);
  const seeds = [];
  const actors = {
    ragdollSeed(slot, outPos, outVel) {
      seeds.push(slot);
      outPos.set(posePositions({ x: -8, z: 8 }));
      outVel[0] = 0.5;
      return { rigKey: 'synth_b', massKg: 63 };
    },
  };
  const off = installDeathWiring({ bus, actors, ragdoll: rd });
  try {
    bus.emit('actor:death', { actorId: 'a2', impulseWorldPos: [-8, 1.35, 8], impulse: [0, 0, 10] });
  } finally {
    off();
  }
  assert.deepEqual(seeds, [2]);
  assert.equal(rd.state(2).active, true);
  assert.equal(rd.activeCount(), 1);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const m = 1 / rd.invMass[2 * N + i];
    sum += m;
    assert.ok(Math.abs(m - SYNTH_B.massFrac[i] * 63) <= 1e-12 * 63, '외견 리그(synth_b) 분율 × 진짜 질량');
  }
  assert.ok(Math.abs(sum - 63) <= 1e-12 * 63);
  assert.throws(() => installDeathWiring({ bus, actors }), /required/);
});

test('import 전이 폐포: ragdoll.js·death.js 에 three 없음, 허용 집합 밖 import 없음 (§1-1)', () => {
  const allow = {
    'src/physics/ragdoll.js': (p) => p === 'src/physics/math.js' || p === 'src/physics/surface-registry.js' || p.startsWith('src/core/'),
    'src/ai/death.js': (p) => p.startsWith('src/ai/') || p.startsWith('src/core/'),
  };
  for (const [entry, ok] of Object.entries(allow)) {
    const seen = new Set();
    const stack = [entry];
    let edges = 0;
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        assert.ok(spec.startsWith('.'), `${f}: bare import '${spec}' (three 등) 금지`);
        const target = resolve(dirname(resolve(ROOT, f)), spec).slice(ROOT.length + 1).replaceAll('\\', '/');
        edges++;
        assert.ok(ok(target), `${entry}: ${f} → ${target} 는 허용 집합 밖`);
        stack.push(target);
      }
    }
    if (entry.endsWith('ragdoll.js')) assert.ok(edges >= 1, 'ragdoll.js 폐포 간선 ≥ 1 (비공허)');
  }
});
