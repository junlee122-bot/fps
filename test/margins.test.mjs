/**
 * test/margins.test.mjs — §2-1 결과 표 30칸 + PATCH-002-E 여유 밴드 영구 게이트.
 *
 * 원칙 (P2A-BRIEF §7): 표의 잔여율 값을 하드코딩하지 않는다. 기대값은
 * "분류"(관통/부분/정지)뿐이고, 수치는 전부 동결 computePenetration()의
 * 실행 출력에서 얻어 밴드와 대조한다.
 *
 * 여유 밴드 (PATCH-002-E, 25% 마진 — BLOCK 칸 제외):
 *   관통  R ≥ 0.1875   (임계 0.15 × 1.25)
 *   부분  0.025 ≤ R ≤ 0.12
 *   정지  R ≤ 0.016    (임계 0.02 × 0.8) — 정지 레이어 통과 직후의 원시 잔여율
 *
 * 두께의 단일 출처: 킷 상수 T (m → cm). FABRIC은 킷 두께표에 없어
 * 계약 참조값 2mm를 사용한다 (docs/P2A-BLOCKER-001 §5에 보고된 가정 —
 * PATCH-002·003 모두 정정하지 않았으므로 이 값으로 고정, CONTRACT-NOTES 기록).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SURFACES } from '../src/core/surfaces.js';
import { WEAPONS } from '../src/weapons/params.js';
import { penetrate, classify } from '../src/weapons/ballistics.js';
import { T } from '../src/world/kit.js';

const cm = (m) => m * 100;
const L = (surface, mThick) => ({ surface, thicknessCm: cm(mThick) });

/** 무기 열 순서: 카빈 / 산탄(펠릿당) / DMR */
const COLS = [WEAPONS.CARBINE, WEAPONS.SHOTGUN, WEAPONS.DMR];

/**
 * §2-1 결과 표 (정정본 — PATCH-002-B: 산탄×THATCH '부분'→'정지').
 * want: [카빈, 산탄, DMR]. block: BLOCK 칸 — 여유 밴드 검증 제외 (E 단서).
 */
const ROWS = [
  { name: 'HANJI 0.3mm',        layers: [L('HANJI', T.HANJI_T)],                          want: ['pen', 'pen', 'pen'] },
  { name: 'FABRIC 2mm',         layers: [{ surface: 'FABRIC', thicknessCm: 0.2 }],        want: ['pen', 'pen', 'pen'] },
  { name: 'LATTICE 24mm',       layers: [L('WOOD_LATTICE', T.LATTICE_T)],                 want: ['pen', 'pen', 'pen'] },
  { name: 'THATCH 200mm',       layers: [L('THATCH', T.THATCH_T)],                        want: ['pen', 'stop', 'pen'] },
  { name: 'PLANK 45mm',         layers: [L('WOOD_PLANK', T.PANBYEOK_T)],                  want: ['pen', 'stop', 'pen'] },
  { name: 'TILE 30mm',          layers: [L('ROOF_TILE', T.TILE_T)],                       want: ['pen', 'stop', 'pen'] },
  { name: 'TILE+보토 (지붕 관통)', layers: [L('ROOF_TILE', T.TILE_T), L('ROOF_SOIL', T.BOTO_T)], want: ['partial', 'stop', 'pen'] },
  { name: 'COLUMN ø300',        layers: [L('WOOD_COLUMN', T.COL_D)],                      want: ['stop', 'stop', 'partial'] },
  { name: 'EARTH_WALL 100mm',   layers: [L('EARTH_WALL', T.SIMBYEOK_T)],                  want: ['stop', 'stop', 'partial'] },
  { name: 'GRANITE',            layers: [L('GRANITE', T.WALL_G_T)],                       want: ['stop', 'stop', 'stop'], block: true },
];

const BAND = Object.freeze({
  pen: { min: 0.1875, max: 1.0 },
  partial: { min: 0.025, max: 0.12 },
  stop: { min: 0.0, max: 0.016 },
});

/** 동결 함수 출력에서 여유 검증용 원시 잔여율을 얻는다 (수치 하드코딩 없음) */
function rawRatio(weapon, energy0, layers) {
  const r = penetrate(weapon, energy0, layers);
  if (r.stoppedAt === null) return r.residual / energy0;
  // 정지: 정지 레이어 통과 직후의 원시 잔여가 path 마지막 항에 남는다.
  // 이후 레이어는 잔여를 더 줄일 뿐이므로 이 값의 상계 검증으로 충분하다.
  const last = r.path[r.path.length - 1];
  return last.residual / energy0;
}

test('§2-1 결과 표 — 30칸 분류 일치 (동결 함수 출력 대조)', () => {
  const fails = [];
  for (const row of ROWS) {
    row.want.forEach((want, i) => {
      const got = classify(COLS[i], row.layers);
      if (got !== want) fails.push(`${row.name} × ${COLS[i].id}: want=${want} got=${got}`);
    });
  }
  assert.deepEqual(fails, [], `분류 불일치 ${fails.length}칸`);
});

