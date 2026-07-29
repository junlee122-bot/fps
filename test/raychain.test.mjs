/**
 * test/raychain.test.mjs — 탄도 배선 성질 검증 (P2A-BRIEF §4-2 케이스 8·9).
 *
 *  8. 산탄 9펠릿이 독립 계산되고 합산되지 않음 (발사 파이프라인 수준)
 *  9. 두께가 지오메트리에서 산출됨 — 동일 표면을 다른 두께로 배치했을 때
 *     체인 두께와 관통 결과가 다름 (상수 두께 금지 조항의 검증)
 *
 * 합성 StaticWorld(월드 빌드 없이 박스 몇 개)로 검증 — 레벨 변화에 독립.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PhysicsWorld } from '../src/physics/index.js';
import { collectRayChain } from '../src/physics/raychain.js';
import { FireControl } from '../src/weapons/firecontrol.js';
import { classify } from '../src/weapons/ballistics.js';
import { WEAPONS } from '../src/weapons/params.js';
import { bus } from '../src/core/events.js';
import { setGlobalSeed, DEFAULT_SEED } from '../src/core/rng.js';

function makeWorld(boxes) {
  const physics = new PhysicsWorld();
  for (const [name, surface, w, h, d, x, y, z] of boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.name = name;
    m.position.set(x, y, z);
    m.updateMatrixWorld(true);
    physics.addStaticMesh(m, surface);
  }
  physics.build();
  return physics;
}

test('§4-2-9. 두께는 지오메트리 실측 — 같은 표면·다른 두께 → 다른 체인·다른 결과', () => {
  // 판벽 10mm vs 300mm — 같은 표면, 두께만 다름
  const thin = makeWorld([['thin', 'WOOD_PLANK', 4, 4, 0.01, 0, 0, -5]]);
  const thick = makeWorld([['thick', 'WOOD_PLANK', 4, 4, 0.30, 0, 0, -5]]);

  const a = collectRayChain(thin.static, 0, 0, 0, 0, 0, -1, 50);
  const b = collectRayChain(thick.static, 0, 0, 0, 0, 0, -1, 50);
  assert.equal(a.layers.length, 1);
  assert.equal(b.layers.length, 1);
  assert.ok(Math.abs(a.layers[0].thicknessCm - 1) < 0.05, `thin=${a.layers[0].thicknessCm}cm ≈ 1cm`);
  assert.ok(Math.abs(b.layers[0].thicknessCm - 30) < 0.05, `thick=${b.layers[0].thicknessCm}cm ≈ 30cm`);

  // 결과도 갈라진다: 산탄은 10mm 판벽을 뚫지만(R≈28%) 300mm에는 정지
  assert.equal(classify(WEAPONS.SHOTGUN, a.layers), 'pen');
  assert.equal(classify(WEAPONS.SHOTGUN, b.layers), 'stop');

  // 사각(斜角) 입사 → 실측 경로 두께 증가 (상수 두께가 아니라는 직접 증거)
  const c = collectRayChain(thin.static, -5, 0, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, 50);
  assert.equal(c.layers.length, 1);
  assert.ok(c.layers[0].thicknessCm > 1.37 && c.layers[0].thicknessCm < 1.46,
    `45° 입사 두께 ${c.layers[0].thicknessCm}cm ≈ √2cm`);
});

test('§4-2-9b. 겹침 합집합 — 같은 표면 상호 관입 박스는 이중 계산되지 않음', () => {
  // 두 WOOD_PLANK 박스가 5cm 겹침: [−5.00,−4.90] + [−4.95,−4.85] → 합집합 15cm... 아니 10+10−5=15cm
  const w = makeWorld([
    ['a', 'WOOD_PLANK', 4, 4, 0.10, 0, 0, -4.95],
    ['b', 'WOOD_PLANK', 4, 4, 0.10, 0, 0, -5.00],
  ]);
  const r = collectRayChain(w.static, 0, 0, 0, 0, 0, -1, 50);
  const total = r.layers.reduce((s, l) => s + l.thicknessCm, 0);
  assert.ok(Math.abs(total - 15) < 0.1, `합집합 15cm 기대, 실측 ${total.toFixed(2)}cm`);
});

test('P2B. 와인딩 반전 내성 — 뒤집힌 삼각형 순서의 박스도 두께가 정확하다', () => {
  // 거울 대칭 셸(합각하부면 등)의 와인딩 반전 실측 사례를 합성으로 고정:
  // 인덱스를 뒤집은 박스 = 전 삼각형 안쪽 감김. 패리티 페어링은 무관해야 한다.
  const physics = new PhysicsWorld();
  const g = new THREE.BoxGeometry(4, 4, 0.08);
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const m = new THREE.Mesh(g);
  m.name = 'inverted';
  m.position.set(0, 0, -5);
  m.updateMatrixWorld(true);
  physics.addStaticMesh(m, 'ROOF_SOIL');
  physics.build();
  const r = collectRayChain(physics.static, 0, 0, 0, 0, 0, -1, 50);
  assert.equal(r.layers.length, 1);
  assert.ok(Math.abs(r.layers[0].thicknessCm - 8) < 0.05, `반전 와인딩 두께 ${r.layers[0].thicknessCm}cm ≈ 8cm`);
});

test('P2B. 공면 스윕 — 정확히 맞닿은 두 층(기와 하면=보토 상면)이 둘 다 잡힌다', () => {
  // 내아 보토 5.8m 오기입 실측 사례의 합성 고정: 인접 층 경계가 수치상 동일 평면
  const w = makeWorld([
    ['tile', 'ROOF_TILE', 4, 4, 0.03, 0, 0, -5.015],   // z [-5.030, -5.000]
    ['soil', 'ROOF_SOIL', 4, 4, 0.08, 0, 0, -5.070],   // z [-5.110, -5.030] — 상면 = 기와 하면
  ]);
  const r = collectRayChain(w.static, 0, 0, 0, 0, 0, -1, 50);
  assert.equal(r.layers.length, 2, `층 2개 기대, 실측 ${r.layers.map((l) => l.surface).join(',')}`);
  assert.ok(Math.abs(r.layers[0].thicknessCm - 3) < 0.06, `TILE ${r.layers[0].thicknessCm}cm`);
  assert.ok(Math.abs(r.layers[1].thicknessCm - 8) < 0.06, `SOIL ${r.layers[1].thicknessCm}cm ≈ 8cm (5.8m 아님)`);
});

test('§4-2-8. 산탄 9펠릿 독립 — 펠릿마다 독립 체인·독립 이벤트, 합산 없음', () => {
  setGlobalSeed(DEFAULT_SEED);
  // 넓은 HANJI 막 하나 — 모든 펠릿이 개별 관통
  const w = makeWorld([['pane', 'HANJI', 20, 20, 0.0003, 0, 0, -6]]);
  const fc = new FireControl((...a) => collectRayChain(w.static, ...a));
  fc.switchTo('SHOTGUN');

  const perPellet = [];
  const unsub = [];
  const hits = [];
  bus.on('ballistic:penetrate', (e) => perPellet.push(e.residualEnergy));
  bus.on('ballistic:hit', (e) => hits.push(e.worldPos.slice()));

  fc.fire({ pos: [0, 0, 0], yaw: 0, pitch: 0 });

  assert.equal(fc.counters.fired, 1, '격발 1회');
  assert.equal(fc.counters.pellets, 9, '펠릿 9개 각각 관통 계산');
  assert.equal(perPellet.length, 9, 'ballistic:penetrate 9건 (합산 아님)');
  // 각 펠릿의 잔여는 "펠릿당 에너지" 스케일 — 9발 합계 스케일이면 합산 결함
  for (const e of perPellet) {
    assert.ok(e < WEAPONS.SHOTGUN.energy, `잔여 ${e}J < 펠릿당 초구 200J`);
    assert.ok(e > WEAPONS.SHOTGUN.energy * 0.9, 'HANJI 관통 잔여는 초구의 90% 이상');
  }
  // 산포: 히트 지점이 전부 같은 점이면 산포 자체가 죽은 것
  const xs = new Set(hits.map((p) => p[0].toFixed(4)));
  assert.ok(xs.size >= 8, `9펠릿 히트 x좌표 ${xs.size}종 — 산포 필요`);
});
