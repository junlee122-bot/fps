/**
 * src/audio/reverb.js — 공간 잔향 (P4-BRIEF §2-4, 판정 1-4).
 *
 * **프리셋 없음.** 청자 위치에서 고정 방향 레이를 쏘아 공간을 잰다:
 *  - 부피 V   : 별모양 영역 근사 V = (4π/3)·mean(r³)
 *  - 평균 자유 경로 l : 맞은 레이 거리의 평균. 표면적 S = 4V/l
 *  - 흡음     : 대역별 흡음계수의 **방향 가중** 평균. 하늘로 빠진 레이는 α = 1 (반사 없이 빠져나감)
 *               — 마당이 건조한 이유가 여기서 나온다
 *  - RT60     : Eyring  RT = 0.161·V / (−S·ln(1−ᾱ) + 4mV)   (m: 공기 흡수, 고역만)
 *  - 초기 반사: 가장 가까운 반사면 K개의 영상원 지연 2r/c · 이득 (1−α)/(2r)
 *  - 확산 잔향: 대역별 지수 감쇠 노이즈(시드 고정), 수준은 확산장 비 16π/A
 *
 * 도시로 커져도 방식이 같다 — 공간 그래프(P4B)가 생기면 방 단위 캐시로 보강한다.
 * 전부 순수 JS: 같은 입력이면 브라우저와 무관하게 같은 임펄스.
 */

import { seeded } from './synth.js';

export const SPEED_OF_SOUND = 343;
/** 대역 중심 (Hz) — 저 · 중 · 고 */
export const BANDS = Object.freeze([250, 1000, 4000]);
/** 공기 흡수 m (1/m, 에너지) — 대역별. 20 °C · 50 % 근사 */
const AIR_M = [0.0003, 0.001, 0.006];

/**
 * 흡음계수 [250, 1k, 4k] — 표준 흡음률 표의 근사치(1단계). 레이가 맞는 표면 전수.
 * DECAL 은 레이 첫 층이 될 수 없다(어댑터가 하부재를 돌려준다) — 오면 throw.
 */
export const ABSORPTION = Object.freeze({
  HANJI:        [0.15, 0.30, 0.35],
  WOOD_LATTICE: [0.10, 0.08, 0.08],
  WOOD_PLANK:   [0.11, 0.07, 0.07],
  WOOD_COLUMN:  [0.05, 0.05, 0.06],
  EARTH_WALL:   [0.04, 0.06, 0.07],
  ROOF_TILE:    [0.03, 0.04, 0.05],
  GRANITE:      [0.01, 0.02, 0.02],
  FABRIC:       [0.10, 0.45, 0.60],
  THATCH:       [0.30, 0.65, 0.80],
  BRONZE:       [0.01, 0.02, 0.02],
  WATER:        [0.01, 0.01, 0.02],
  PACKED_DIRT:  [0.15, 0.25, 0.35],
  ROOF_SOIL:    [0.20, 0.35, 0.50],
});

/** 고정 방향 집합 — 피보나치 구 (결정적) */
export function probeDirections(n = 96) {
  const dirs = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    dirs.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return dirs;
}

/**
 * 공간 측정.
 * @param {[number,number,number]} pos
 * @param {(origin, dir, maxDist) => ({dist:number, surface:string}|null)} raycast  첫 비-DECAL 층
 */
