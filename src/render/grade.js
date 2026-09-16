/**
 * src/render/grade.js — C4 절차 그레이드 LUT (ARCHITECTURE §1 src/render "그레이드 LUT").
 *
 * 부팅 시 CPU에서 32³ 3D LUT를 계산해 HalfFloat Data3DTexture로 올린다 (에셋 0 — A3 규칙).
 * 출력 패스가 AgX+sRGB 인코딩 **후** 표시 공간(0..1)에서 삼선형 조회한다 (LDR LUT 규약).
 *
 * 룩(수묵 대기원근 — ARCHITECTURE §1 src/sky 톤 + §6 "의도가 읽히게"): 완만한 S커브, 전역 채도 소폭 감쇠,
 * 암부 채도 추가 감쇠(먹의 무채색), 암부 한색/명부 종이색 스플릿톤(휘도 보존 정규화). 색상 회전 없음 —
 * §4 색역 대역(청 175–240°, 적 355–15°, 황 40–60°, 목재·흙 20–40° 저채도)을 스플릿톤 강도 ≤0.03으로 지킨다.
 *
 * 결정성: 순수 JS 산술(입력 상수) — 페이지 간 동일 데이터. GPU 삼선형 필터는 고정 데이터·고정 좌표의 함수.
 */

import * as THREE from 'three';

export const GRADE_DEFAULT = Object.freeze({
  size: 32,
  contrast: 1.10, pivot: 0.42,
  saturation: 0.94, shadowDesat: 0.80, shadowEnd: 0.25,
  splitShadow: [0.62, 0.74, 1.00], splitHighlight: [1.00, 0.95, 0.86], splitAmount: 0.03,
  lift: 0.0,
  /**
   * 목재·흙 대역 채도 연성 상한 (§4: 20–40° sat ≤ 0.35). 재질 알베도는 대역 안(sat 0.28–0.35)이지만
   * 온색 광원(등롱·저고도 태양)이 곱해지면 0.45+로 올라간다 (C4 실측: lantern_night 5.5%·muzzle_interior
   * 2.6% 위반, LUT 없이). 2차 색보정(HSL 대역 채도 상한)으로 룩이 팔레트 규율을 강제한다 — 창(hue)은
   * 12–18° 램프인, 40–46° 램프아웃(단청 황 48°·초가 45°는 밖). cap 초과분은 bandSlope 기울기로만 남긴다.
   */
  band: [12, 18, 40, 46], bandCap: 0.30, bandSlope: 0.2,
});

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** 단일 색 변환 (LUT 텍셀 = 이 함수의 격자 샘플) */
export function gradeColor([r, g, b], p = GRADE_DEFAULT) {
  // 1) 대비 — 피벗 주변 선형 스트레치 (표시 공간)
  let c = [r, g, b].map((v) => clamp01(p.pivot + (v - p.pivot) * p.contrast));
  // 2) 채도 — 전역 × 암부 추가 감쇠
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const s = p.saturation * (p.shadowDesat + (1 - p.shadowDesat) * smooth(0, p.shadowEnd, y));
  c = c.map((v) => y + (v - y) * s);
  // 3) 스플릿톤 — 휘도 보존 정규화 틴트
  const t = smooth(0.2, 0.8, y);
  const tint = [0, 1, 2].map((i) => p.splitShadow[i] + (p.splitHighlight[i] - p.splitShadow[i]) * t);
  const ty = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
  c = c.map((v, i) => v * (1 + (tint[i] / ty - 1) * p.splitAmount));
  // 4) 리프트
  c = c.map((v) => clamp01(p.lift + v * (1 - p.lift)));
  // 5) 목재·흙 대역 채도 연성 상한 (GRADE_DEFAULT.band 주석)
  if (p.bandCap != null) {
    const [h, sv, v] = rgb2hsv(c[0], c[1], c[2]);
    const [a0, a1, b0, b1] = p.band;
    const w = smooth(a0, a1, h) * (1 - smooth(b0, b1, h));
    if (w > 0 && sv > p.bandCap) {
      const s2 = p.bandCap + (sv - p.bandCap) * p.bandSlope;
      c = hsv2rgb(h, sv + (s2 - sv) * w, v).map(clamp01);
    }
  }
  return c;
}

/** 32³ HalfFloat RGBA Data3DTexture — 좌표 (r,g,b) 정규화 격자 */
export function buildGradeLUT(params = GRADE_DEFAULT) {
  const p = { ...GRADE_DEFAULT, ...params };
  const n = p.size;
  const data = new Uint16Array(n * n * n * 4);
  const h = THREE.DataUtils.toHalfFloat;
  let o = 0;
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const c = gradeColor([ri / (n - 1), gi / (n - 1), bi / (n - 1)], p);
    data[o++] = h(c[0]); data[o++] = h(c[1]); data[o++] = h(c[2]); data[o++] = h(1);
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.name = 'C4_GRADE_LUT';
  tex.needsUpdate = true;
  return { texture: tex, size: n, params: p };
}
