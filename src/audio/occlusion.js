/**
 * src/audio/occlusion.js — 표면 체인 오클루전 (P4-BRIEF §2-2 직선 경로).
 *
 * 입력은 `collectRayChain`이 돌려주는 층 목록 그대로다(음원 → 청자 방향).
 * 각 층은 표면 프로파일 × 실측 두께로 필터 단(stage)이 되고, 체인은 단을 직렬로 잇는다.
 *
 * 축 (판정 1-2 — audioaudit 가 렌더 신호에서 측정하는 4축과 같다):
 *   cutoffHz : 저역통과 차단 주파수 (12 dB/oct 2단 → 24 dB/oct)
 *   tlDb     : 투과 손실(감쇠) dB
 *   couple   : 잔향 결합 — 벽체가 받은 에너지를 자기 울림(body IR)으로 재방사하는 비율
 *   lagMs    : 투과 지연 — 벽체 질량-스프링 응답의 군지연 근사
 *   dip      : 선택. 중역 손실(피킹 컷) { hz, db } — 목재 (§2-2 "중역 손실, 저역 통과")
 *   bodyMs   : 재방사 울림의 감쇠 시간(-60 dB)
 *   modes    : 재방사 울림의 고유 모드 [[Hz, 상대 진폭], …] — 울림 소리는 프로파일 데이터만으로 정해진다
 *              (표면 이름으로 따로 고르면 같은 프로파일이 다른 소리를 낸다 — 케이스 21 음성 테스트가 잡아냄)
 *
 * 값은 **1단계 청감 잠정값**이다(§2-1: 2단계 옆방 녹음으로 재보정 전제). 게이트는 값이 아니라
 * "쌍마다 2축 이상 상이"를 렌더 신호로 본다.
 *
 * 차폐 표면(§2-5, 판정 1-3):
 *   - DECAL(`DANCHEONG` · `LACQUER`) — surfaces.js 가 audio:null "하부재를 따름"으로 동결. 층으로 와도 통과
 *   - GROUND_PLANE_SURFACES — 월드에서 지면 판(윗면 ≤ 0.5 m)으로만 쓰이는 표면. 음원과 청자
 *     사이에 벽으로 설 수 없고, 지면에 스치는 경로는 투과가 아니라 지면 반사다. 층으로 와도 통과.
 *     이 목록이 월드 실측과 같은지는 audioaudit 가 매번 기계적으로 재검증한다.
 */

import { SURFACES, PenClass } from '../core/surfaces.js';

/** 월드 실측에서 지면 판으로만 쓰이는 표면 (audioaudit [0] 이 재도출해 대조) */
export const GROUND_PLANE_SURFACES = Object.freeze(['PACKED_DIRT', 'WATER']);

/** 지면 판 판정 기준 — 모든 배치의 윗면이 이 높이(m) 이하 */
export const GROUND_PLANE_TOP_M = 0.5;

/**
 * 표면별 오클루전 프로파일 (refCm 두께 기준).
 * refCm 은 월드에서 그 표면이 쓰이는 전형 두께 — audioaudit 는 이 두께로 렌더한다.
 */
export const OCCLUSION_PROFILES = Object.freeze({
  HANJI:        Object.freeze({ refCm: 0.03, cutoffHz: 9000, tlDb: 1.5, couple: 0.00, lagMs: 0.10, bodyMs: 15, modes: [[900, 1]] }),
  WOOD_LATTICE: Object.freeze({ refCm: 3.0,  cutoffHz: 5200, tlDb: 4.0, couple: 0.12, lagMs: 0.35, bodyMs: 45, modes: [[640, 1], [1500, 0.5]], dip: { hz: 1800, db: -3 } }),
  FABRIC:       Object.freeze({ refCm: 0.5,  cutoffHz: 1900, tlDb: 7.0, couple: 0.00, lagMs: 0.15, bodyMs: 10, modes: [[300, 1]] }),
  WOOD_PLANK:   Object.freeze({ refCm: 3.0,  cutoffHz: 2600, tlDb: 17,  couple: 0.30, lagMs: 1.20, bodyMs: 70, modes: [[220, 1], [540, 0.6], [1150, 0.3]], dip: { hz: 800, db: -7 } }),
  WOOD_COLUMN:  Object.freeze({ refCm: 30,   cutoffHz: 1100, tlDb: 29,  couple: 0.22, lagMs: 2.40, bodyMs: 110, modes: [[140, 1], [380, 0.5]], dip: { hz: 600, db: -8 } }),
  EARTH_WALL:   Object.freeze({ refCm: 15,   cutoffHz: 420,  tlDb: 38,  couple: 0.06, lagMs: 4.00, bodyMs: 30, modes: [[70, 1], [160, 0.4]] }),
  ROOF_TILE:    Object.freeze({ refCm: 2.0,  cutoffHz: 3400, tlDb: 12,  couple: 0.45, lagMs: 0.70, bodyMs: 25, modes: [[1800, 1], [2750, 0.6]] }),
  GRANITE:      Object.freeze({ refCm: 30,   cutoffHz: 260,  tlDb: 58,  couple: 0.02, lagMs: 6.50, bodyMs: 20, modes: [[400, 1]] }),
  THATCH:       Object.freeze({ refCm: 30,   cutoffHz: 1300, tlDb: 15,  couple: 0.03, lagMs: 1.20, bodyMs: 12, modes: [[250, 1]] }),
  BRONZE:       Object.freeze({ refCm: 5.0,  cutoffHz: 900,  tlDb: 44,  couple: 0.90, lagMs: 3.00, bodyMs: 900, modes: [[112, 1], [224, 0.8], [265, 0.5], [448, 0.5]] }),
  ROOF_SOIL:    Object.freeze({ refCm: 10,   cutoffHz: 850,  tlDb: 25,  couple: 0.02, lagMs: 1.80, bodyMs: 12, modes: [[120, 1]] }),
});

