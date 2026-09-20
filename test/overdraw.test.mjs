/**
 * test/overdraw.test.mjs — overdraw_estimate 산출식 검증 (P3-BRIEF §2-6).
 *
 * P2B 실측 0.003/2.5는 지표가 시험되지 않았다는 신호였다. 합성 고부하
 * (파티클 3,500 — 예산 4,000 근방)에서 산출식이 해석해와 일치하고
 * 개수에 선형으로 반응하는지 고정한다. §8의 안개·반투과 편입 전 선결.
 *
 * [R4 작업 2] 산출식이 바뀌었다: 입자가 지름 s 의 **원반**이라는 가정(π(s/2)²)은
 * 알파 실루엣과 종횡비가 들어오면서 틀린 가정이 되었다. 지금은 사각 쿼드 면적
 * (s² — 종횡비는 면적 보존)에 실루엣 채움 비율을 곱한다. 해석해도 같이 갱신한다.
 * 임계값이 아니라 측정 대상을 고친 것이므로, 시험은 **새 정의와의 일치**를 고정한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ParticlePool } from '../src/fx/particles.js';
import { DecalPool } from '../src/fx/decals.js';
import { setGlobalSeed, DEFAULT_SEED } from '../src/core/rng.js';
import { FX_LOOK } from '../src/materials/fx-look.js';
import { coverageOf } from '../src/materials/fx-alpha-atlas.js';

/** 검증용 실루엣 채움 비율 — 방출 경로가 넣는 값과 같은 출처 */
const COV = coverageOf(FX_LOOK.dust_burst.alphaShape);

const VIEW_W = 1512, VIEW_H = 982;

function makeCamera() {
  const cam = new THREE.PerspectiveCamera(70, VIEW_W / VIEW_H, 0.05, 300);
  cam.position.set(0, 0, 0);
  return cam;
}

/** 입자를 지정 거리·크기로 강제 배치 (방출 경로 우회 — 산출식만 검증) */
function forceParticles(pool, n, dist, size) {
  pool.reset();
  for (let i = 0; i < n; i++) {
    const idx = pool.active++;
    pool.px[idx] = 0; pool.py[idx] = 0; pool.pz[idx] = -dist;
    pool.size[idx] = size;
    pool.coverage[idx] = COV;   // 방출 경로가 룩 표에서 싣는 값
    pool.life[idx] = 1; pool.maxLife[idx] = 1;
  }
}

test('§2-6a. 산출식 = 해석해 — N·cov·(s·k/d)² / 화면픽셀', () => {
  setGlobalSeed(DEFAULT_SEED);
  const scene = new THREE.Scene();
  const pool = new ParticlePool(scene);
  const cam = makeCamera();
  const N = 1000, DIST = 5, SIZE = 0.05;
  forceParticles(pool, N, DIST, SIZE);
  const area = pool.overdrawArea(cam, VIEW_H);
  const k = (VIEW_H / 2) / Math.tan((cam.fov * Math.PI / 180) / 2);
  const expected = N * COV * (SIZE * k / DIST) ** 2;
  const rel = Math.abs(area - expected) / expected;
  assert.ok(rel < 1e-6, `해석해 대비 상대오차 ${rel}`); // Float32 저장 정밀도 여유
});

test('§2-6b. 예산 근방 선형성 — 500/1500/3500 비율이 1:3:7', () => {
  setGlobalSeed(DEFAULT_SEED);
  const scene = new THREE.Scene();
  const pool = new ParticlePool(scene);
  const cam = makeCamera();
  const measure = (n) => {
    forceParticles(pool, n, 4, 0.05);
    return pool.overdrawArea(cam, VIEW_H) / (VIEW_W * VIEW_H);
  };
  const e500 = measure(500), e1500 = measure(1500), e3500 = measure(3500);
  assert.ok(Math.abs(e1500 / e500 - 3) < 1e-6, `1500/500 = ${e1500 / e500} ≠ 3`);
  assert.ok(Math.abs(e3500 / e500 - 7) < 1e-6, `3500/500 = ${e3500 / e500} ≠ 7`);
  // 고부하 절대값이 유의미한 크기로 반응한다 (0.003 같은 바닥값이 아니라):
  // 3,500개 × 5cm × 4m — 화면 대비 수 % 이상이어야 지표가 살아있는 것
  assert.ok(e3500 > 0.05, `3500개 고부하 추정 ${e3500} — 지표 무반응`);
});

test('§2-6c. 데칼 산출 포함 — 탄흔+박리 합산', () => {
  setGlobalSeed(DEFAULT_SEED);
  const scene = new THREE.Scene();
  const decals = new DecalPool(scene);
  const cam = makeCamera();
  // 정면 4m 벽에 탄흔 100 + 박리 10
  for (let i = 0; i < 100; i++) decals.add(0, 0, -4, 0, 0, 1, 'EARTH_WALL');
  for (let i = 0; i < 10; i++) decals.addPeel(0.5, 0, -4, 0, 0, 1, 'DANCHEONG');
  const withPeel = decals.overdrawArea(cam, VIEW_H);
  // 박리만 제거한 비교치: 박리 커서를 0으로 임시 되돌리면 합산에서 빠져야 한다
  const savedPeel = decals.peelCursor;
  decals.peelCursor = 0;
  const withoutPeel = decals.overdrawArea(cam, VIEW_H);
  decals.peelCursor = savedPeel;
  assert.ok(withPeel > withoutPeel, '박리 데칼이 합산에 기여해야 한다 (P2B 감사 정정 고정)');
});
