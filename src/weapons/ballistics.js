/**
 * src/weapons/ballistics.js — 관통 계수 k의 유일한 적용 지점 (PATCH-002-A).
 *
 * 동결 computePenetration()이 유일 규범이며(PATCH-001-B), 이 모듈은
 * "실효 두께 = 실측 두께 / k" 스케일만 수행한다. 자체 임계·재분류 금지.
 */

import { computePenetration } from '../core/surfaces.js';
import { PENETRATE_RATIO } from './params.js';

/**
 * 무기 관통 계산. 레이어 두께를 k로 나눠 동결 함수에 전달한다.
 * @param {{k:number}} weapon  WEAPONS 항목
 * @param {number} energy0     초기 에너지 (J)
 * @param {Array<{surface:string, thicknessCm:number}>} layers 진입 순서
 */
export function penetrate(weapon, energy0, layers) {
  return computePenetration(
    energy0,
    layers.map((l) => ({ surface: l.surface, thicknessCm: l.thicknessCm / weapon.k })),
  );
}

/**
 * §2-1 분류: 'pen'(관통) / 'partial'(부분) / 'stop'(정지).
 * 동결 함수 출력만 사용 — stoppedAt이면 정지, 잔여/초기 ≥ 15%면 관통.
 */
export function classify(weapon, layers, energy0 = weapon.energy) {
  const r = penetrate(weapon, energy0, layers);
  if (r.stoppedAt !== null) return 'stop';
  return r.residual / energy0 >= PENETRATE_RATIO ? 'pen' : 'partial';
}
