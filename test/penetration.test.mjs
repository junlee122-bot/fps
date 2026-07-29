/**
 * test/penetration.test.mjs — 동결 computePenetration()의 계약 성질 검증.
 *
 * CONTRACT-PATCH-001 PATCH-001-B 6종 + P2A-BRIEF §4-2 케이스 10 (PATCH-002-G).
 * 표를 기대값으로 하드코딩하지 않는다 — 함수 출력의 성질만 검증한다.
 *
 * 케이스 3 판정 기록 (CONTRACT-NOTES P2A-2): 원문 "HANJI→LATTICE와 역순의
 * 잔여값이 다름"은 수학적으로 성립하지 않는다 — 잔여는 가환 곱이므로 순서
 * 불변이다. 순서 의존이 실재하는 관측치는 path의 레이어 순서와 stoppedAt
 * 귀속이며, 그것을 검증한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SURFACES, PenClass, computePenetration } from '../src/core/surfaces.js';
import { WEAPONS } from '../src/weapons/params.js';
import { penetrate, classify } from '../src/weapons/ballistics.js';

const E0 = 1000;
const L = (surface, thicknessCm) => ({ surface, thicknessCm });

/* ---- PATCH-001-B 1. BLOCK 3종: 두께 무관 residual 0 + stoppedAt ---- */
test('B-1. BLOCK 3종 — 두께와 무관하게 residual 0, stoppedAt 설정', () => {
  const blocks = Object.values(SURFACES).filter((s) => s.penClass === PenClass.BLOCK).map((s) => s.id);
  assert.deepEqual(blocks.sort(), ['BRONZE', 'GRANITE', 'PACKED_DIRT']);
  for (const b of blocks) {
    for (const t of [0.001, 1, 90]) {
      const r = computePenetration(E0, [L(b, t)]);
      assert.equal(r.residual, 0, `${b} ${t}cm`);
      assert.equal(r.stoppedAt, 0);
    }
  }
});

/* ---- PATCH-001-B 2. DECAL 2종: path에 없음 + 에너지 무영향 ---- */
test('B-2. DECAL 2종 — path에 나타나지 않고 에너지에 영향 없음', () => {
  const decals = Object.values(SURFACES).filter((s) => s.penClass === PenClass.DECAL).map((s) => s.id);
  assert.deepEqual(decals.sort(), ['DANCHEONG', 'LACQUER']);
  const bare = computePenetration(E0, [L('WOOD_PLANK', 4.5)]);
  for (const d of decals) {
    const wrapped = computePenetration(E0, [L(d, 0.1), L('WOOD_PLANK', 4.5), L(d, 0.1)]);
    assert.equal(wrapped.residual, bare.residual, `${d}: 에너지 영향`);
    assert.ok(!wrapped.path.some((p) => p.surface === d), `${d}: path에 등장`);
  }
});

/* ---- PATCH-001-B 3 부활 (P2B §3-4 — CONTRACT-NOTES P2A-2 대체) ----
 * 순서 의존성 테스트의 대상은 잔여값이 아니라 stoppedAt이다: 총곱이 정지 임계
 * 미만인 2층 체인을 정순·역순으로 통과시켜 정지 층 인덱스가 다름을 검증한다.
 * 데칼은 path 마지막 항목의 진입면에 찍히므로(§3-4), 이 귀속이 틀리면
 * 탄흔이 벽 반대쪽에 나타난다. */
test('B-3. 순서 의존성 (P2B §3-4 부활) — stoppedAt 귀속이 순서를 따르고, 잔여는 순서 불변', () => {
  // 잔여는 가환 곱이라 순서 불변 (케이스 3 판정 — 파일 머리주석). 그 성질 자체를 고정:
  const ab = computePenetration(E0, [L('HANJI', 0.03), L('WOOD_LATTICE', 2.4)]);
  const ba = computePenetration(E0, [L('WOOD_LATTICE', 2.4), L('HANJI', 0.03)]);
  assert.ok(Math.abs(ab.residual - ba.residual) < 1e-9 * E0, '잔여는 순서 불변이어야 함');
  // 순서가 실제로 갈라놓는 관측치: path 순서
  assert.deepEqual(ab.path.map((p) => p.surface), ['HANJI', 'WOOD_LATTICE']);
  assert.deepEqual(ba.path.map((p) => p.surface), ['WOOD_LATTICE', 'HANJI']);
  // stoppedAt 귀속: 정지를 만드는 레이어의 위치가 순서를 따른다
  const stopFirst = computePenetration(E0, [L('THATCH', 20), L('HANJI', 0.03)]);
  const stopLast = computePenetration(E0, [L('HANJI', 0.03), L('THATCH', 20)]);
  assert.equal(stopFirst.stoppedAt, 0);
  assert.equal(stopLast.stoppedAt, 1);
});

