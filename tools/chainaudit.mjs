#!/usr/bin/env node
/**
 * tools/chainaudit.mjs — P2 관통 레이어 체인 성립 검증 (P1.5-BRIEF §6).
 *
 * 월드를 Node에서 빌드하고 대표 경로에 레이를 쏴 레이어 순서를 확인한다:
 *  - 창호: HANJI → LATTICE(있으면) → [실내] → … → HANJI (한 발에 창호지 2겹)
 *  - 맞배지붕: ROOF_TILE → ROOF_SOIL(보토) (위→아래) [PATCH-003-D 재태깅]
 *  - 팔작지붕: 주경사면·합각하부면 양쪽 모두 ROOF_TILE → ROOF_SOIL
 *  - 담장: 상부 기와만 관통 / 하부 화강암 차단
 *
 * 곡면·합각 어느 쪽에서도 체인이 깨지면 exit 1.
 */

import * as THREE from 'three';
import { PhysicsWorld, MASK, surfaceName } from '../src/physics/index.js';
import { collectRayChain } from '../src/physics/raychain.js';
import { buildWorld } from '../src/world/level.js';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
// harnesstest 케이스 9 전용 훅 (P2A-BRIEF §0-1): 판정 로직의 음성 검증.
// (a) --test-drop <SURFACE>: 시퀀스에서 해당 표면을 제거한 입력 — 레이어 소실 시뮬레이션
// (b) --test-reverse: 시퀀스 순서를 뒤집은 입력 — 순서 위반 시뮬레이션
// 두 경우 모두 반드시 exit 1이어야 하며, 사용 시 출력에 testOverride가 박힌다.
const TEST_DROP = typeof args['test-drop'] === 'string' ? args['test-drop'] : null;
const TEST_REVERSE = args['test-reverse'] === true;

const scene = new THREE.Scene();
const physics = new PhysicsWorld();
buildWorld(scene, physics);
physics.build();
const S = physics.static;
const hit = physics._hit;

/**
 * 레이 경로의 표면 시퀀스 — [P3 §2-5] 게임이 실제로 쓰는 수집기
 * (collectRayChain: 패리티 페어링 + 공면 스윕)를 그대로 사용한다.
 * 감사 전용 스테퍼(3mm 전진)는 공면에서 좌우 비대칭으로 교차를 잃어
 * 거울 검증을 통과할 수 없었다 — 생산 코드를 검사하는 것이 목적에도 맞다.
 * 반환: 레이어당 1항목 (진입 순서), thicknessCm 포함.
 */
function surfaceSequence(ox, oy, oz, dx, dy, dz, maxDist) {
  const chain = collectRayChain(S, ox, oy, oz, dx, dy, dz, maxDist, MASK.BULLET);
  let out = chain.layers.map((l) => ({
    surface: l.surface, t: +l.entryT.toFixed(3), thicknessCm: +l.thicknessCm.toFixed(2),
  }));
  if (TEST_DROP) out = out.filter((s) => s.surface !== TEST_DROP);
  if (TEST_REVERSE) out = out.slice().reverse();
  return out;
}

const checks = [];
function expectChain(name, seq, expected, opts = {}) {
  // expected: 순서대로 나타나야 하는 표면 이름 목록 (사이에 다른 표면 허용 여부는 strict)
  const names = seq.map((s) => s.surface);
  let i = 0;
  for (const want of expected) {
    const found = names.indexOf(want, i);
    if (found < 0) {
      checks.push({ name, ok: false, expected, got: names.slice(0, 12) });
      return;
    }
    i = found + 1;
  }
  if (opts.forbid) {
    for (const f of opts.forbid) {
      if (names.includes(f)) {
        checks.push({ name, ok: false, expected, forbidden: f, got: names.slice(0, 12) });
        return;
      }
    }
  }
  checks.push({ name, ok: true, got: names.slice(0, 12) });
}

/* 1. 동헌 창호 다층: 전면 창호(z=-19.5, 서측 베이)를 뚫고 방을 지나
      동측 파티션 창호(x=-4.8)까지 — 한 발에 창호지 2겹 + 창살 */
{
  const from = { x: -6.4, y: 2.2, z: -17.0 };
  const to = { x: -3.6, y: 2.2, z: -22.5 }; // 전면 창호 통과 → 방 → x=-4.8 파티션 창호 통과
  const d = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const len = d.length();
  d.normalize();
  const seq = surfaceSequence(from.x, from.y, from.z, d.x, d.y, d.z, len + 2);
  const hanjiCount = seq.filter((s) => s.surface === 'HANJI').length;
  checks.push({
    name: '동헌 창호 다층 (창호지 2겹 이상 + 창살)',
    ok: hanjiCount >= 2 && seq.some((s) => s.surface === 'WOOD_LATTICE'),
    got: seq.map((s) => s.surface).slice(0, 12),
  });
}

