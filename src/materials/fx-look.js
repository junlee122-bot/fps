/**
 * src/materials/fx-look.js — 표면 fx 15종의 룩(색·모양). P3 소유.
 *
 * 분업: src/fx/profiles.js 는 운동학(count/speed/life/size/gravityK/spread/drag)만
 * 소유하고, 이 표가 플레이어가 실제로 보는 것(색상·명도·종횡비·알파 실루엣)을
 * 소유한다. profiles.js 의 brightness(회색 3단계)는 P2B의 자리표시자였고, 이 표가
 * 그 자리를 대신한다.
 *
 * 왜 게이트 축인가 (발주자 지시 2026-09-20):
 *   PATCH-003-B 3항이 ROOF_SOIL을 새 재료로 승인한 근거는 "플레이어가 구별할 수
 *   있다"였다. 그런데 구별성 게이트의 축은 운동학 5개뿐이어서, 플레이어가 실제로
 *   보는 색·모양은 한 번도 검사되지 않았다. 여기에 시각 축 4개를 추가해
 *   tools/fxaudit.mjs 가 함께 게이트한다.
 *
 * 팔레트 규율 (tools/paletteaudit.mjs §4 표) 준수:
 *   s < 0.10 중성 무제한 / 175–240 청 / 355–15 적 / 40–60 황 / 20–40 목재·흙은 s ≤ 0.35.
 *   아래 색은 전부 이 표 안에 있다 (paletteInBand 자기검사로 증명).
 *
 * 필드:
 *   hue        색상 0–360 (도)
 *   sat        채도 0–1 (HSV S)
 *   light      명도 0–1 (HSV V) — 인스턴스 컬러의 선형 기준값
 *   aspect     빌보드 종횡비 (가로/세로, 1 = 정사각)
 *   alphaShape 알파 실루엣 키 (범주형 축) — 아틀라스 셀 이름
 *   emissive   0–1 자발광 가중 (0 = 없음). 스파크 2종만 > 0.
 *   align      'velocity' = 빌보드를 화면 투영 속도 방향으로 눕힌다(불똥). 생략 = 고정 롤.
 */

/** 알파 실루엣 셀 — 아틀라스 배치 순서와 동일 (P3 작업 2에서 생성) */
export const ALPHA_SHAPES = Object.freeze(['puff', 'grit', 'clod', 'shard', 'sliver', 'chip', 'flake', 'streak']);

export const FX_LOOK = Object.freeze({
  // 한지 조각 — 거의 흰색, 찢긴 띠
  paper_tear:         Object.freeze({ hue:  42, sat: 0.08, light: 0.82, aspect: 1.55, alphaShape: 'shard',  emissive: 0 }),
  // 나무 — 결 방향으로 길쭉한 가시. 굵기·명도로 3종 분리 (파임은 속살이라 더 밝다)
  wood_splinter_fine: Object.freeze({ hue:  30, sat: 0.28, light: 0.44, aspect: 3.20, alphaShape: 'sliver', emissive: 0 }),
  wood_splinter:      Object.freeze({ hue:  30, sat: 0.30, light: 0.36, aspect: 2.40, alphaShape: 'sliver', emissive: 0 }),
  wood_gouge:         Object.freeze({ hue:  32, sat: 0.26, light: 0.38, aspect: 1.30, alphaShape: 'chip',   emissive: 0 }),
  // 흙벽 — 마르고 밝은 먼지, 둥글게 퍼짐
  dust_burst:         Object.freeze({ hue:  34, sat: 0.16, light: 0.72, aspect: 1.00, alphaShape: 'puff',   emissive: 0 }),
  // 기와 — 차가운 무채, 각진 파편
  ceramic_shatter:    Object.freeze({ hue: 212, sat: 0.06, light: 0.26, aspect: 1.15, alphaShape: 'shard',  emissive: 0 }),
  // 돌 — 짧은 불똥 (황 대역)
  stone_spark:        Object.freeze({ hue:  46, sat: 0.14, light: 0.78, aspect: 4.00, alphaShape: 'streak', emissive: 0.35, align: 'velocity' }),
  // 단청 — 유일한 채도 있는 적 대역
  paint_flake:        Object.freeze({ hue:   8, sat: 0.30, light: 0.54, aspect: 1.65, alphaShape: 'flake',  emissive: 0 }),
  // 옻칠 — 가장 어두움
  lacquer_crater:     Object.freeze({ hue:  25, sat: 0.18, light: 0.16, aspect: 1.10, alphaShape: 'chip',   emissive: 0 }),
  // 천 — 쪽염 장막, 유일한 청 대역 채도
  cloth_cut:          Object.freeze({ hue: 215, sat: 0.30, light: 0.40, aspect: 1.85, alphaShape: 'flake',  emissive: 0 }),
  // 초가·이엉 — 밝은 황, 가장 긴 지푸라기
  straw_scatter:      Object.freeze({ hue:  50, sat: 0.28, light: 0.64, aspect: 3.60, alphaShape: 'sliver', emissive: 0 }),
  // 금속 — 가장 밝고 가장 긴 불똥
  metal_spark:        Object.freeze({ hue:  42, sat: 0.22, light: 0.96, aspect: 5.50, alphaShape: 'streak', emissive: 0.85, align: 'velocity' }),
  // 물 — 푸른 기 도는 밝은 물보라
  water_plume:        Object.freeze({ hue: 202, sat: 0.10, light: 0.80, aspect: 1.25, alphaShape: 'puff',   emissive: 0 }),
  // 마당 흙 — 마른 중간 밝기 흙먼지
  dirt_puff:          Object.freeze({ hue:  32, sat: 0.20, light: 0.54, aspect: 1.05, alphaShape: 'grit',   emissive: 0 }),
  // 지붕 보토 — 젖고 어두운 흙덩이 (ROOF_SOIL: dust_burst와 달라야 003-B 근거 유지)
  soil_puff:          Object.freeze({ hue:  26, sat: 0.22, light: 0.30, aspect: 1.35, alphaShape: 'clod',   emissive: 0 }),
});

