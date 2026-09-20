/**
 * src/materials/fx-alpha-atlas.js — 입자 알파 실루엣 아틀라스 (P3 / R4 작업 2).
 *
 * 왜: 입자는 지금까지 불투명 흰 정사각형이었다. 룩 표(fx-look.js)가 실루엣 키를
 * 소유하고, 이 모듈이 그 키들을 한 장의 아틀라스로 굽는다. 인스턴스마다 셀 좌표를
 * 주어(aCell) 한 번의 드로콜·한 개의 프로그램으로 8종 실루엣을 그린다.
 *
 * 컷아웃(alphaTest)이지 블렌딩이 아니다 — 이유 두 가지:
 *  1. 안개는 후처리 패스이고 깊이 버퍼를 읽는다. depthWrite:false 인 반투명 입자는
 *     뒤 배경의 깊이로 안개가 먹혀 근거리 입자가 원경처럼 씻긴다.
 *  2. 한 InstancedMesh 안에서는 인스턴스 정렬이 없다 — 블렌딩은 방출 순서에 의존한다.
 * 컷아웃이면 깊이·안개·정렬이 전부 불투명 규칙 그대로다.
 *
 * 결정성: 해시 기반 값 잡음만 쓴다(Math.random 없음). 같은 커밋 = 같은 텍스처.
 */

import * as THREE from 'three';
import { ALPHA_SHAPES, DECAL_SHAPES, FLASH_LOOK, kelvinToRgb } from './fx-look.js';

export const ATLAS_CELL = 64;
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
export const ATLAS_W = ATLAS_CELL * ATLAS_COLS;
export const ATLAS_H = ATLAS_CELL * ATLAS_ROWS;

/** 셀 좌표 (0..COLS-1, 0..ROWS-1) — 룩 표의 alphaShape 키 순서와 동일 */
export function cellOf(shape) {
  const i = ALPHA_SHAPES.indexOf(shape);
  if (i < 0) throw new Error(`unknown alphaShape: ${shape}`);
  return [i % ATLAS_COLS, Math.floor(i / ATLAS_COLS)];
}

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 65536) / 65535;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}
function fbm(x, y, seed, oct = 3) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f, seed + i); amp *= 0.5; f *= 2; }
  return s * 2; // 0..1 근사
}
const step01 = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * 실루엣 함수 — 셀 안에서 (u,v) ∈ [0,1]² → 알파 0..1.
 * 모든 모양은 셀을 대체로 채운다. 길쭉함은 인스턴스 종횡비(fx-look.js aspect)가 만든다.
 */
