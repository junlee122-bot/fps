/**
 * src/physics/surface-registry.js — 동결 계약(core/surfaces.js)의 물리 어댑터.
 *
 * BVH·컨트롤러·강체는 표면을 정수 인덱스로 다룬다(트라이앵글당 Uint8).
 * 이 파일이 (표면 id 문자열) ↔ (정수 인덱스) 매핑과, 물리 전용 튜닝값
 * (마찰·반발 — 동결 계약에 없는 물리 소유 데이터)을 제공한다.
 *
 * 인덱스는 SURFACES의 삽입 순서로 고정된다. surfaces.js가 동결이므로
 * 이 매핑도 안정적이다.
 */

import { SURFACES } from '../core/surfaces.js';

/** 인덱스 → 표면 id 문자열 ('HANJI', ...) */
export const SURFACE_KEYS = Object.freeze(Object.keys(SURFACES));

const KEY_TO_INDEX = new Map(SURFACE_KEYS.map((k, i) => [k, i]));

/** 표면 id 문자열(또는 이미 인덱스인 값) → 정수 인덱스. 미지의 표면은 throw */
export function surfaceIndex(surface) {
  if (typeof surface === 'number') {
    if (surface < 0 || surface >= SURFACE_KEYS.length) throw new Error(`surface index out of range: ${surface}`);
    return surface;
  }
  const i = KEY_TO_INDEX.get(surface);
  if (i === undefined) throw new Error(`unknown surface: ${surface}`);
  return i;
}

export function surfaceName(index) {
  return SURFACE_KEYS[index] ?? 'UNKNOWN';
}

/** 인덱스 → 동결 계약 물성 레코드 */
export function surfaceDef(index) {
  return SURFACES[SURFACE_KEYS[index]];
}

/**
 * 물리 전용 튜닝: 접촉 마찰·반발 계수. 관통·게임플레이 물성은 전부
 * 동결 계약이 소유하고, 여기는 "몸이 밟고 부딪히는 느낌"만 소유한다.
 */
export const SURFACE_PROPS = Object.freeze(
  SURFACE_KEYS.map((key) => {
    switch (key) {
      case 'GRANITE':     return { friction: 0.92, restitution: 0.18 };
      case 'PACKED_DIRT': return { friction: 0.90, restitution: 0.05 };
      case 'EARTH_WALL':  return { friction: 0.85, restitution: 0.04 };
      case 'WOOD_PLANK':  return { friction: 0.72, restitution: 0.22 };
      case 'WOOD_COLUMN': return { friction: 0.70, restitution: 0.20 };
      case 'WOOD_LATTICE':return { friction: 0.68, restitution: 0.15 };
      case 'ROOF_TILE':   return { friction: 0.55, restitution: 0.30 };
      case 'BRONZE':      return { friction: 0.45, restitution: 0.40 };
      case 'LACQUER':     return { friction: 0.40, restitution: 0.25 };
      case 'WATER':       return { friction: 0.10, restitution: 0.00 };
      case 'HANJI':       return { friction: 0.60, restitution: 0.02 };
      case 'FABRIC':      return { friction: 0.75, restitution: 0.02 };
      case 'THATCH':      return { friction: 0.80, restitution: 0.03 };
      case 'DANCHEONG':   return { friction: 0.70, restitution: 0.20 };
      default:            return { friction: 0.80, restitution: 0.10 };
    }
  })
);

/** 충돌 레이어 비트 */
export const LAYER = Object.freeze({
  STATIC: 1 << 0,
  DEBRIS_ONLY: 1 << 1, // 캐릭터는 통과, 파편만 충돌 (P2 이후 사용)
});

/** 질의 마스크 */
export const MASK = Object.freeze({
  CHARACTER: LAYER.STATIC,
  DEBRIS: LAYER.STATIC | LAYER.DEBRIS_ONLY,
  BULLET: LAYER.STATIC | LAYER.DEBRIS_ONLY,
  ALL: 0xffff,
});
