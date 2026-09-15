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
});

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