function silhouette(shape, u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.hypot(dx, dy) * 2;              // 0(중심) .. 1(변)
  const ang = Math.atan2(dy, dx);
  switch (shape) {
    case 'puff': {                                // 흙벽 먼지 — 둥글고 뭉게뭉게
      const lump = 0.78 + 0.16 * (fbm(Math.cos(ang) * 1.8 + 4, Math.sin(ang) * 1.8 + 4, 11, 2) - 0.5);
      return step01(lump + 0.10, lump - 0.10, r);
    }
    case 'grit': {                                // 마당 흙 — 알갱이가 보이는 먼지
      const lump = 0.72 + 0.14 * (fbm(Math.cos(ang) * 2.2 + 7, Math.sin(ang) * 2.2 + 7, 23, 2) - 0.5);
      const body = step01(lump + 0.08, lump - 0.06, r);
      const grain = fbm(u * 7.5, v * 7.5, 31, 2);
      return body * (grain > 0.34 ? 1 : 0.0);
    }
    case 'clod': {                                // 보토 덩이 — 불규칙하고 가장자리가 단단함
      const lump = 0.80 + 0.20 * (fbm(Math.cos(ang) * 1.2 + 2, Math.sin(ang) * 1.2 + 2, 47, 3) - 0.5);
      return step01(lump + 0.05, lump - 0.02, r);
    }
    case 'shard': {                               // 각진 파편 — 삼각 쐐기
      const a = dy * 2 + 0.85;                    // 아래 변
      const b = (0.86 * dx - 0.5 * dy) * 2 + 0.80;
      const c = (-0.86 * dx - 0.5 * dy) * 2 + 0.80;
      const m = Math.min(a, b, c) + 0.10 * (fbm(u * 5, v * 5, 53, 2) - 0.5);
      return step01(-0.02, 0.05, m);
    }
    case 'sliver': {                              // 가시·지푸라기 — 한쪽이 가늘어지는 쐐기
      const t = u;                                // 0(굵은 쪽) .. 1(끝)
      const halfW = 0.30 * (1 - t) + 0.02;
      const wob = 0.05 * (fbm(u * 6, 3, 67, 2) - 0.5);
      return step01(halfW + 0.03, halfW - 0.02, Math.abs(dy + wob));
    }
    case 'chip': {                                // 파임 부스러기 — 모서리 깨진 사각
      const box = Math.min(0.42 - Math.abs(dx), 0.40 - Math.abs(dy));
      const bite = 0.16 - Math.hypot(dx - 0.30, dy - 0.28);
      const m = Math.min(box, -bite) + 0.06 * (fbm(u * 6 + 1, v * 6 + 1, 71, 2) - 0.5);
      return step01(-0.01, 0.04, m);
    }
    case 'flake': {                               // 박편 — 기울어진 마름모, 모서리 둥금
      const p = Math.abs(dx * 0.92 + dy * 0.38), q = Math.abs(-dx * 0.38 + dy * 0.92);
      const m = 0.44 - (p + q * 1.35);
      return step01(-0.02, 0.06, m + 0.05 * (fbm(u * 5 + 3, v * 5 + 3, 83, 2) - 0.5));
    }
    case 'streak': {                              // 불똥 — 가운데가 진한 렌즈
      const e = Math.hypot(dx / 0.48, dy / 0.26);
      return step01(1.0, 0.72, e);
    }
    default: throw new Error(`unknown alphaShape: ${shape}`);
  }
}