/** 층이 오클루전에 관여하지 않는가 (DECAL · 지면 판) */
export function isPassThrough(surface) {
  const def = SURFACES[surface];
  if (!def) throw new Error(`audio occlusion: unknown surface ${surface}`); // PATCH-001-D: 조용한 무시 금지
  return def.penClass === PenClass.DECAL || GROUND_PLANE_SURFACES.includes(surface);
}

/** surfaces.js 에서 기계적으로 뽑은 차폐 표면 목록 (선언 순서 유지) */
export function occluderSurfaces() {
  return Object.keys(SURFACES).filter((s) => !isPassThrough(s));
}

/**
 * 층 하나의 응답 — 두께 보정 포함.
 * 질량 법칙: 두께(면밀도) 2배당 투과 손실 +6 dB. 차단 주파수는 √ 비로 내려가고 지연은 √ 비로 는다.
 * 극단 두께(퇴화 체인)에 대비해 비율을 [1/8, 8]로 자른다.
 */
export function layerResponse(surface, thicknessCm, profiles = OCCLUSION_PROFILES) {
  const p = profiles[surface];
  if (!p) throw new Error(`audio occlusion: no profile for ${surface}`);
  const r = Math.min(8, Math.max(1 / 8, (thicknessCm > 0 ? thicknessCm : p.refCm) / p.refCm));
  const s = Math.sqrt(r);
  return {
    surface,
    cutoffHz: Math.min(20000, p.cutoffHz / s),
    tlDb: p.tlDb + 6 * Math.log2(r),
    couple: p.couple,
    lagMs: p.lagMs * s,
    bodyMs: p.bodyMs,
    modes: p.modes,
    dip: p.dip ?? null,
  };
}

/** 직렬 필터 단 상한 — 이 수를 넘는 층은 감쇠·지연만 합산한다(런타임 노드 수 유계) */
export const MAX_STAGES = 4;

/**
 * 체인 → 경로 응답.
 * @param {Array<{surface:string, thicknessCm:number}>} layers  음원 → 청자 순
 * @returns {{stages:Array, tlDb:number, lagMs:number, couple:number, bodySurface:string|null,
 *            bodyMs:number, surfaces:string[], blocked:boolean}}
 */
export function chainResponse(layers, profiles = OCCLUSION_PROFILES) {
  const resp = [];
  for (const L of layers) {
    if (isPassThrough(L.surface)) continue;
    resp.push(layerResponse(L.surface, L.thicknessCm, profiles));
  }
  let tlDb = 0, lagMs = 0;
  for (const r of resp) { tlDb += r.tlDb; lagMs += r.lagMs; }
  // 필터 단: 감쇠가 큰 순으로 MAX_STAGES 개, 체인 순서는 유지 (결정적 동순위: 앞선 층 우선)
  const ranked = resp.map((r, i) => ({ r, i })).sort((a, b) => (b.r.tlDb - a.r.tlDb) || (a.i - b.i));
  const keep = new Set(ranked.slice(0, MAX_STAGES).map((x) => x.i));
  const stages = resp.filter((_, i) => keep.has(i));
  // 청자 쪽 방으로 재방사하는 것은 마지막 벽이다
  const last = resp.length ? resp[resp.length - 1] : null;
  return {
    stages,
    tlDb,
    lagMs,
    couple: last ? last.couple : 0,
    bodySurface: last ? last.surface : null,
    bodyMs: last ? last.bodyMs : 0,
    bodyModes: last ? last.modes : null,
    surfaces: resp.map((r) => r.surface),
    blocked: resp.some((r) => SURFACES[r.surface].penClass === PenClass.BLOCK),
  };
}
