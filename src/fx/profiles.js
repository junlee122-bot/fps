/**
 * src/fx/profiles.js — 표면별 파티클 방출 프로파일 15종 (P2B-BRIEF §2).
 *
 * FX는 표면이 결정한다: surfaces.js의 fx 필드 15키 전수 대응.
 * PATCH-003-B 3항("플레이어 구별 가능성")의 첫 검증 지점 — 모든 쌍이
 * 5축(count/speed/life/size/gravityK) 중 **최소 2축**에서 상대차 15% 이상으로
 * 구별되어야 하며, tools/fxaudit.mjs가 게이트한다. 특히 ROOF_SOIL(soil_puff)은
 * EARTH_WALL(dust_burst)과 달라야 PATCH-003-A의 승인 근거가 유지된다.
 *
 * 회색 규율: brightness는 3단계(0=어두움,1=중간,2=밝음) 무채색 인덱스만.
 * 색·발광·톤은 P3 소유 — 여기는 운동학 파라미터만 소유한다.
 */

/**
 * 필드:
 *  count    발 당 방출 입자 수
 *  speed    [min,max] 초기 속도 m/s (시드 RNG 균일)
 *  life     [min,max] 수명 s
 *  size     [min,max] 입자 한 변 m
 *  gravityK 중력 계수 (1 = 월드 중력)
 *  spread   방출 원뿔 반각 rad (표면 노멀 기준)
 *  drag     지수 감속 계수 1/s
 *  brightness 0|1|2 — 회색 3단계
 */
export const FX_PROFILES = Object.freeze({
  paper_tear:         Object.freeze({ count: 8,  speed: [1.4, 2.6],  life: [0.40, 0.60], size: [0.024, 0.036], gravityK: 0.15, spread: 0.9, drag: 2.6, brightness: 2 }),
  wood_splinter_fine: Object.freeze({ count: 14, speed: [3.8, 6.2],  life: [0.35, 0.55], size: [0.008, 0.016], gravityK: 1.0,  spread: 0.6, drag: 1.2, brightness: 1 }),
  wood_splinter:      Object.freeze({ count: 20, speed: [5.0, 8.0],  life: [0.50, 0.70], size: [0.014, 0.026], gravityK: 1.0,  spread: 0.7, drag: 1.0, brightness: 1 }),
  wood_gouge:         Object.freeze({ count: 10, speed: [2.6, 4.4],  life: [0.28, 0.42], size: [0.022, 0.034], gravityK: 1.2,  spread: 0.5, drag: 1.4, brightness: 1 }),
  dust_burst:         Object.freeze({ count: 36, speed: [2.2, 3.8],  life: [0.90, 1.30], size: [0.036, 0.054], gravityK: 0.12, spread: 1.1, drag: 2.2, brightness: 2 }),
  ceramic_shatter:    Object.freeze({ count: 16, speed: [4.2, 6.8],  life: [0.65, 0.95], size: [0.018, 0.030], gravityK: 1.6,  spread: 0.8, drag: 0.6, brightness: 0 }),
  stone_spark:        Object.freeze({ count: 12, speed: [7.5, 10.5], life: [0.16, 0.28], size: [0.006, 0.010], gravityK: 0.5,  spread: 0.4, drag: 0.8, brightness: 2 }),
  paint_flake:        Object.freeze({ count: 9,  speed: [1.2, 2.0],  life: [0.55, 0.85], size: [0.012, 0.020], gravityK: 0.7,  spread: 0.8, drag: 1.8, brightness: 2 }),
  lacquer_crater:     Object.freeze({ count: 6,  speed: [2.0, 3.2],  life: [0.24, 0.36], size: [0.008, 0.012], gravityK: 0.9,  spread: 0.5, drag: 1.5, brightness: 0 }),
  cloth_cut:          Object.freeze({ count: 5,  speed: [0.9, 1.5],  life: [0.65, 0.95], size: [0.020, 0.032], gravityK: 0.25, spread: 1.0, drag: 3.0, brightness: 1 }),
  straw_scatter:      Object.freeze({ count: 24, speed: [1.8, 3.0],  life: [1.15, 1.65], size: [0.028, 0.040], gravityK: 0.35, spread: 1.2, drag: 1.6, brightness: 1 }),
  metal_spark:        Object.freeze({ count: 18, speed: [9.0, 13.0], life: [0.13, 0.23], size: [0.004, 0.008], gravityK: 0.4,  spread: 0.35, drag: 0.5, brightness: 2 }),
  water_plume:        Object.freeze({ count: 28, speed: [3.4, 5.0],  life: [0.60, 0.90], size: [0.032, 0.048], gravityK: 2.2,  spread: 0.3, drag: 0.9, brightness: 2 }),
  dirt_puff:          Object.freeze({ count: 22, speed: [1.7, 2.7],  life: [0.75, 1.05], size: [0.042, 0.058], gravityK: 0.8,  spread: 0.9, drag: 2.0, brightness: 1 }),
  soil_puff:          Object.freeze({ count: 12, speed: [1.1, 1.9],  life: [0.40, 0.60], size: [0.046, 0.064], gravityK: 2.6,  spread: 0.6, drag: 1.9, brightness: 1 }),
});

/** 구별성 판정 축 — fxaudit·자기증명 공용 (스칼라화: 구간은 평균) */
export const DISTINCT_AXES = Object.freeze(['count', 'speed', 'life', 'size', 'gravityK']);
export const DISTINCT_REL_MIN = 0.15; // 축 상이 판정: 상대차 15% 초과
export const DISTINCT_AXES_MIN = 2;   // 쌍마다 최소 2축

export function axisScalar(profile, axis) {
  const v = profile[axis];
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/**
 * 전 쌍 구별성 검사. 반환: { ok, pairs: [{a, b, axes, ok}] } —
 * axes = 상이 축 목록. fxaudit이 게이트로, 테스트가 증명으로 사용.
 */
export function checkDistinctness(profiles = FX_PROFILES) {
  const keys = Object.keys(profiles);
  const pairs = [];
  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = profiles[keys[i]], b = profiles[keys[j]];
      const axes = DISTINCT_AXES.filter((ax) => {
        const va = axisScalar(a, ax), vb = axisScalar(b, ax);
        const rel = Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1e-9);
        return rel > DISTINCT_REL_MIN;
      });
      const pairOk = axes.length >= DISTINCT_AXES_MIN;
      if (!pairOk) ok = false;
      pairs.push({ a: keys[i], b: keys[j], axes, ok: pairOk });
    }
  }
  return { ok, pairs };
}