/* ---- PATCH-001-B 4. 4레이어 창호 시나리오 관통 ---- */
test('B-4. 창호지→창살→창살→창호지 4레이어 관통 성립', () => {
  const r = computePenetration(E0, [
    L('HANJI', 0.03), L('WOOD_LATTICE', 2.4), L('WOOD_LATTICE', 2.4), L('HANJI', 0.03),
  ]);
  assert.equal(r.stoppedAt, null);
  assert.ok(r.residual > 0.15 * E0, `4레이어 잔여 ${r.residual} — 관통이어야 함`);
  assert.equal(r.path.length, 4);
  assert.ok(r.path.every((p) => p.exited));
});

/* ---- PATCH-001-B 5. 단조성: 두께 증가 → 잔여 엄격 감소 ---- */
test('B-5. 단조성 — 임의 표면에서 두께 증가 시 잔여가 엄격히 감소', () => {
  const nonTrivial = Object.values(SURFACES)
    .filter((s) => s.penClass !== PenClass.BLOCK && s.penClass !== PenClass.DECAL)
    .map((s) => s.id);
  for (const surf of nonTrivial) {
    let prev = Infinity;
    for (const t of [0.1, 0.5, 1, 2, 4]) {
      const r = computePenetration(E0, [L(surf, t)]);
      if (r.stoppedAt !== null) { prev = 0; continue; } // 정지 후에는 0 고정
      assert.ok(r.residual < prev, `${surf} ${t}cm: ${r.residual} >= ${prev}`);
      prev = r.residual;
    }
  }
});

/* ---- PATCH-001-B 6. 2% 임계 경계에서 stoppedAt 귀속 ---- */
test('B-6. 정지 임계 경계 — stoppedAt이 임계를 넘긴 바로 그 레이어를 가리킴', () => {
  // WOOD_PLANK(retain 0.70, d 0.50): 1cm당 지수 1.5·ln0.7. 잔여 2%가 되는 두께:
  // 0.7^(1.5t) = 0.02 → t = ln(0.02)/(1.5 ln 0.7) ≈ 7.3164cm
  const tCrit = Math.log(0.02) / (1.5 * Math.log(0.70));
  const under = computePenetration(E0, [L('WOOD_PLANK', tCrit * 0.999)]);
  assert.equal(under.stoppedAt, null, '임계 직전 — 정지 아님');
  const over = computePenetration(E0, [L('WOOD_PLANK', tCrit * 1.001)]);
  assert.equal(over.stoppedAt, 0, '임계 직후 — 해당 레이어에서 정지');
  // 2레이어 체인: 첫 레이어는 통과, 두 번째가 임계를 넘김 → stoppedAt = 1
  const chain = computePenetration(E0, [L('WOOD_PLANK', tCrit * 0.6), L('WOOD_PLANK', tCrit * 0.6)]);
  assert.equal(chain.stoppedAt, 1);
});

/* ---- P2A §4-2 케이스 10 (PATCH-002-G): 동일 분류, 무기별 잔여 에너지 상이 ---- */
test('§4-2-10. 동일 분류 내에서 잔여 에너지가 무기별로 다름 (PATCH-002-F 배선 전제)', () => {
  // 카빈·DMR 모두 THATCH 200mm를 '관통'하지만 잔여 절대 에너지는 달라야 한다
  const layers = [L('THATCH', 20)];
  const c = WEAPONS.CARBINE, d = WEAPONS.DMR;
  assert.equal(classify(c, layers), 'pen');
  assert.equal(classify(d, layers), 'pen');
  const rc = penetrate(c, c.energy, layers);
  const rd = penetrate(d, d.energy, layers);
  assert.notEqual(rc.residual, rd.residual, '잔여 절대 에너지가 무기별로 달라야 함');
  // 비율로도 다르다 (k가 다르므로): 동일 분류 ≠ 동일 잔여
  assert.notEqual(rc.residual / c.energy, rd.residual / d.energy);
});
