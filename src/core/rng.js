/**
 * src/core/rng.js — 시드 고정 PRNG (HARNESS.md §2-2).
 *
 * Math.random() 직접 호출 금지. 모든 절차적 생성·게임 로직 난수는
 * 여기서 이름 붙인 스트림을 받아 쓴다. 스트림 이름이 시드를 결정하므로
 * 서브시스템 간 호출 순서가 바뀌어도 서로의 수열을 오염시키지 않는다.
 */

/** 기본 전역 시드. URL ?seed= 로 재정의 가능 (main.js에서 setGlobalSeed) */
export const DEFAULT_SEED = 0x4a53_434b; // 'JSCK'

let globalSeed = DEFAULT_SEED;

/** FNV-1a 32bit — 스트림 이름을 시드 오프셋으로 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 빠르고 결정적인 32bit PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const streams = new Map();

export function setGlobalSeed(seed) {
  globalSeed = seed >>> 0;
  streams.clear();
}

export function getGlobalSeed() {
  return globalSeed;
}

/**
 * 이름 붙은 결정적 난수 스트림을 반환한다.
 * 같은 (globalSeed, name)이면 항상 같은 수열이다.
 */
export function rngStream(name) {
  let s = streams.get(name);
  if (!s) {
    s = mulberry32((globalSeed ^ fnv1a(name)) >>> 0);
    streams.set(name, s);
  }
  return s;
}

/** 모든 스트림을 초기 상태로 재시드 (resetState 경로) */
export function resetAllStreams() {
  streams.clear();
}
