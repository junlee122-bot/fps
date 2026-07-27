/**
 * src/core/surfaces.js
 *
 * ============================ 동결 계약 파일 ============================
 * 이 파일은 materials / physics / fx / audio 네 서브시스템이 공유하는 단일 진실이다.
 * 어떤 에이전트도 이 파일을 단독으로 수정할 수 없다.
 * 변경이 필요하면 작업을 멈추고 사유와 함께 제안을 보고할 것.
 *
 * 이 프로젝트의 게임플레이는 아래 테이블에서 나온다.
 * 핵심 명제: GRANITE만이 유일한 완전 차단재다. 그 외 모든 표면은 관통된다.
 * =====================================================================
 */

/** 관통 등급 */
export const PenClass = Object.freeze({
  FREE:    'free',     // 저항 없음. 엄폐물 아님
  LIGHT:   'light',    // 관통, 경미한 감속
  MEDIUM:  'medium',   // 관통, 상당한 감속
  HEAVY:   'heavy',    // 부분 관통. 고에너지탄만
  BLOCK:   'block',    // 완전 차단
  DECAL:   'decal',    // 시각 레이어. 하부재의 물성을 따름
});

/**
 * 표면 물성 테이블
 *
 * energyRetain : 두께 1cm 통과 시 잔여 운동에너지 비율 (0~1)
 * density      : 관통 계산용 상대 밀도 (누적 두께 가중치)
 * opaque       : 시야 차단 여부
 * translucent  : 광투과 여부 (render가 구독)
 * dynamicOpacity : 피격 누적으로 투과율이 변하는가 (HANJI 전용)
 * breachable   : 누적 피격으로 국소 붕괴하는가
 * fx           : 임팩트 파편 프로파일 키
 * audio        : 임팩트 사운드 프로파일 키
 * ricochet     : 도탄 확률 (0~1)
 */
export const SURFACES = Object.freeze({

  /** 창호지 — 엄폐물이 아니다. 실루엣 사격의 기반 */
  HANJI: Object.freeze({
    id: 'HANJI',
    penClass: PenClass.FREE,
    energyRetain: 0.99,
    density: 0.02,
    opaque: false,
    translucent: true,
    dynamicOpacity: true,
    breachable: true,
    fx: 'paper_tear',
    audio: 'paper_rupture',
    ricochet: 0.0,
  }),

  /** 목재 창살 — 창호지와 레이어 결합 */
  WOOD_LATTICE: Object.freeze({
    id: 'WOOD_LATTICE',
    penClass: PenClass.LIGHT,
    energyRetain: 0.85,
    density: 0.35,
    opaque: false,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'wood_splinter_fine',
    audio: 'wood_crack_light',
    ricochet: 0.05,
  }),

  /** 마루판·문판 */
  WOOD_PLANK: Object.freeze({
    id: 'WOOD_PLANK',
    penClass: PenClass.LIGHT,
    energyRetain: 0.70,
    density: 0.50,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'wood_splinter',
    audio: 'wood_thud',
    ricochet: 0.08,
  }),

  /** 기둥 — 관통 가능. 신뢰할 수 없는 엄폐물 */
  WOOD_COLUMN: Object.freeze({
    id: 'WOOD_COLUMN',
    penClass: PenClass.MEDIUM,
    energyRetain: 0.59, // [PATCH-002-D] 0.35 → 0.59 (밀리미터 스케일 상수의 데시미터 부재 적용 오류 정정)
    density: 0.65,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: false,
    fx: 'wood_gouge',
    audio: 'wood_deep',
    ricochet: 0.10,
  }),

  /** 흙벽 — 누적 피격 시 국소 붕괴 */
  EARTH_WALL: Object.freeze({
    id: 'EARTH_WALL',
    penClass: PenClass.HEAVY,
    energyRetain: 0.235, // [PATCH-002-D] 0.25 → 0.235 (PATCH-002-E 여유 요건 재도출)
    density: 0.80,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'dust_burst',
    audio: 'muffled_thud',
    ricochet: 0.02,
  }),

  /** 기와 — 파편이 물리 객체로 낙하 */
  ROOF_TILE: Object.freeze({
    id: 'ROOF_TILE',
    penClass: PenClass.LIGHT,
    energyRetain: 0.60,
    density: 0.55,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'ceramic_shatter',
    audio: 'ceramic_crack',
    ricochet: 0.20,
  }),

  /** 화강암 기단·초석 — 유일한 완전 차단재 */
  GRANITE: Object.freeze({
    id: 'GRANITE',
    penClass: PenClass.BLOCK,
    energyRetain: 0.0,
    density: 1.0,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: false,
    fx: 'stone_spark',
    audio: 'stone_sharp',
    ricochet: 0.45,
  }),

  /** 단청 도장면 — 시각 레이어. 박리되면 하부 목재 노출 */
  DANCHEONG: Object.freeze({
    id: 'DANCHEONG',
    penClass: PenClass.DECAL,
    energyRetain: 1.0,
    density: 0.0,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'paint_flake',
    audio: null,      // 하부재를 따름
    ricochet: 0.0,
  }),

  /** 옻칠 — 시각 레이어 */
  LACQUER: Object.freeze({
    id: 'LACQUER',
    penClass: PenClass.DECAL,
    energyRetain: 1.0,
    density: 0.0,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'lacquer_crater',
    audio: null,
    ricochet: 0.0,
  }),

  /** 무명·삼베·발 — 시야만 차단 */
  FABRIC: Object.freeze({
    id: 'FABRIC',
    penClass: PenClass.FREE,
    energyRetain: 0.98,
    density: 0.03,
    opaque: true,
    translucent: true,
    dynamicOpacity: false,
    breachable: true,
    fx: 'cloth_cut',
    audio: 'cloth_soft',
    ricochet: 0.0,
  }),

  /** 초가 */
  THATCH: Object.freeze({
    id: 'THATCH',
    penClass: PenClass.LIGHT,
    energyRetain: 0.75,
    density: 0.25,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'straw_scatter',
    audio: 'straw_rustle',
    ricochet: 0.0,
  }),

  /** 청동 범종·솥 — 장시간 공명. 오디오 시그니처 */
  BRONZE: Object.freeze({
    id: 'BRONZE',
    penClass: PenClass.BLOCK,
    energyRetain: 0.0,
    density: 1.0,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: false,
    fx: 'metal_spark',
    audio: 'bronze_resonate',   // 감쇠 3s 이상
    ricochet: 0.55,
  }),

  /** 연못 — 거리 기반 감쇠 */
  WATER: Object.freeze({
    id: 'WATER',
    penClass: PenClass.MEDIUM,
    energyRetain: 0.40,
    density: 0.60,
    opaque: false,
    translucent: true,
    dynamicOpacity: false,
    breachable: false,
    fx: 'water_plume',
    audio: 'water_impact',
    ricochet: 0.30,           // 저입사각에서 도탄
  }),

  /** 다짐흙 마당 */
  PACKED_DIRT: Object.freeze({
    id: 'PACKED_DIRT',
    penClass: PenClass.BLOCK,
    energyRetain: 0.0,
    density: 1.0,
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: false,
    fx: 'dirt_puff',
    audio: 'dirt_dull',
    ricochet: 0.05,
  }),

  /**
   * 지붕 보토(알매흙) — 기와 아래 완충토. [PATCH-003-A]
   * 심벽(EARTH_WALL)과의 병합 정정: 산자 위 이완 흙층은 다진 벽체 충전재와
   * 재료·밀도·시공이 다르다. 신설이 아니라 잘못된 병합의 정정.
   * (기존 표면 인덱스 보존을 위해 반드시 마지막에 추가)
   */
  ROOF_SOIL: Object.freeze({
    id: 'ROOF_SOIL',
    penClass: PenClass.LIGHT,
    energyRetain: 0.39,
    density: 0.50,      // EARTH_WALL(0.80) 미만 제약 [PATCH-003-A]
    opaque: true,
    translucent: false,
    dynamicOpacity: false,
    breachable: true,
    fx: 'soil_puff',    // EARTH_WALL 'dust_burst'와 구별 [PATCH-003-B 3항]
    audio: 'soil_dull', // EARTH_WALL 'muffled_thud'와 구별
    ricochet: 0.02,
  }),
});