/** 시각 구별 축 — 연속 3축 + 범주 1축 */
export const VISUAL_AXES = Object.freeze(['hue', 'light', 'aspect', 'alphaShape']);
export const VISUAL_AXES_MIN = 2;      // 쌍마다 최소 2축 — 운동학 규칙과 대칭 (실측 105쌍 전부 충족)
export const VISUAL_REL_MIN = 0.15;    // 명도·종횡비 상대차 15% 초과
export const VISUAL_HUE_MIN_DEG = 12;  // 색상 원형 거리 12도 초과
export const VISUAL_SAT_MIN = 0.06;    // 이보다 낮으면 색상은 무의미 — 축에서 제외

/** HSV → sRGB 0..1 3성분 — 룩 표가 HSV(팔레트 감사와 같은 좌표계)이므로 변환은 여기 한 곳에 둔다 */
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const k = Math.floor(((h % 360) + 360) % 360 / 60);
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return [t[0] + m, t[1] + m, t[2] + m];
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 두 룩이 상이한 시각 축 목록 */
export function visualAxesDiff(a, b) {
  const axes = [];
  if (a.sat >= VISUAL_SAT_MIN && b.sat >= VISUAL_SAT_MIN && hueDist(a.hue, b.hue) > VISUAL_HUE_MIN_DEG) axes.push('hue');
  for (const ax of ['light', 'aspect']) {
    const rel = Math.abs(a[ax] - b[ax]) / Math.max(Math.abs(a[ax]), Math.abs(b[ax]), 1e-9);
    if (rel > VISUAL_REL_MIN) axes.push(ax);
  }
  if (a.alphaShape !== b.alphaShape) axes.push('alphaShape');
  return axes;
}

/** 전 쌍 시각 구별성. 반환 형식은 checkDistinctness와 동일 */
export function checkVisualDistinctness(looks = FX_LOOK) {
  const keys = Object.keys(looks);
  const pairs = [];
  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const axes = visualAxesDiff(looks[keys[i]], looks[keys[j]]);
      const pairOk = axes.length >= VISUAL_AXES_MIN;
      if (!pairOk) ok = false;
      pairs.push({ a: keys[i], b: keys[j], axes, ok: pairOk });
    }
  }
  return { ok, pairs };
}

/** 팔레트 규율 자기검사 — paletteaudit §4 표를 색 정의 시점에 적용 */
export function paletteInBand(look) {
  const { hue: h, sat: s } = look;
  if (s < 0.10) return true;
  if (h >= 175 && h <= 240) return true;
  if (h >= 355 || h <= 15) return true;
  if (h >= 40 && h <= 60) return true;
  if (h >= 20 && h < 40 && s <= 0.35) return true;
  return false;
}

/* ===================== 일시광 룩 (R4 작업 3) =====================
 * 총구화염·예광은 입자와 달리 인스턴스가 아니라 단일 지오메트리다. 색·곡선·감쇠는
 * 여기(P3)가 소유하고, src/fx/muzzleflash.js·tracers.js 는 그 값을 읽어 배선만 한다.
 * P2B가 남긴 훅: `colorK: 6500`(발행되지만 아무도 읽지 않던 값)과 "고정 강도 + 선형 감쇠".
 */