export function probeSpace(pos, raycast, { rays = 96, maxDist = 60 } = {}) {
  const dirs = probeDirections(rays);
  const hits = [];
  let misses = 0;
  for (const d of dirs) {
    const h = raycast(pos, d, maxDist);
    if (!h) { misses++; continue; }
    const a = ABSORPTION[h.surface];
    if (!a) throw new Error(`audio reverb: no absorption for ${h.surface}`); // PATCH-001-D
    hits.push({ r: Math.max(0.25, h.dist), a, dir: d, surface: h.surface });
  }
  // 평균 자유 경로 l: 맞은 레이 거리의 평균 (하늘로 빠진 레이는 경로가 끝나지 않는다 — 제외)
  const l = hits.length ? hits.reduce((acc, h) => acc + h.r, 0) / hits.length : maxDist;
  // 반사 1회당 에너지 손실 확률: **방향 가중** 흡음 — 맞은 레이는 그 표면의 α, 빠진 레이는 1.
  // (면적 가중은 스치는 먼 지면의 면적을 부풀려 열린 공간을 울리게 만든다 — 실측으로 기각)
  const alpha = [0, 1, 2].map((b) => Math.min(0.99, (hits.reduce((acc, h) => acc + h.a[b], 0) + misses) / rays));
  // 부피: 별모양 영역 (4π/3)·mean(r³). 빠진 레이는 맞은 레이 거리의 중앙값에서 끊는다
  const sorted = hits.map((h) => h.r).sort((x, y) => x - y);
  const rOpen = sorted.length ? sorted[Math.floor(sorted.length / 2)] : maxDist;
  const V = ((4 * Math.PI) / 3) * ((hits.reduce((acc, h) => acc + h.r ** 3, 0) + misses * rOpen ** 3) / rays);
  const S = (4 * V) / l; // l = 4V/S
  const A = alpha.map((a) => -S * Math.log(1 - a)); // Eyring 등가 흡음 면적
  const rt60 = A.map((a, b) => (0.161 * V) / (a + 4 * AIR_M[b] * V));
  const early = hits.slice().sort((x, y) => x.r - y.r).slice(0, 6)
    .map((h) => ({ delayS: (2 * h.r) / SPEED_OF_SOUND, gain: (1 - h.a[1]) / (2 * h.r), dir: h.dir }));
  return {
    volume: V, area: S, meanFreePath: l, openFraction: misses / rays, alpha, rt60,
    // 확산장/직접음(1 m) 에너지 비 = 16π / A  (중역)
    wetRatio: Math.min(4, (16 * Math.PI) / A[1]),
    predelayS: early.length ? early[0].delayS : 0,
    early,
  };
}

/** 측정 → 스테레오 임펄스 (Float32Array ×2) */
export function buildImpulse(space, rate, key = 'space') {
  const maxRt = Math.max(...space.rt60);
  const len = Math.max(Math.round(0.05 * rate), Math.round(Math.min(4, maxRt * 1.1 + space.predelayS) * rate));
  const L = new Float32Array(len), R = new Float32Array(len);
  // 초기 반사 — 방향 x 성분으로 좌우 분배
  for (const e of space.early) {
    const i = Math.round(e.delayS * rate);
    if (i >= len) continue;
    const pan = 0.5 + 0.45 * e.dir[0];
    L[i] += e.gain * (1 - pan); R[i] += e.gain * pan;
  }
  // 확산 잔향 — 대역별 지수 감쇠 노이즈. 대역 분할은 1극 필터 두 개(저 < 500 Hz < 중 < 2.5 kHz < 고)
  const start = Math.round(space.predelayS * rate);
  const ramp = Math.round(0.01 * rate);
  const kb = space.rt60.map((t) => Math.log(1000) / (Math.max(0.02, t) * rate));
  const aLo = Math.exp((-2 * Math.PI * 500) / rate), aHi = Math.exp((-2 * Math.PI * 2500) / rate);
  for (const [ch, out] of [['L', L], ['R', R]]) {
    const rnd = seeded(`ir:${key}:${ch}`);
    let lo = 0, lo2 = 0;
    let e = 0;
    const tmp = new Float32Array(len);
    for (let i = start; i < len; i++) {
      const x = rnd() * 2 - 1;
      lo = (1 - aLo) * x + aLo * lo;          // 저역
      lo2 = (1 - aHi) * x + aHi * lo2;        // 2.5 kHz 이하
      const low = lo, mid = lo2 - lo, high = x - lo2;
      const t = i - start;
      const env = Math.min(1, t / ramp);
      tmp[i] = env * (low * Math.exp(-kb[0] * t) + mid * Math.exp(-kb[1] * t) + high * Math.exp(-kb[2] * t));
      e += tmp[i] * tmp[i];
    }
    const g = Math.sqrt(space.wetRatio / (e || 1));
    for (let i = start; i < len; i++) out[i] += tmp[i] * g;
  }
  return [L, R];
}