/** 완전 차단재 목록 — 레벨 디자인·AI 엄폐 선택의 기준 */
export const COVER_SURFACES = Object.freeze(
  Object.values(SURFACES)
    .filter(s => s.penClass === PenClass.BLOCK)
    .map(s => s.id)
);

/** 시각 전용 레이어 — 관통 계산에서 제외 */
export const DECAL_SURFACES = Object.freeze(
  Object.values(SURFACES)
    .filter(s => s.penClass === PenClass.DECAL)
    .map(s => s.id)
);

/** 수직 엄폐물로 기능하는 표면 — 레벨 검증·AI 엄폐 선택의 기준 (CONTRACT-PATCH-001-A) */
export const VERTICAL_COVER_SURFACES = Object.freeze(['GRANITE', 'BRONZE']);

/** 맵당 배치 상한. 초과 시 레벨 검증 실패 (CONTRACT-PATCH-001-A) */
export const COVER_PLACEMENT_LIMITS = Object.freeze({ BRONZE: 3 });

/**
 * 다층 관통 계산.
 * 탄환은 창호지 → 창살 → 실내 → 반대편 창호지처럼 한 발에 여러 레이어를 통과한다.
 *
 * @param {number} energy0            초기 운동에너지
 * @param {Array<{surface, thicknessCm}>} layers  진입 순서대로
 * @returns {{residual:number, stoppedAt:number|null, path:Array}}
 */
export function computePenetration(energy0, layers) {
  let energy = energy0;
  const path = [];

  for (let i = 0; i < layers.length; i++) {
    const { surface, thicknessCm } = layers[i];
    const s = SURFACES[surface];

    if (!s) throw new Error(`unknown surface: ${surface}`);
    if (s.penClass === PenClass.DECAL) continue;   // 시각 레이어는 스킵

    if (s.penClass === PenClass.BLOCK) {
      path.push({ layer: i, surface, entered: true, exited: false, residual: 0 });
      return { residual: 0, stoppedAt: i, path };
    }

    // 두께 1cm당 energyRetain을 지수 적용, 밀도로 실효 두께 가중
    const effective = thicknessCm * (1 + s.density);
    const retained = Math.pow(s.energyRetain, effective);
    const after = energy * retained;

    path.push({ layer: i, surface, entered: true, exited: after > 0, residual: after });

    energy = after;

    // 실효 정지 임계값
    if (energy < energy0 * 0.02) {
      return { residual: 0, stoppedAt: i, path };
    }
  }

  return { residual: energy, stoppedAt: null, path };
}