/** 색온도 → sRGB 정규화 3성분 (Tanner Helland 근사, 1000–12000K) */
export function kelvinToRgb(k) {
  const t = Math.min(12000, Math.max(1000, k)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; } else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); }
  if (t <= 66) { g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) { b = 255; }
  else if (t <= 19) { b = 0; }
  else { b = 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

/**
 * 총구화염.
 *  coreK/rimK  중심·가장자리 색온도 — 화약 화염은 중심이 희고 가장자리가 붉다
 *  peakGain    첫 프레임 선형 색 배수 (AgX가 압축한다)
 *  riseFrac    수명 중 팽창 구간 비율 (나머지는 감쇠)
 *  decayCurve  감쇠 지수 — 1 = 선형(P2B), >1 = 앞이 밝고 뒤가 빨리 죽는다
 *  lightK      트랜지언트 라이트 색온도 (P2B가 6500K로 발행만 하고 아무도 읽지 않던 값)
 *  lightPeak   라이트 최대 강도, lightDecayMs 감쇠 시간, lightCurve 감쇠 지수
 */
export const FLASH_LOOK = Object.freeze({
  coreK: 4300, rimK: 2000, peakGain: 3.4, size: 0.26,
  riseFrac: 0.18, decayCurve: 2.2,
  lightK: 3200, lightPeak: 7.5, lightDecayMs: 150, lightCurve: 2.0,
});

/** 예광 — 탄자 잔광. 수명에 따라 식는다(색온도 하강 + 감광). */
export const TRACER_LOOK = Object.freeze({
  headK: 3600, tailK: 2200, peakGain: 2.2, decayCurve: 1.6,
});

/* ===================== 탄흔 데칼 룩 (R4 작업 2-d) =====================
 * 종전 데칼은 **표면 무관 단일 회색 원형** 1종이었다(박리용 밝은 회색 1종 추가).
 * 흙벽·목재·화강암·기와의 탄흔이 서로 달라야 한다는 요구에 따라 표면별 실루엣과
 * 색을 여기(P3)가 소유하고, src/fx/decals.js 는 배치·수명·에빅션만 소유한다.
 * 소유 경계는 R4-BRIEF 착수 전 스캔 #5 확정: materials 가 텍스처, fx 가 배치.
 */

/** 데칼 실루엣 셀 — 아틀라스 배치 순서(3열 × 2행) */
export const DECAL_SHAPES = Object.freeze(['crater', 'splinter', 'spall', 'chip', 'dent', 'fray']);

/**
 * 표면 → 탄흔 룩. sizeK 는 기본 크기 배수(부드러운 표면일수록 크게 남는다).
 * HANJI·WATER 는 데칼 대상이 아니고(구멍·물기둥), DANCHEONG·LACQUER 는 박리(PEEL_LOOK).
 */
export const DECAL_LOOK = Object.freeze({
  WOOD_LATTICE: Object.freeze({ shape: 'splinter', hue: 28, sat: 0.30, light: 0.20, sizeK: 0.85 }),
  WOOD_PLANK:   Object.freeze({ shape: 'splinter', hue: 28, sat: 0.30, light: 0.18, sizeK: 1.00 }),
  WOOD_COLUMN:  Object.freeze({ shape: 'splinter', hue: 26, sat: 0.28, light: 0.15, sizeK: 1.10 }),
  EARTH_WALL:   Object.freeze({ shape: 'crater',   hue: 34, sat: 0.18, light: 0.24, sizeK: 1.35 }),
  PACKED_DIRT:  Object.freeze({ shape: 'crater',   hue: 32, sat: 0.20, light: 0.22, sizeK: 1.20 }),
  ROOF_SOIL:    Object.freeze({ shape: 'crater',   hue: 26, sat: 0.22, light: 0.16, sizeK: 1.15 }),
  GRANITE:      Object.freeze({ shape: 'spall',    hue: 210, sat: 0.04, light: 0.52, sizeK: 0.80 }), // 속살이 더 밝다
  ROOF_TILE:    Object.freeze({ shape: 'chip',     hue: 205, sat: 0.06, light: 0.18, sizeK: 0.90 }),
  BRONZE:       Object.freeze({ shape: 'dent',     hue: 46, sat: 0.24, light: 0.58, sizeK: 0.70 }), // 금속은 긁힌 자국이 밝다
  FABRIC:       Object.freeze({ shape: 'fray',     hue: 215, sat: 0.26, light: 0.22, sizeK: 0.95 }),
  THATCH:       Object.freeze({ shape: 'fray',     hue: 48, sat: 0.26, light: 0.30, sizeK: 1.10 }),
});

/** 박리(DECAL 관통 등급) — 도장·옻칠이 벗겨져 드러나는 하부재 */
export const PEEL_LOOK = Object.freeze({
  DANCHEONG: Object.freeze({ shape: 'spall', hue: 32, sat: 0.24, light: 0.62, sizeK: 1.0 }), // 드러난 백골 목재
  LACQUER:   Object.freeze({ shape: 'chip',  hue: 28, sat: 0.20, light: 0.46, sizeK: 1.0 }),
});

/** 데칼 구별 보고용 — 네 대표 표면이 실제로 다른지 (R4-BRIEF 작업 2-d) */
export const DECAL_KEY_SURFACES = Object.freeze(['EARTH_WALL', 'WOOD_PLANK', 'GRANITE', 'ROOF_TILE']);

/** 두 데칼 룩이 상이한 축 (fx 입자와 같은 규칙을 쓰되 shape 은 데칼 실루엣) */
export function decalAxesDiff(a, b) {
  const axes = [];
  if (a.sat >= VISUAL_SAT_MIN && b.sat >= VISUAL_SAT_MIN && hueDist(a.hue, b.hue) > VISUAL_HUE_MIN_DEG) axes.push('hue');
  const rel = Math.abs(a.light - b.light) / Math.max(a.light, b.light, 1e-9);
  if (rel > VISUAL_REL_MIN) axes.push('light');
  if (a.shape !== b.shape) axes.push('shape');
  return axes;
}