/** 아틀라스 1장 굽기 — alphaMap은 g 채널을 읽는다(three). 전 채널에 같은 값을 넣는다. */
export function buildAlphaAtlas() {
  const data = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  ALPHA_SHAPES.forEach((shape, i) => {
    const cx = (i % ATLAS_COLS) * ATLAS_CELL, cy = Math.floor(i / ATLAS_COLS) * ATLAS_CELL;
    for (let y = 0; y < ATLAS_CELL; y++) {
      for (let x = 0; x < ATLAS_CELL; x++) {
        const u = (x + 0.5) / ATLAS_CELL, v = (y + 0.5) / ATLAS_CELL;
        // 셀 경계 1px는 0으로 눌러 이웃 셀 번짐(밉맵·선형보간)을 막는다
        const edge = (x === 0 || y === 0 || x === ATLAS_CELL - 1 || y === ATLAS_CELL - 1) ? 0 : 1;
        const a = Math.round(255 * Math.min(1, Math.max(0, silhouette(shape, u, v))) * edge);
        const o = ((cy + y) * ATLAS_W + (cx + x)) * 4;
        data[o] = a; data[o + 1] = a; data[o + 2] = a; data[o + 3] = a;
      }
    }
  });
  const tex = new THREE.DataTexture(data, ATLAS_W, ATLAS_H, THREE.RGBAFormat);
  tex.name = 'FX_ALPHA_ATLAS';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** 실루엣 채움 비율 — 감사·자기증명용 (셀이 비었거나 꽉 찬 실루엣을 잡는다) */
export function coverageOf(shape) {
  let sum = 0;
  for (let y = 0; y < ATLAS_CELL; y++) {
    for (let x = 0; x < ATLAS_CELL; x++) {
      sum += Math.min(1, Math.max(0, silhouette(shape, (x + 0.5) / ATLAS_CELL, (y + 0.5) / ATLAS_CELL)));
    }
  }
  return sum / (ATLAS_CELL * ATLAS_CELL);
}

/* ---- 총구화염 텍스처 (R4 작업 3) ----
 * 종전 화염은 색만 있는 십자 쿼드 2장이었다(가장자리가 사각형 그대로 보인다).
 * 여기서 굽는 한 장이 실루엣(알파)과 중심→가장자리 색온도 변화를 함께 싣는다.
 * 프로그램 증가 없음 — FX_FLASH 재질은 이미 자기 프로그램을 쓰고 있었고 map 이 추가될 뿐이다.
 */
export const FLASH_TEX = 128;

export function buildFlashTexture() {
  const core = kelvinToRgb(FLASH_LOOK.coreK);
  const rim = kelvinToRgb(FLASH_LOOK.rimK);
  const data = new Uint8Array(FLASH_TEX * FLASH_TEX * 4);
  for (let y = 0; y < FLASH_TEX; y++) {
    for (let x = 0; x < FLASH_TEX; x++) {
      const u = (x + 0.5) / FLASH_TEX, v = (y + 0.5) / FLASH_TEX;
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const ang = Math.atan2(dy, dx);
      // 별 모양 분출: 4갈래 주 스파이크 + 불규칙 잔가지
      const spike = 0.42 + 0.34 * Math.pow(Math.abs(Math.cos(ang * 2)), 3)
        + 0.14 * (fbm(Math.cos(ang) * 2.5 + 9, Math.sin(ang) * 2.5 + 9, 101, 3) - 0.5);
      const body = step01(spike + 0.16, spike - 0.06, r);
      const hot = Math.pow(Math.max(0, 1 - r / 0.42), 2.0); // 중심 코어
      const a = Math.min(1, body + hot * 0.9);
      const t = Math.min(1, r / Math.max(spike, 1e-3));      // 0 중심 .. 1 가장자리
      const mix = (c0, c1) => c0 * (1 - t) + c1 * t;
      const gain = 0.55 + 0.45 * hot;
      const o = (y * FLASH_TEX + x) * 4;
      data[o]     = Math.round(255 * Math.min(1, mix(core[0], rim[0]) * gain));
      data[o + 1] = Math.round(255 * Math.min(1, mix(core[1], rim[1]) * gain));
      data[o + 2] = Math.round(255 * Math.min(1, mix(core[2], rim[2]) * gain));
      data[o + 3] = Math.round(255 * Math.min(1, Math.max(0, a)));
    }
  }
  const tex = new THREE.DataTexture(data, FLASH_TEX, FLASH_TEX, THREE.RGBAFormat);
  tex.name = 'FX_FLASH_TEX';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* ---- 탄흔 데칼 아틀라스 (R4 작업 2-d) ----
 * 3열 × 2행, 셀 64px. 알파만 싣는다(색은 인스턴스 컬러가 싣는다) — 표면별 색과
 * 실루엣을 따로 조합할 수 있어야 11종 표면을 6종 실루엣으로 덮는다.
 */
export const DECAL_CELL = 64;
export const DECAL_COLS = 3;
export const DECAL_ROWS = 2;

export function decalCellOf(shape) {
  const i = DECAL_SHAPES.indexOf(shape);
  if (i < 0) throw new Error(`unknown decal shape: ${shape}`);
  return [i % DECAL_COLS, Math.floor(i / DECAL_COLS)];
}

function decalSilhouette(shape, u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.hypot(dx, dy) * 2;
  const ang = Math.atan2(dy, dx);
  switch (shape) {
    case 'crater': {                                   // 흙 — 부드러운 분화구 + 흩뿌린 테두리
      const lump = 0.62 + 0.10 * (fbm(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5, 131, 2) - 0.5);
      const core = step01(lump + 0.22, lump - 0.10, r);
      const spray = step01(0.95, 0.62, r) * (fbm(u * 9, v * 9, 137, 2) > 0.52 ? 0.45 : 0);
      return Math.min(1, core + spray);
    }
    case 'splinter': {                                 // 목재 — 결 따라 갈라진 별
      const crack = Math.pow(Math.abs(Math.cos(ang * 1.5 + 0.4)), 4);
      const lump = 0.40 + 0.34 * crack + 0.10 * (fbm(Math.cos(ang) * 3 + 2, Math.sin(ang) * 3 + 2, 139, 3) - 0.5);
      return step01(lump + 0.12, lump - 0.06, r);
    }
    case 'spall': {                                    // 석재 — 속살이 떨어져 나간 각진 박리 + 방사 균열
      const facet = 0.46 + 0.16 * (fbm(Math.cos(ang) * 1.1 + 8, Math.sin(ang) * 1.1 + 8, 149, 3) - 0.5);
      const body = step01(facet + 0.06, facet - 0.03, r);
      const rad = Math.pow(Math.abs(Math.cos(ang * 3 + 1.1)), 12) * step01(0.98, 0.45, r);
      return Math.min(1, body + rad * 0.8);
    }
    case 'chip': {                                     // 기와 — 각진 구멍 + 깨진 조각 테
      const poly = 0.40 + 0.12 * Math.abs(Math.cos(ang * 2.5 + 0.8));
      const body = step01(poly + 0.05, poly - 0.02, r);
      const ring = step01(0.78, 0.52, r) * (fbm(u * 8 + 4, v * 8 + 4, 151, 2) > 0.58 ? 0.6 : 0);
      return Math.min(1, body + ring);
    }
    case 'dent': {                                     // 금속 — 작고 밝은 긁힌 눌림
      const e = Math.hypot(dx / 0.30, dy / 0.24);
      const body = step01(1.0, 0.55, e);
      const streak = step01(0.9, 0.2, Math.abs(dy) / 0.06) * step01(0.95, 0.3, Math.abs(dx) / 0.42);
      return Math.min(1, body + streak * 0.7);
    }
    case 'fray': {                                     // 섬유·짚 — 올이 삐져나온 구멍
      const hole = step01(0.36, 0.22, r);
      const fibers = Math.pow(Math.abs(Math.cos(ang * 7 + fbm(Math.cos(ang) * 4, Math.sin(ang) * 4, 157, 2) * 3)), 6)
        * step01(0.92, 0.28, r);
      return Math.min(1, hole + fibers * 0.85);
    }
    default: throw new Error(`unknown decal shape: ${shape}`);
  }
}

export function buildDecalAtlas() {
  const W = DECAL_CELL * DECAL_COLS, H = DECAL_CELL * DECAL_ROWS;
  const data = new Uint8Array(W * H * 4);
  DECAL_SHAPES.forEach((shape, i) => {
    const cx = (i % DECAL_COLS) * DECAL_CELL, cy = Math.floor(i / DECAL_COLS) * DECAL_CELL;
    for (let y = 0; y < DECAL_CELL; y++) {
      for (let x = 0; x < DECAL_CELL; x++) {
        const u = (x + 0.5) / DECAL_CELL, v = (y + 0.5) / DECAL_CELL;
        const edge = (x === 0 || y === 0 || x === DECAL_CELL - 1 || y === DECAL_CELL - 1) ? 0 : 1;
        const a = Math.round(255 * Math.min(1, Math.max(0, decalSilhouette(shape, u, v))) * edge);
        const o = ((cy + y) * W + (cx + x)) * 4;
        data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = a;
      }
    }
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.name = 'FX_DECAL_ATLAS';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** 데칼 실루엣 채움 비율 — overdraw 추정·자기증명 */
export function decalCoverageOf(shape) {
  let sum = 0;
  for (let y = 0; y < DECAL_CELL; y++) {
    for (let x = 0; x < DECAL_CELL; x++) {
      sum += Math.min(1, Math.max(0, decalSilhouette(shape, (x + 0.5) / DECAL_CELL, (y + 0.5) / DECAL_CELL)));
    }
  }
  return sum / (DECAL_CELL * DECAL_CELL);
}
