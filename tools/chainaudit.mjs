#!/usr/bin/env node
/**
 * tools/chainaudit.mjs — P2 관통 레이어 체인 성립 검증 (P1.5-BRIEF §6).
 *
 * 월드를 Node에서 빌드하고 대표 경로에 레이를 쏴 레이어 순서를 확인한다:
 *  - 창호: HANJI → LATTICE(있으면) → [실내] → … → HANJI (한 발에 창호지 2겹)
 *  - 맞배지붕: ROOF_TILE → EARTH_WALL(보토) (위→아래)
 *  - 팔작지붕: 주경사면·합각하부면 양쪽 모두 ROOF_TILE → EARTH_WALL
 *  - 담장: 상부 기와만 관통 / 하부 화강암 차단
 *
 * 곡면·합각 어느 쪽에서도 체인이 깨지면 exit 1.
 */

import * as THREE from 'three';
import { PhysicsWorld, MASK, surfaceName } from '../src/physics/index.js';
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

/** 레이 경로의 표면 시퀀스 (양면 히트 — 각 층의 진입/출구가 따로 잡힌다) */
function surfaceSequence(ox, oy, oz, dx, dy, dz, maxDist) {
  const seq = [];
  let t0 = 0;
  for (let k = 0; k < 24; k++) {
    if (!S.raycast(
      ox + dx * t0, oy + dy * t0, oz + dz * t0,
      dx, dy, dz, maxDist - t0, MASK.BULLET, hit
    )) break;
    t0 += hit.t + 0.003;
    seq.push({ surface: surfaceName(hit.surface), t: +t0.toFixed(3) });
    if (t0 >= maxDist) break;
  }
  let out = seq;
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
  ['ROOF_TILE', 'EARTH_WALL']);

/* 3. 팔작 주경사면 (동헌 남측): TILE→보토 */
expectChain('동헌 팔작 주경사면: TILE→보토', surfaceSequence(0, 12, -21, 0, -1, 0, 12),
  ['ROOF_TILE', 'EARTH_WALL']);

/* 4. 팔작 합각하부면 (동헌 동측 끝): TILE→보토 */
expectChain('동헌 팔작 합각하부면: TILE→보토', surfaceSequence(8.8, 12, -24, 0, -1, 0, 12),
  ['ROOF_TILE', 'EARTH_WALL']);

/* 5. 객사 팔작 주경사면 + 합각하부면 */
expectChain('객사 팔작 주경사면: TILE→보토', surfaceSequence(27, 12, -7.5, 0, -1, 0, 12),
  ['ROOF_TILE', 'EARTH_WALL']);
expectChain('객사 팔작 합각하부면: TILE→보토', surfaceSequence(33.2, 12, -10, 0, -1, 0, 12),
  ['ROOF_TILE', 'EARTH_WALL']);

/* 6. 지붕 전체 체인: 기와→보토→서까래(WOOD_COLUMN) — 처마 부근 */
{
  const seq = surfaceSequence(0, 12, -17.2, 0, -1, 0, 12);
  const iTile = seq.findIndex((s) => s.surface === 'ROOF_TILE');
  const iEarth = seq.findIndex((s) => s.surface === 'EARTH_WALL');
  const iWood = seq.findIndex((s) => s.surface === 'WOOD_COLUMN');
  checks.push({
    name: '동헌 처마 체인: 기와→보토→서까래',
    ok: iTile >= 0 && iEarth > iTile && iWood > iEarth,
    got: seq.map((s) => s.surface).slice(0, 12),
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
