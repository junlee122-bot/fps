/**
 * src/materials/viewmodel-look.js — 뷰모델 재질 (R4-BRIEF §3 작업 1, 등급 A).
 *
 * 왜 여기 있나: 뷰모델 **기하**는 weapons(P2) 소유이고 **룩**은 P3 소유다(PATCH-011-A 1번, CARRYOVER-AUDIT #6 —
 * P2B 가 회색 카드로 두고 넘긴 이월분). 디렉터리 소유권을 지키려고 재질은 materials 가 만들고 배선은 main.js 가 한다.
 * `src/weapons/viewmodel.js` 는 한 줄도 바꾸지 않는다.
 *
 * R3′ 비평(S08·S11)이 든 근거 세 가지를 직접 겨냥한다:
 *   ① "면 방향과 무관하게 균일한 회색" → 금속/비금속 분리 + 마모로 면마다 반사가 갈린다
 *   ② "씬 조명을 받지 않는 것처럼 보인다" → 조도 리그는 이미 월드와 동일(viewmodelaudit 1.0±0.10). 반응하는 **재질**을 준다
 *   ③ "프레임 최대 대비 영역" → 알베도를 낮춰(건메탈 .09 · 폴리머 .14) 시각 무게를 내린다
 *
 * 에지 마모는 `PAT.EDGEWEAR` — **UV 테두리 = 박스·원기둥 면 경계 = 기하 모서리**라는 성질을 쓴다(절차 생성, 에셋 0).
 * 팔레트: 전부 중성~청 대역 저채도(§4 규율). 매니페스트는 `albedo-manifest.json` 의 VM_GUNMETAL·VM_POLYMER 와 대조된다.
 */
import * as THREE from 'three';
import { PAT, V4 } from './synth.js';

const C = (hex) => new THREE.Color(hex);

/** 뷰모델 재질 레시피 — 표면 15종(RECIPES)과 분리한다. 표면 타입이 아니라 장비 룩이다. */
export const VIEWMODEL_RECIPES = Object.freeze({
  // 건메탈: 기관부·총열. 브러시 결(streak) + 모서리에서 도장이 벗겨져 맨 강철이 드러난다.
  VM_GUNMETAL: {
    size: 256, seed: 3101, period: 4, intendedAlbedo: 0.09, gain: 1.0,
    colA: C(0x2f3237), colB: C(0x3a3e44), colC: C(0x44484e), colD: C(0x9aa0a6),
    L0: V4(6, 4, 1, 1), L1: V4(30, 3, 2, 0.15), L2: V4(1, 0, 2, 0.99), L3: V4(70, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0.40, 0.65, 0.20, 0.80), alb: V4(0, 0.35, 0, 0), hgt: V4(0.02, 0.05, 0, 0.02),
    rgh: V4(0.42, -0.12, 0, 0.06), aom: V4(0, 0.90, 0.90, 0.50),
    pat: V4(PAT.EDGEWEAR, 0.10, 0.85, 0.22), normalStrength: 2,
    shader: { mode: 'uv' },
  },
  // 폴리머: 핸드가드·탄창·개머리. 무광 사출 표면, 모서리는 긁혀 거칠어진다(델타 음수).
  VM_POLYMER: {
    size: 256, seed: 3102, period: 4, intendedAlbedo: 0.14, gain: 2.211, // gain 역산: 1차 실측 .0633 → .14/.0633
    colA: C(0x3b3d3c), colB: C(0x46474a), colC: C(0x4e5052), colD: C(0x6e7173),
    L0: V4(8, 4, 1, 1), L1: V4(2, 2, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(90, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0.35, 0.70, 0, 0), alb: V4(0, 0.25, 0, 0), hgt: V4(0.03, 0, 0, 0.03),
    rgh: V4(0.78, 0.08, 0, 0.05), aom: V4(0, 0, 0, 0.50),
    pat: V4(PAT.EDGEWEAR, 0.07, 0.55, -0.10), normalStrength: 3,
    shader: { mode: 'uv' },
  },
});

/** weapons 가 만든 회색 카드 이름 → 새 재질 키 (main.js 가 이 표로 교체한다) */
export const VIEWMODEL_MATERIAL_MAP = Object.freeze({
  VM_GREY_DARK: 'VM_GUNMETAL',  // 몸통·기관부·총열
  VM_GREY_MID: 'VM_POLYMER',    // 핸드가드·탄창·개머리 연결부
});

/**
 * 뷰모델 재질 생성. `aoMap` 은 쓰지 않는다 — 뷰모델 지오메트리에 uv1 이 없고, 박스·원기둥에서 AO 맵의 이득이 없다.
 * @param {{ synth: import('./synth.js').ProceduralSynth }} deps
 * @returns {Record<string, THREE.MeshStandardMaterial>}
 */
export function createViewmodelMaterials({ synth }) {
  const out = {};
  for (const [key, r] of Object.entries(VIEWMODEL_RECIPES)) {
    const rc = { ...r, name: key };
    const g = r.gain ?? 1;
    if (g !== 1) for (const ck of ['colA', 'colB', 'colC', 'colD']) rc[ck] = r[ck].clone().multiplyScalar(g);
    const tex = synth.generate(rc);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 1.0,
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.ormMap, metalnessMap: tex.ormMap,
      normalScale: new THREE.Vector2(1, 1),
    });
    m.name = key;
    m.userData.albedoLum = tex.albedoLum;
    m.userData.surfaceOpts = { mode: 'uv' };   // 표면 셰이더 주입 대상 아님 — 삼면 매핑·POM·마모 분기를 쓰지 않는다
    out[key] = m;
  }
  return out;
}