/* 2. 맞배지붕 (내아): 위→아래 기와 → 보토 */
expectChain('내아 맞배: TILE→보토', surfaceSequence(-27, 12, -8.5, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);

/* 3. 팔작 주경사면 (동헌 남측): TILE→보토 */
expectChain('동헌 팔작 주경사면: TILE→보토', surfaceSequence(0, 12, -21, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);

/* 4. 팔작 합각하부면 (동헌 동측 끝): TILE→보토 */
expectChain('동헌 팔작 합각하부면: TILE→보토', surfaceSequence(8.8, 12, -24, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);

/* 5. 객사 팔작 주경사면 + 합각하부면 */
expectChain('객사 팔작 주경사면: TILE→보토', surfaceSequence(27, 12, -7.5, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);
expectChain('객사 팔작 합각하부면: TILE→보토', surfaceSequence(33.2, 12, -10, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);

/* 6. 지붕 전체 체인: 기와→보토→서까래(WOOD_COLUMN) — 처마 부근 */
{
  const seq = surfaceSequence(0, 12, -17.2, 0, -1, 0, 12);
  const iTile = seq.findIndex((s) => s.surface === 'ROOF_TILE');
  const iSoil = seq.findIndex((s) => s.surface === 'ROOF_SOIL');
  const iWood = seq.findIndex((s) => s.surface === 'WOOD_COLUMN');
  checks.push({
    name: '동헌 처마 체인: 기와→보토→서까래',
    ok: iTile >= 0 && iSoil > iTile && iWood > iSoil,
    got: seq.map((s) => s.surface).slice(0, 12),
  });
}

/* 8. [P3 §2-5] 경로 대표성 보강 — P2B 와인딩 반전이 9경로를 전부 통과한 것은
      경로 선정 결함이었다. 거울 대칭면·반전면·추녀 교차부·회랑 양단을 편입한다.
      (좌표는 정확한 대칭 평면을 피한다 — 대칭면 수직 레이는 공유 모서리 퇴화로
      교차가 소실될 수 있다: 회랑 x=39.1 실측, CONTRACT-NOTES P3 기록) */
expectChain('동헌 동합각 상부: TILE→보토 (반전면)', surfaceSequence(8.8, 12, -22, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);
expectChain('동헌 서합각: TILE→보토 (거울)', surfaceSequence(-8.8, 12, -22, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);
expectChain('객사 북경사: TILE→보토 (반전면)', surfaceSequence(27, 12, -12.5, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);
expectChain('내아 서측 경사: TILE→보토 (동측 #2의 거울)', surfaceSequence(-33, 12, -8.5, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL']);
expectChain('동헌 추녀 교차부: TILE→보토→서까래', surfaceSequence(8.2, 12, -17.6, 0, -1, 0, 12),
  ['ROOF_TILE', 'ROOF_SOIL', 'WOOD_COLUMN']);

/* 회랑 양단 — 거울 배치의 체인 동일성까지 검증 */
{
  const south = surfaceSequence(38.6, 8, 14, 0, -1, 0, 12);
  const north = surfaceSequence(38.6, 8, -26, 0, -1, 0, 12);
  const sig = (seq) => seq.map((s) => s.surface).join('>');
  const want = ['ROOF_TILE', 'ROOF_SOIL', 'WOOD_PLANK'];
  const contains = (seq) => {
    const names = seq.map((s) => s.surface);
    let i = 0;
    for (const w of want) { const f = names.indexOf(w, i); if (f < 0) return false; i = f + 1; }
    return true;
  };
  checks.push({
    name: '회랑 남단: TILE→보토→마루',
    ok: contains(south),
    got: south.map((s) => s.surface).slice(0, 8),
  });
  checks.push({
    name: '회랑 북단: 남단과 동일 체인 (거울 대칭)',
    ok: contains(north) && sig(north) === sig(south),
    got: { north: sig(north), south: sig(south) },
  });
}

/* 7. 담장: 상부(y 1.85) 기와 관통 (화강암 없음) / 하부(y 1.0) 화강암 차단 */
expectChain('담장 상부: 기와만', surfaceSequence(-40, 1.95, -10, -1, 0, 0, 8),
  ['ROOF_TILE'], { forbid: ['GRANITE'] });
expectChain('담장 하부: 화강암', surfaceSequence(-40, 1.0, -10, -1, 0, 0, 8),
  ['GRANITE']);

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({
  ok,
  ...(TEST_DROP || TEST_REVERSE
    ? { testOverride: `${TEST_DROP ? `drop=${TEST_DROP} ` : ''}${TEST_REVERSE ? 'reverse' : ''}`.trim() + ' — harnesstest 전용, 계약 판정 무효' }
    : {}),
  checks,
}, null, 2));
process.exit(ok ? 0 : 1);