test('PATCH-002-E — 여유 밴드 (BLOCK 칸 제외, 경계 밀착 금지)', () => {
  // 분류 경계(관통 0.15 / 정지 0.02) 대비 상대 여유. 출력 요구는 PATCH-002-E §테스트.
  const marginOf = (want, R) => {
    if (want === 'pen') return (R - 0.15) / 0.15;
    if (want === 'stop') return (0.02 - R) / 0.02;
    return Math.min((R - 0.02) / 0.02, (0.15 - R) / 0.15); // 부분: 양쪽 경계 중 최소
  };
  const fails = [];
  const table = [];
  for (const row of ROWS) {
    row.want.forEach((want, i) => {
      const w = COLS[i];
      if (row.block) {
        table.push(`${row.name.padEnd(22)} ${w.id.padEnd(8)} ${want.padEnd(7)} R=0 (BLOCK — 밴드 제외)`);
        return;
      }
      const R = rawRatio(w, w.energy, row.layers);
      const b = BAND[want];
      const inBand = R >= b.min && R <= b.max;
      table.push(
        `${row.name.padEnd(22)} ${w.id.padEnd(8)} ${want.padEnd(7)} ` +
        `R=${(R * 100).toFixed(3).padStart(8)}%  여유=${(marginOf(want, R) * 100).toFixed(1).padStart(6)}%  ${inBand ? 'ok' : 'FAIL'}`
      );
      if (!inBand) {
        fails.push(`${row.name} × ${w.id}: R=${(R * 100).toFixed(3)}% ∉ [${b.min}, ${b.max}] (${want})`);
      }
    });
  }
  console.log('\n[PATCH-002-E 30칸 여유율 표]\n' + table.join('\n') + '\n');
  assert.deepEqual(fails, [], `여유 밴드 이탈 ${fails.length}칸`);
});

test('BLOCK 칸 — GRANITE/BRONZE/PACKED_DIRT는 즉시 정지 (밴드 제외의 전제 확인)', () => {
  for (const surf of ['GRANITE', 'BRONZE', 'PACKED_DIRT']) {
    for (const w of COLS) {
      const r = penetrate(w, w.energy, [{ surface: surf, thicknessCm: cm(T.WALL_G_T) }]);
      assert.equal(r.stoppedAt, 0, `${w.id}: ${surf}에서 stoppedAt=0이어야 함`);
      assert.equal(r.residual, 0);
    }
  }
});

test('에너지 불변 — 분류는 에너지와 무관 (BLOCKER-001 §1의 영구 고정)', () => {
  for (const row of ROWS) {
    for (const w of COLS) {
      const a = classify(w, row.layers, w.energy);
      const b = classify(w, row.layers, w.energy * 10);
      const c = classify(w, row.layers, w.energy * 0.1);
      assert.equal(a, b, `${row.name} × ${w.id}: ×10 에너지에서 분류 변화`);
      assert.equal(a, c, `${row.name} × ${w.id}: ×0.1 에너지에서 분류 변화`);
    }
  }
});

test('산탄 펠릿 독립성 — 펠릿당 분류 동일 (비율 계산의 귀결)', () => {
  const w = WEAPONS.SHOTGUN;
  assert.equal(w.pellets, 9);
  for (const row of ROWS) {
    const perPellet = classify(w, row.layers, w.energy);
    for (let p = 1; p < w.pellets; p++) {
      assert.equal(classify(w, row.layers, w.energy), perPellet);
    }
  }
});

test('음성 테스트 — 교란된 k는 분류·밴드 검증에 걸린다 (게이트 자체 검증)', () => {
  // 통과 케이스만으로는 게이트가 작동한다는 증거가 되지 않는다 (HARNESS.md §0).
  // 카빈 k를 2배로 교란하면 TILE+보토 칸이 '부분'을 벗어나야 한다.
  const bad = { ...WEAPONS.CARBINE, k: WEAPONS.CARBINE.k * 2 };
  const layers = [L('ROOF_TILE', T.TILE_T), L('ROOF_SOIL', T.BOTO_T)];
  const got = classify(bad, layers, bad.energy);
  const R = rawRatio(bad, bad.energy, layers);
  const inBand = got === 'partial' && R >= BAND.partial.min && R <= BAND.partial.max;
  assert.equal(inBand, false, '교란 파라미터가 게이트를 통과하면 게이트가 무력하다');
});

test('파라미터 계약 무결성 — surfaces.js 동결값과 표의 전제 확인', () => {
  // ROOF_SOIL은 PATCH-003-A의 제약을 만족해야 한다
  assert.ok(SURFACES.ROOF_SOIL, 'ROOF_SOIL 부재');
  assert.ok(SURFACES.ROOF_SOIL.density < 0.8, 'ROOF_SOIL 밀도 < 0.8 (PATCH-003-A)');
  assert.notEqual(SURFACES.ROOF_SOIL.fx, SURFACES.EARTH_WALL.fx, 'fx는 EARTH_WALL과 구별');
  assert.notEqual(SURFACES.ROOF_SOIL.audio, SURFACES.EARTH_WALL.audio, 'audio는 EARTH_WALL과 구별');
  assert.ok(SURFACES.ROOF_SOIL.ricochet <= 0.02, 'ricochet ≤ 0.02 (PATCH-003-A)');
  // 표의 레이어가 전부 실존 표면인지
  for (const row of ROWS) {
    for (const l of row.layers) assert.ok(SURFACES[l.surface], `미지 표면 ${l.surface}`);
  }
});
