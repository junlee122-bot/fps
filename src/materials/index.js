/**
 * src/materials/index.js — 조선 표면 재질 세트 (P3 C3, ARCHITECTURE §4 14종 + 등롱·수면).
 *
 * 각 재질 = 합성 레시피(synth.js) + 표면 셰이더 모드(surface-shader.js) + 물리 파라미터.
 * 색은 §4 팔레트 대역 안에서만 고른다 — 청·하늘 175–240°, 적 355–15°, 황 40–60°,
 * 목재·흙 20–40°(채도 ≤0.35), 중성(채도 <0.10). 이 파일의 색 상수가 곧 팔레트 규율의 근거다.
 *
 * 매니페스트(albedo-manifest.json)는 "의도한 알베도 휘도"를 선언하고, albedoaudit이 합성
 * 결과의 실측 평균(userData.albedoLum)과 대조한다 — 조명을 맞추려 알베도를 깎으면 diff에 남는다.
 *
 * 프로그램 수: 셰이더 모드 조합을 소수로 고정(TRI / TRI+POM / TRI+WEAR / TRI+POM+WEAR /
 * LOCAL+WEAR / 무패치 UV). 재질이 달라도 조합이 같으면 프로그램을 공유한다.
 *
 * 크로스 서브시스템 import 없음: three + core만. renderer는 주입.
 */

import * as THREE from 'three';
import { HANJI_BASE_OPACITY, HANJI_MAX_HOLES } from './hanji.js';
import { ProceduralSynth, PAT, V4 } from './synth.js';
import { createViewmodelMaterials } from './viewmodel-look.js';
import { applySurfaceShader } from './surface-shader.js';

// three r152+: Color.setHex는 sRGB 입력을 작업 색공간(선형)으로 변환한다 — 추가 변환 금지(이중 변환 실측: 알베도 1/4)
const C = (hex) => new THREE.Color(hex);

/**
 * 레시피 필드 (유니폼 vec4 의미):
 *  L0 [scale, octaves, seedOff, stretchY] 모틀 FBM      L1 [scale, octaves, seedOff, stretchY] 결 FBM(이방성)
 *  L2 [scale, seedOff, mode(0균열/1반점/2셀무작위), width]  L3 [scale, seedOff, -, -] 미세 값노이즈
 *  gate [scale, seedOff, thresh(0=없음), -]  remap [l0lo, l0hi, l1lo, l1hi] (hi>lo일 때 smoothstep 재매핑)
 *  alb [spot→height, streak→colC 가중, spot→colD 가중, 균열 어둡기]
 *  hgt [L0, streak, crack(−), L3]  rgh [base, dStreak, dCrack, dL0]  aom [aoCrack, metalA, metalB, patinaThresh(>1=없음)]
 *  pat [type, a, b, c] — 패턴 연산 (synth.js PAT)
 *  gain — 색 상수 선형 배율(colA..colD). 의도 알베도(intendedAlbedo) 대비 합성 평균 휘도 실측
 *         (C3 프로브: 예 WOOD_PLANK 0.115 vs 0.20)에서 역산한 조정값 — 색상·채도 비 유지, 코드에 남는다
 *  shader: { mode:'tri'|'local'|'uv', pom, wear, scale(1/m), pomScale(m), wearColor, wearWidth, wearAmount, localScale }
 */
export const RECIPES = Object.freeze({
  GRANITE: {
    size: 512, seed: 101, period: 4, intendedAlbedo: 0.30, gain: 1.17,
    colA: C(0x9a9a97), colB: C(0x777775), colC: C(0xc8c8c4), colD: C(0xc8c8c4),
    L0: V4(3, 5, 3, 1), L1: V4(1, 1, 9, 1), L2: V4(40, 5, 1, 0.09), L3: V4(48, 7, 0, 0), gate: V4(6, 5, 0.62, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0.02, 0, 0.35, 0), hgt: V4(0.18, 0, 0, 0.06), rgh: V4(0.9, 0, 0, 0.05), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.CHISEL, 14, 0.08, 0.62), normalStrength: 6, // R1 수정 D: 반점 크기 .12→.09·대비 .5→.35, 거시 변조 .08
    shader: { mode: 'tri', pom: true, wear: true, scale: 0.9, pomScale: 0.015, wearColor: C(0xb9b9b5), wearWidth: 0.03, wearAmount: 0.5, macro: 0.08, groundAo: true }, // R4: 기단·계단 상면 접지 음영
  },
  // R1 수정 D: 결 신장 14→8·알베도 결 대비 .8→.6·결 높이 .12→.08·노멀 5→3.5·반복 1.2→1.0·거칠기 .82→.88 —
  // 계약 해상도에서 세로 줄무늬 모아레, 야간 등롱광 스페큘러가 노멀 잡음을 드러냄(R1 S02·S03·S06·S10)
  WOOD_COLUMN: {
    size: 512, seed: 202, period: 4, intendedAlbedo: 0.16, gain: 1.5,
    colA: C(0x8c7660), colB: C(0x594b3c), colC: C(0x4a3d30), colD: C(0x4a3d32), // colD(옹이) 완화 (WOOD_PLANK 주석)
    L0: V4(1, 3, 1, 1), L1: V4(1, 4, 2, 8), L2: V4(1, 0, 2, 0.9), L3: V4(60, 9, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.6, 0, 0), hgt: V4(0.04, 0.08, 0, 0.03), rgh: V4(0.88, -0.08, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.KNOTS, 2, 0.88, 0.2), normalStrength: 3.5,
    shader: { mode: 'tri', pom: false, wear: true, scale: 1.0, wearColor: C(0xa89478), wearWidth: 0.02, wearAmount: 0.45 },
  },
  WOOD_PLANK: {
    size: 512, seed: 203, period: 4, intendedAlbedo: 0.20, gain: 1.563, // R1: 결 대비 완화로 평균 ↑(.2227) → 역산 (albedoaudit 실측)
    colA: C(0x9c8468), colB: C(0x6b5a46), colC: C(0x55463a), colD: C(0x4a3d32), // colD(옹이) 3a2f25→4a3d32: '바닥 검은 타원 점'(R1 S08)
    L0: V4(1, 3, 4, 1), L1: V4(1, 4, 5, 10), L2: V4(1, 0, 2, 0.9), L3: V4(60, 9, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.6, 0, 0), hgt: V4(0.03, 0.07, 0, 0.03), rgh: V4(0.82, -0.08, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.KNOTS, 2, 0.85, 0.18), normalStrength: 3, // R1 수정 D (WOOD_COLUMN 주석): 신장 18→10·결 대비·노멀·반복 완화, 옹이 반경 .28→.18
    shader: { mode: 'tri', pom: false, wear: true, scale: 0.8, wearColor: C(0xb8a68a), wearWidth: 0.015, wearAmount: 0.4, groundAo: true }, // R4: 마루 접지 음영
  },
  WOOD_LATTICE: {
    size: 256, seed: 204, period: 4, intendedAlbedo: 0.10, gain: 3.15,
    colA: C(0x4a3d32), colB: C(0x382e27), colC: C(0x2d251f), colD: C(0x2d251f),
    L0: V4(1, 3, 1, 1), L1: V4(1, 3, 2, 20), L2: V4(1, 0, 2, 0.99), L3: V4(60, 9, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.7, 0, 0), hgt: V4(0.02, 0.08, 0, 0.02), rgh: V4(0.8, -0.1, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 3,
    shader: { mode: 'tri', pom: false, wear: false, scale: 2.0 },
  },
  DANCHEONG: {
    size: 512, seed: 505, period: 4, intendedAlbedo: 0.26, gain: 1.37,
    // colA 청 · colB 적 · colC 황 · colD 백 (도장층). 박리로 노출되는 목재색은 peelBase(pat2로 전달)
    colA: C(0x1d4f73), colB: C(0x8c2519), colC: C(0xd9b521), colD: C(0xe8e4dc),
    L0: V4(2, 4, 1, 1), L1: V4(1, 4, 2, 12), L2: V4(1, 0, 2, 0.99), L3: V4(40, 3, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.35, 0.65), alb: V4(0, 0.3, 0, 0), hgt: V4(0.05, 0.06, 0, 0.02), rgh: V4(0.85, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.DANCHEONG, 0.22, 6, 0.70), normalStrength: 4,
    peelBase: [C(0x594b3c), C(0x4a3d30)],
    shader: { mode: 'local', wear: true, wearColor: C(0x594b3c), wearWidth: 0.02, wearAmount: 0.35, localScale: 1 / 0.9 }, // R1 수정 E: 박리 .7→.35 ('노란 점 위 검붉은 얼룩')
  },
  // R1 수정 C/G: 의도 알베도 0.07 → 0.13 — 0.07은 신품 검은 기와(무광 흑회)의 값이고 풍화된 회흑색 기와는
  // 0.12~0.15 로 측정된다. 0.07은 AgX 하에서 근흑으로 눌려 기와·파편이 '검은 판'으로 읽혔다(R1 S01·S05·S12).
  // 매니페스트 동시 갱신(albedoaudit 대조). gain은 합성 평균 휘도 실측으로 역산(C3 방식).
  ROOF_TILE: {
    size: 512, seed: 404, period: 4, intendedAlbedo: 0.13, gain: 3.47,
    colA: C(0x3a3d42), colB: C(0x2b2e33), colC: C(0x59593a), colD: C(0x4a4d52),
    L0: V4(6, 4, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(70, 2, 0, 0), gate: V4(2, 3, 0.58, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0), hgt: V4(0.08, 0, 0, 0.03), rgh: V4(0.9, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.WADANG, 0.08, 0, 0), normalStrength: 5,
    moss: { gate: 0.6 }, // 이끼: 게이트 통과 영역을 colC(올리브 60°)로 — L0 재매핑 경로 사용
    shader: { mode: 'tri', pom: true, wear: false, scale: 2.5, pomScale: 0.01 },
  },
  EARTH_WALL: {
    size: 256, seed: 303, period: 4, intendedAlbedo: 0.25, gain: 1.04,
    colA: C(0x948168), colB: C(0x7a6a55), colC: C(0xbfad73), colD: C(0x8f7d64),
    L0: V4(4, 5, 1, 1), L1: V4(20, 3, 31, 0.08), L2: V4(5, 43, 0, 0.035), L3: V4(64, 4, 0, 0), gate: V4(2, 47, 0.45, 0),
    remap: V4(0, 0, 0.56, 0.64), alb: V4(0, 0.8, 0, 0.45), hgt: V4(0.1, 0.05, 0.3, 0.04), rgh: V4(0.95, -0.1, 0, 0), aom: V4(0.35, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 6,
    shader: { mode: 'tri', pom: true, wear: false, scale: 1.0, pomScale: 0.012, macro: 0.12 }, // R1 수정 D: 거시 변조
  },
  // R1 수정 C: 보토 셸 전용 재질 — 상면 앙토(회백 흙회 — 기와 밑이라 거의 안 보임), 하면은 셰이더 uUnder 유니폼으로
  // 서까래(목재색 띠) + 앙토 그늘. EARTH_WALL 재사용(SURFACE_MAT ROOF_SOIL→EARTH_WALL)이 '베이지 천' 오독의 원인.
  // 정의 집합 TRI 전용(WOOD_LATTICE 등과 프로그램 공유) — 프로그램 순열 불변.
  // R3(R2 N2): 앙토 .40은 야간 등롱광·주간 소핏에서 '유난히 밝은 널'로 읽혔다 → .30 (회백 흙회의 어두운 쪽; 매니페스트 동시 갱신)
  ROOF_SOIL: {
    size: 256, seed: 305, period: 4, intendedAlbedo: 0.30, gain: 0.75,
    colA: C(0xc4bcae), colB: C(0xa9a08f), colC: C(0xb8ae9a), colD: C(0x9c9384),
    L0: V4(3, 5, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(6, 7, 0, 0.03), L3: V4(64, 3, 0, 0), gate: V4(2, 11, 0.5, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0.25), hgt: V4(0.05, 0, 0.15, 0.03), rgh: V4(0.93, 0, 0, 0), aom: V4(0.25, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 4,
    shader: { mode: 'tri', pom: false, wear: false, scale: 1.0, macro: 0.10, under: { amount: 1.0, pitch: 0.45, width: 0.14, ao: 0.35 }, underColor: C(0x7a6a56) },
  },
  PLASTER: {
    size: 256, seed: 304, period: 4, intendedAlbedo: 0.55, gain: 0.88,
    colA: C(0xddd8ce), colB: C(0xc9c3b6), colC: C(0xc9c3b6), colD: C(0xc9c3b6),
    L0: V4(3, 5, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(3, 5, 0, 0.012), L3: V4(80, 2, 0, 0), gate: V4(1, 8, 0.6, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0.3), hgt: V4(0.03, 0, 0.15, 0.03), rgh: V4(0.9, 0, 0, 0), aom: V4(0.2, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 4,
    shader: { mode: 'tri', pom: false, wear: true, scale: 1.0, wearColor: C(0x948168), wearWidth: 0.03, wearAmount: 0.5, macro: 0.10 }, // R1 D
  },
  LACQUER: {
    size: 256, seed: 606, period: 4, intendedAlbedo: 0.035, gain: 3.8,
    colA: C(0x38110e), colB: C(0x1f0a08), colC: C(0x1f0a08), colD: C(0x1f0a08),
    L0: V4(2, 4, 5, 1), L1: V4(1, 1, 2, 1), L2: V4(12, 3, 0, 0.015), L3: V4(40, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0.35), hgt: V4(0.01, 0, 0.06, 0), rgh: V4(0.12, 0, 0.25, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 3,
    shader: { mode: 'tri', pom: false, wear: false, scale: 1.0 },
  },
  FABRIC: {
    size: 256, seed: 707, period: 4, intendedAlbedo: 0.45, gain: 0.93,
    colA: C(0xccc0a3), colB: C(0xb5a98c), colC: C(0xb5a98c), colD: C(0xd8ccb0),
    L0: V4(2, 4, 4, 1), L1: V4(1, 1, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(90, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0), hgt: V4(0.02, 0, 0, 0.02), rgh: V4(0.95, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.WEAVE, 48, 0.25, 0.08), normalStrength: 4,
    shader: { mode: 'tri', pom: false, wear: false, scale: 1.0 },
  },
  THATCH: {
    size: 256, seed: 808, period: 4, intendedAlbedo: 0.28, gain: 1.27,
    colA: C(0x9e8c57), colB: C(0x615235), colC: C(0xbfad73), colD: C(0x615235),
    L0: V4(1, 3, 1, 1), L1: V4(1, 4, 2, 40), L2: V4(1, 0, 2, 0.99), L3: V4(3, 6, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.5, 0, 0), hgt: V4(0.02, 0.06, 0, 0.06), rgh: V4(0.92, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.ROWS, 6, 5, 0.2), normalStrength: 6,
    shader: { mode: 'tri', pom: true, wear: false, scale: 1.0, pomScale: 0.02 },
  },
  BRONZE: {
    size: 256, seed: 909, period: 4, intendedAlbedo: 0.12, gain: 1.13,
    colA: C(0x524637), colB: C(0x4d807e), colC: C(0x4d807e), colD: C(0x6a9a97),
    L0: V4(5, 5, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(60, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0.45, 0.7, 0, 0), alb: V4(0, 0, 0, 0), hgt: V4(0.05, 0, 0, 0.04), rgh: V4(0.55, 0, 0, 0.4), aom: V4(0, 0.85, 0.15, 0.45),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 4,
    shader: { mode: 'tri', pom: false, wear: false, scale: 1.5 },
  },
  PACKED_DIRT: {
    size: 256, seed: 1010, period: 4, intendedAlbedo: 0.20, gain: 1.41,
    colA: C(0x806f5c), colB: C(0x6b5d4c), colC: C(0x6b5d4c), colD: C(0xa39d92),
    L0: V4(2, 5, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(24, 5, 1, 0.05), L3: V4(90, 2, 0, 0), gate: V4(8, 9, 0.72, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0.05, 0, 0.4, 0), hgt: V4(0.08, 0, 0, 0.03), rgh: V4(0.96, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 5, // R1 수정 D: '검은 타원 점(물방울무늬)' — 반점 밀도 30→24·크기·대비 .7→.4, 거시 변조 .18
    shader: { mode: 'tri', pom: true, wear: false, scale: 0.7, pomScale: 0.01, macro: 0.18, groundAo: true }, // R4: 지면 접지 음영
  },
  HANJI: {
    size: 256, seed: 1111, period: 4, intendedAlbedo: 0.72, gain: 0.96,
    colA: C(0xe3e0d8), colB: C(0xd9cfb2), colC: C(0xf0ede6), colD: C(0xf0ede6),
    L0: V4(1, 4, 7, 1), L1: V4(40, 3, 1, 0.04), L2: V4(1, 0, 2, 0.99), L3: V4(50, 2, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0.5, 0.85, 0.55, 0.7), alb: V4(0, 0.5, 0, 0), hgt: V4(0, 0.03, 0, 0.01), rgh: V4(0.9, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 2,
    shader: { mode: 'uv' },
  },
  // C4: 등롱 발광 강도는 샷의 등롱 광원 상태에 종속 (main applyShot) — 야간 점등 시 HDR 발광(블룸 대상),
  // 주간 소등 시 종이 갓의 잔광만. emissiveIntensity 1.1 고정은 야간에 블룸 임계(노출 후 0.8)를 겨우 넘어
  // '자발광·블룸' 샷 의도가 읽히지 않았다 (C4 실측: 블룸 0.25까지 올려도 글로우 미미).
  LANTERN: {
    size: 256, seed: 1212, period: 4, intendedAlbedo: 0.55, gain: 1.5,
    colA: C(0xd8cba8), colB: C(0xc9ba95), colC: C(0xc9ba95), colD: C(0xc9ba95),
    L0: V4(2, 4, 3, 1), L1: V4(1, 1, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(50, 1, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0), hgt: V4(0.02, 0, 0, 0.02), rgh: V4(0.9, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.RIBS, 8, 0.03, 0), normalStrength: 3,
    emissive: C(0xffdf8e), emissiveIntensity: 1.1,
    shader: { mode: 'uv' },
  },
  WATER: {
    size: 256, seed: 1313, period: 4, intendedAlbedo: 0.19, gain: 1.0,
    colA: C(0x6e7a80), colB: C(0x6e7a80), colC: C(0x6e7a80), colD: C(0x6e7a80),
    L0: V4(3, 4, 1, 1), L1: V4(1, 1, 2, 1), L2: V4(1, 0, 2, 0.99), L3: V4(1, 0, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0, 0), alb: V4(0, 0, 0, 0), hgt: V4(0.1, 0, 0, 0), rgh: V4(0.22, 0, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.NONE, 0, 0, 0), normalStrength: 2,
    shader: { mode: 'uv' },
  },
});

/** 표면 → 재질 키 (kit.MAT_OF를 C3에서 대체). 시각은 재질이, 물성은 표면 태그가 소유한다 */
/**
 * §4 팔레트 규율 — 목재·흙 대역(20–40°) 채도 상한 0.35은 **조명 후 픽셀** 기준이다. 레시피 원색이 sRGB 채도
 * 0.28–0.35(상한 근처)면 온색 광원(등롱 0xfff6e8 s≈0.055, 저고도 태양·반구 지면색)과 곱해져 0.4+로 이탈한다
 * (C3 종료 캡처 실측: lantern_night 25.7% 위반 — 흙·목재 전면). C1의 등롱 광원 저채도화는 재질 채도 ~0.2를
 * 전제했다(level.js 주석 "결합 채도 ≈0.26"). 휘도 보존 크로마 축소(선형 공간, 색상·평균 알베도 불변 →
 * 매니페스트 무영향)로 원색을 sRGB 채도 ≈0.17–0.25로 내린다. 수묵 팔레트(저채도 목재·흙)의 의도이기도 하다.
 */
export const CHROMA_SCALE = Object.freeze({
  // PATCH-006-E: .6 → .8 — 005-F 측정에서 렌더 채도가 상한(.35)에 압착돼 있지 않고(.30–.35 구간 0%) 회백색의 원인이 이 축소였음이
  // 특정됐다. 저해상 재측정: .05–.10 45.6→11.9%, .10–.15 16.6→38.5%, .25–.30 9.9→20.8%, ≥.30 0%; 팔레트 12/12 유지(최악 1.00%).
  WOOD_COLUMN: 0.8, WOOD_PLANK: 0.8, WOOD_LATTICE: 0.8, EARTH_WALL: 0.8, PACKED_DIRT: 0.8, THATCH: 0.8, BRONZE: 0.8,
});
/** 휘도 보존 크로마 축소 (선형 공간, 제자리) */
function scaleChroma(c, k) {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  c.setRGB(lum + (c.r - lum) * k, lum + (c.g - lum) * k, lum + (c.b - lum) * k);
  return c;
}
for (const [name, k] of Object.entries(CHROMA_SCALE)) {
  const r = RECIPES[name];
  for (const key of ['colA', 'colB', 'colC', 'colD']) if (r[key]) scaleChroma(r[key], k);
}
// R1 C: 지붕 셸 하면 서까래 목재색도 목재 대역 규율(위 주석)과 같은 크로마 축소 — sRGB 채도 .30 → ≈.18
scaleChroma(RECIPES.ROOF_SOIL.shader.underColor, CHROMA_SCALE.WOOD_COLUMN);

export const SURFACE_MAT = Object.freeze({
  GRANITE: 'GRANITE', PACKED_DIRT: 'PACKED_DIRT', EARTH_WALL: 'EARTH_WALL', ROOF_SOIL: 'ROOF_SOIL', // R1 C: 보토 셸 전용 재질
  WOOD_COLUMN: 'WOOD_COLUMN', WOOD_PLANK: 'WOOD_PLANK', THATCH: 'THATCH', ROOF_TILE: 'ROOF_TILE',
  WOOD_LATTICE: 'WOOD_LATTICE', HANJI: 'HANJI', WATER: 'WATER', BRONZE: 'BRONZE', FABRIC: 'FABRIC',
});

/**
 * 재질 세트 생성. 반환 { mats, synth: { ms, breakdown }, textures: n }.
 * mats: 킷 Assembler가 쓰는 키→재질 맵 (GREY_* 키는 호환용으로 남긴다 — 기존 물성 유지 재질).
 * 셰이더 패치는 CSM 패치 이후여야 하므로 여기서는 하지 않는다 → finalizeSurfaceShaders(mats).
 */
/**
 * 창호지 확산 투과 모델 (CONTRACT-PATCH-005-D). 창호지는 투명체가 아니라 **확산 투과체**다 — 빛을 통과시키되 산란시킨다.
 * R1의 알파 블렌딩(.62)은 착색 유리로 읽혔고(뒤 물체·격자가 38% 그대로 비침), R1 F의 역광 발광은 그림자 없이 균일해 '실내가 하늘보다
 * 밝은 빈 상자'(R2 N1)로 읽혔다. 이 모델:
 *  - 종이는 거의 불투명(hanji.js HANJI_BASE_OPACITY .95 — P1.5-BRIEF §2: 동결은 surfaces.js 플래그, 값은 P3 조정).
 *  - 보이는 면 **뒤에서** 오는 태양광을 종이색으로 발광: albedo · sunColor · I · T · max(0, n·travel)/π · S. 면 전체가 고르게 밝다(평면).
 *  - S = 배면 그림자(CSM 그림자 맵)를 **PCSS**로 샘플: 차폐물 깊이(blocker search)와 수신면 깊이 차에 비례한 반경으로 PCF → 종이에
 *    가까운 물체는 선명하고 먼 물체는 흐린 실루엣(거리 의존 흐림). 태양이 앞에 있으면 항(=0)이 사라져 그림자 실루엣도 없다.
 *  - dynamicOpacity 상태(피격 누적 → opacity ↓)는 render OpacityApplier가 uHanjiScatter(산란 반경 배율)에도 반영해 찢긴 종이일수록
 *    투과율은 오르고(알파) 흐림은 줄어든다(구멍은 P2B 데칼).
 *  - 하늘 환경광의 확산 투과는 상수항 uHanjiAmbient(albedo 배율)로 근사 — 역광이 아닐 때도 종이가 '빛을 머금은' 정도.
 * 판별 클론(HANJI@id)과 원본을 모두 패치(프로그램 공유). 감사 조명(applySunRawForAudit)에서는 transmit 0.
 * 결정성: 고정 Poisson 탭 16개, 그림자 맵은 밉 없음 → 암시 미분 무관. 셰이더는 CSM 패치의 CSM_cascades·directionalShadowMap[i]를 그대로
 * 읽는다(정의 집합 불변 — 프로그램 순열 불변).
 *
 * [PATCH-008-B] 점광 투과 + 해석적 캡슐 차폐 (야간 실내 광원 폐색 실루엣 — 주간 그림자 실루엣과 다른 기전, CONTRACT-NOTES 008-C):
 *  - 씬의 점광(three pointLights[] 유니폼 재사용: 등롱·트랜지언트 라이트 — 별도 광원 유니폼 없음)마다, 보이는 면 **뒤**에 있는 것만
 *    albedo · color · att(d) · max(0, −n·l)/π · T_p · V 로 발광. 등롱이 판 뒤에 있으면 종이가 빛나고, 총구화염이 판 뒤에서 터져도 비친다.
 *  - V = 등록 캡슐(hanji-occluders.js: 더미·적)에 대한 해석적 차폐 — 판→광원 선분과 캡슐 축의 최근접 거리 d, 반그림자 폭 = 광원 반지름 ×
 *    (판→차폐물)/(차폐물→광원) + 종이 산란 상수, × uHanjiScatter(찢긴 종이일수록 선명). 점광은 castShadow=false 유지(순열·비용 고정).
 *  - 등록되지 않은 물체(가구·기둥)는 점광을 가리지 않는다 — 설계 한계로 기록. 최대 4개.
 */
export const HANJI_TRANSMIT = 0.25;
/** 하늘광 확산 투과 근사 (albedo 배율, 선형) */
export const HANJI_AMBIENT = 0.035;
/** PCSS: blocker 탐색 반경(텍셀), 깊이차→반경 계수(텍셀/정규화 깊이), 최대 반경(텍셀) */
export const HANJI_PCSS = Object.freeze({ search: 8.0, penumbra: 6000.0, maxRadius: 28.0 });
/** [PATCH-008-B] 점광 투과율(albedo 배율) · 광원 반지름(m, 반그림자) · 종이 산란 폭(m) */
/**
 * 찢어진 창호지 — 살에서 종이가 남는 폭과 너덜 진폭 (m).
 * keep .048 / ragged .020 → 남는 폭이 28~68 mm 에서 들쭉날쭉하고, 칸마다 다시 ±25% 편차가 붙는다.
 * 살 간격 ~161 mm 기준으로 뚫리는 폭은 25~105 mm — **종이가 주인이고 구멍이 손님**이다.
 * 처음 실측(keep .030)은 뚫린 곳이 종이보다 넓어 "세로 셔터"로 읽혔다.
 */
export const HANJI_TORN = Object.freeze({ keep: 0.048, ragged: 0.020 });

export const HANJI_POINT = Object.freeze({ transmit: 0.6, lightSize: 0.12, paperBlur: 0.03 }); // T_p .6: 실측(hj5) .25 대비 실루엣 대비 .21→.32, 종이 발광이 알파 비침을 누른다
const HANJI_HOLES_PARS_GLSL = /* glsl */`
  // [PATCH-013-B] 구멍 목록 — 해석적 유니폼 배열. 배열 길이가 고정이라 프로그램 순열은 불변이다.
  uniform vec3 uHanjiHoles[${HANJI_MAX_HOLES}];   // xy = 판 로컬 UV, z = 반지름(m)
  uniform int uHanjiHoleCount;
  uniform vec2 uHanjiPaneSize;                    // 판 실제 크기(m) — UV 이방성 보정
  // [발주자 지시 2026-09-20] 찢어짐 — 종이는 창살에 풀로 붙어 있다. 찢어지면 칸 가운데가
  // 뜯겨 나가고 **살을 따라 너덜한 조각이 남는다**. 살 배치를 알고 있으므로 해석적으로 그린다.
  uniform float uHanjiTorn;      // 0 = 성함, 1 = 찢어짐
  uniform vec4 uHanjiLattice;    // x = 세로 분할 수(nV+1), y = 가로띠 수(고정 3), z = 남는 폭(m), w = 너덜 진폭(m)
  varying vec2 vHanjiUv;

  float hjHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float hjNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hjHash(i), hjHash(i + vec2(1.0, 0.0)), f.x),
               mix(hjHash(i + vec2(0.0, 1.0)), hjHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  /** 판 로컬 UV → 가장 가까운 살·문틀까지의 거리(m) */
  float hjBarDistance(vec2 uv, vec2 paneSize) {
    float div = uHanjiLattice.x;                       // 세로 분할 수 (살 nV + 테두리 2)
    float gu = uv.x * div;
    float du = abs(gu - floor(gu + 0.5)) / div * paneSize.x;
    // 가로띠 3개(판 중심 기준 ±0.36, 0)와 위·아래 문틀
    float dv = min(abs(uv.y - 0.5), min(abs(uv.y - 0.14), abs(uv.y - 0.86)));
    dv = min(dv, min(uv.y, 1.0 - uv.y)) * paneSize.y;
    return min(du, dv);
  }
`;
const HANJI_PARS_GLSL = /* glsl */`
  uniform vec3 uHanjiLightDir, uHanjiSunColor;
  uniform float uHanjiTransmit, uHanjiAmbient, uHanjiScatter, uHanjiSearch, uHanjiPenumbra, uHanjiMaxRadius;
  // [PATCH-008-B] 점광 투과 · 해석적 캡슐 차폐
  #define HJ_OCC_MAX 4
  uniform vec4 uHanjiOccA[HJ_OCC_MAX]; // xyz 뷰공간 캡슐 축 끝점 A, w 반지름
  uniform vec4 uHanjiOccB[HJ_OCC_MAX]; // xyz 끝점 B
  uniform int uHanjiOccCount;
  uniform float uHanjiPointTransmit, uHanjiLightSize, uHanjiPaperBlur;
  // 선분 PQ(판→광원)와 선분 AB(캡슐 축)의 최근접 거리; sOut = PQ 위 최근접점 매개변수(0 판, 1 광원) — Ericson 5.1.9
  float hjSegSeg(vec3 p, vec3 q, vec3 a, vec3 b, out float sOut) {
    vec3 d1 = q - p, d2 = b - a, r = p - a;
    float A = dot(d1, d1), E = dot(d2, d2), F = dot(d2, r), C = dot(d1, r), B = dot(d1, d2);
    float denom = A * E - B * B;
    float s = denom > 1.0e-6 ? clamp((B * F - C * E) / denom, 0.0, 1.0) : 0.0;
    float t = (B * s + F) / max(E, 1.0e-6);
    if (t < 0.0) { t = 0.0; s = clamp(-C / max(A, 1.0e-6), 0.0, 1.0); }
    else if (t > 1.0) { t = 1.0; s = clamp((B - C) / max(A, 1.0e-6), 0.0, 1.0); }
    sOut = s;
    return length((p + d1 * s) - (a + d2 * t));
  }
  float hjOcclusion(vec3 P, vec3 L) {
    float vis = 1.0;
    for (int i = 0; i < HJ_OCC_MAX; i++) {
      if (i >= uHanjiOccCount) break;
      float s; float d = hjSegSeg(P, L, uHanjiOccA[i].xyz, uHanjiOccB[i].xyz, s);
      float rad = uHanjiOccA[i].w;
      // 반그림자 폭: 광원 반지름 × (판→차폐물)/(차폐물→광원) + 종이 산란; 찢긴 종이(uHanjiScatter↓)일수록 선명
      float soft = max((uHanjiLightSize * s / max(1.0 - s, 0.05) + uHanjiPaperBlur) * uHanjiScatter, 0.005);
      vis *= smoothstep(rad - soft * 0.5, rad + soft * 0.5, d);
    }
    return vis;
  }
  const vec2 HJ_POISSON[16] = vec2[16](
    vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
    vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
    vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
    vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  // PCSS: 1) blocker search — 수신면보다 가까운 깊이의 평균, 2) 반경 = (수신 깊이 − 차폐 깊이)·penumbra·scatter, 3) Poisson PCF
  float hanjiPCSS(sampler2D map, vec2 mapSize, float bias, vec4 sc) {
    vec3 c = sc.xyz / sc.w; c.z += bias;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    vec2 texel = 1.0 / mapSize;
    float blockerSum = 0.0, blockers = 0.0;
    for (int k = 0; k < 16; k++) {
      float d = unpackRGBAToDepth(texture2D(map, c.xy + HJ_POISSON[k] * texel * uHanjiSearch));
      if (d < c.z) { blockerSum += d; blockers += 1.0; }
    }
    if (blockers < 0.5) return 1.0;
    float dBlocker = blockerSum / blockers;
    float radius = clamp((c.z - dBlocker) * uHanjiPenumbra, 1.0, uHanjiMaxRadius) * uHanjiScatter;
    float lit = 0.0;
    for (int k = 0; k < 16; k++) lit += step(c.z, unpackRGBAToDepth(texture2D(map, c.xy + HJ_POISSON[k] * texel * radius)));
    return lit / 16.0;
  }
  #endif
`;
const HANJI_MAIN_GLSL = /* glsl */`
  {
    // [PATCH-013-B] 구멍: 맞은 자리에만 뚫린다. 종이가 없는 자리는 알파도 투과 발광도 없다.
    float hjHole = 0.0;
    for (int i = 0; i < ${HANJI_MAX_HOLES}; i++) {
      if (i >= uHanjiHoleCount) break;
      vec2 hjD = (vHanjiUv - uHanjiHoles[i].xy) * uHanjiPaneSize;
      float hjR = uHanjiHoles[i].z;
      hjHole = max(hjHole, 1.0 - smoothstep(hjR * 0.6, hjR, length(hjD)));
    }
    float hjPaper = 1.0 - hjHole;
    if (uHanjiTorn > 0.5) {
      // 살에서 uHanjiLattice.z 안쪽은 종이가 남고, 경계는 노이즈로 들쭉날쭉하다.
      float hjD = hjBarDistance(vHanjiUv, uHanjiPaneSize);
      vec2 hjP = vHanjiUv * uHanjiPaneSize;
      float hjRag = (hjNoise(hjP * 42.0) * 0.7 + hjNoise(hjP * 137.0) * 0.3 - 0.5) * 2.0;
      // 칸마다 남는 양이 다르고, 일부 칸은 아예 성하다 — 전면이 고르게 뜯기면 손상이 아니라
      // 무늬(세로 셔터)로 읽힌다. 칸 id 해시라 결정적이다.
      vec2 hjCellId = floor(vec2(vHanjiUv.x * uHanjiLattice.x, vHanjiUv.y * 4.0));
      float hjCellRnd = hjHash(hjCellId + 3.7);
      float hjKeep = uHanjiLattice.z * (0.55 + 1.05 * hjCellRnd) + hjRag * uHanjiLattice.w;
      if (hjCellRnd > 0.74) hjKeep = 1.0;   // 이 칸은 찢어지지 않았다
      hjPaper *= 1.0 - smoothstep(hjKeep - 0.002, hjKeep + 0.002, hjD);
    }
    diffuseColor.a *= hjPaper;
    vec3 hjTravel = normalize(mat3(viewMatrix) * uHanjiLightDir);
    float hjBack = max(0.0, dot(normal, hjTravel));            // 보이는 면 뒤에서 오는 빛
    float hjShadow = 1.0;
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0 && defined(CSM_CASCADES)
    if (hjBack > 0.0) {
      float hjLinearDepth = (vViewPosition.z) / (shadowFar - cameraNear);
      #pragma unroll_loop_start
      for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
        if (hjLinearDepth >= CSM_cascades[ i ].x && (hjLinearDepth < CSM_cascades[ i ].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) {
          hjShadow = hanjiPCSS(directionalShadowMap[ i ], directionalLightShadows[ i ].shadowMapSize, directionalLightShadows[ i ].shadowBias, vDirectionalShadowCoord[ i ]);
        }
      }
      #pragma unroll_loop_end
    }
    #endif
    totalEmissiveRadiance += diffuseColor.rgb * (uHanjiSunColor * (uHanjiTransmit * RECIPROCAL_PI * hjBack * hjShadow) + vec3(uHanjiAmbient)) * hjPaper;
    // [PATCH-008-B] 점광(등롱·트랜지언트) 투과 — 보이는 면 뒤의 점광만, 등록 캡슐이 가린다
    #if NUM_POINT_LIGHTS > 0
    {
      vec3 hjP = -vViewPosition;
      vec3 hjPointRad = vec3(0.0);
      #pragma unroll_loop_start
      for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
        { // 언롤 본문은 한 스코프에 이어 붙는다 — 선언은 내부 블록에 (three unrollLoops 규약)
          vec3 hjLv = pointLights[ i ].position - hjP;
          float hjLd = length(hjLv);
          float hjPBack = max(0.0, -dot(normal, hjLv / max(hjLd, 1.0e-4)));
          if (hjPBack > 0.0) {
            float hjAtt = getDistanceAttenuation(hjLd, pointLights[ i ].distance, pointLights[ i ].decay);
            if (hjAtt > 0.0) hjPointRad += pointLights[ i ].color * (hjAtt * hjPBack * hjOcclusion(hjP, pointLights[ i ].position));
          }
        }
      }
      #pragma unroll_loop_end
      totalEmissiveRadiance += diffuseColor.rgb * (uHanjiPointTransmit * RECIPROCAL_PI * hjPointRad) * hjPaper;
    }
    #endif
  }
`;
/**
 * lightDirRef: 빛 진행 방향 Vector3(공유 참조 — CSM lightDirection), sunColorRef: 태양광 Color(공유 참조),
 * occluders: HanjiOccluders(공유 유니폼 객체 uA/uB/uCount — 없으면 차폐 0개). 반환: 유니폼 묶음
 */
export function applyHanjiTransmit(mat, lightDirRef, sunColorRef, occluders = null) {
  const uniforms = {
    uHanjiLightDir: { value: lightDirRef }, uHanjiSunColor: { value: sunColorRef }, uHanjiTransmit: { value: 0 },
    uHanjiAmbient: { value: HANJI_AMBIENT }, uHanjiScatter: { value: 1.0 },
    uHanjiSearch: { value: HANJI_PCSS.search }, uHanjiPenumbra: { value: HANJI_PCSS.penumbra }, uHanjiMaxRadius: { value: HANJI_PCSS.maxRadius },
    // [PATCH-008-B] 점광 투과·캡슐 차폐 — 캡슐 유니폼은 HanjiOccluders 가 소유한 공유 객체(프레임당 1회 갱신)
    uHanjiOccA: occluders?.uA ?? { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uHanjiOccB: occluders?.uB ?? { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uHanjiOccCount: occluders?.uCount ?? { value: 0 },
    uHanjiPointTransmit: { value: HANJI_POINT.transmit }, uHanjiLightSize: { value: HANJI_POINT.lightSize }, uHanjiPaperBlur: { value: HANJI_POINT.paperBlur },
    // [PATCH-013-B] 구멍 목록 — 길이 고정 배열(프로그램 불변). render/opacity.js 가 갱신한다.
    uHanjiHoles: { value: Array.from({ length: HANJI_MAX_HOLES }, () => new THREE.Vector3()) },
    uHanjiHoleCount: { value: 0 },
    uHanjiPaneSize: { value: new THREE.Vector2(1, 1) },
    uHanjiTorn: { value: 0 },
    // x=세로 분할 수, y=가로띠 수, z=살에서 종이가 남는 폭(m), w=너덜 진폭(m). 판마다 render 가 채운다.
    uHanjiLattice: { value: new THREE.Vector4(8, 3, HANJI_TORN.keep, HANJI_TORN.ragged) },
  };
  mat.userData.hanjiUniforms = uniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    // 파스는 shadowmap_pars_fragment(directionalShadowMap·vDirectionalShadowCoord·unpackRGBAToDepth) 뒤에, 본문은 emissivemap_fragment에
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + HANJI_HOLES_PARS_GLSL + HANJI_PARS_GLSL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HANJI_MAIN_GLSL);
    // 판 로컬 UV — map 의 repeat 변환을 타지 않는 원본 uv 가 필요하다(구멍 좌표계)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHanjiUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvHanjiUv = uv;');
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|hanji_holes_r4'; };
  mat.needsUpdate = true;
  return uniforms;
}
/** 등롱 발광 강도 — 점등(샷 lantern>0)/소등. applyShot이 LANTERN 재질에 적용 (C4) */
export const LANTERN_EMISSIVE = Object.freeze({ lit: 6.0, unlit: 0.25 });

export function createSurfaceMaterials({ renderer }) {
  const synth = new ProceduralSynth({ renderer });
  const mats = {};
  for (const [key, r] of Object.entries(RECIPES)) {
    const rc = { ...r, name: key };
    const g = r.gain ?? 1;
    if (g !== 1) for (const ck of ['colA', 'colB', 'colC', 'colD']) if (rc[ck]) rc[ck] = rc[ck].clone().multiplyScalar(g);
    // 단청: colA..colD = 도장 4색(청·적·황·백), 박리 노출 목재색은 pat2.rgb로 전달 (셰이더 단청 분기 참조)
    if (key === 'DANCHEONG') { const w = r.peelBase[0].clone().multiplyScalar(g); rc.pat2 = V4(w.r, w.g, w.b, 0); }
    const tex = synth.generate(rc);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 1.0,
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.ormMap, metalnessMap: tex.ormMap, aoMap: tex.ormMap,
      normalScale: new THREE.Vector2(1, 1),
    });
    if (r.emissive) { m.emissive = r.emissive; m.emissiveIntensity = r.emissiveIntensity; m.emissiveMap = tex.ormMap; /* R=산란 마스크 */ }
    if (key === 'HANJI') { m.transparent = true; m.opacity = HANJI_BASE_OPACITY; m.side = THREE.DoubleSide; } // hanji.js 상태 기본값 (PATCH-005-D: 값은 P3 조정)
    if (key === 'WATER') { m.transparent = true; m.opacity = 0.85; }
    m.name = key;
    m.userData.albedoLum = tex.albedoLum;
    m.userData.surface = { mode: r.shader.mode, recipe: key };
    m.userData.surfaceOpts = r.shader;
    mats[key] = m;
  }
  // 곡면 기와 인스턴스용 UV 매핑 변형 — 텍스처 공유, 셰이더 무패치(원통 UV 그대로)
  {
    const t = mats.ROOF_TILE;
    const m = t.clone(); m.name = 'ROOF_TILE_UV';
    m.userData.albedoLum = t.userData.albedoLum;
    m.userData.surfaceOpts = { mode: 'uv' };
    mats.ROOF_TILE_UV = m;
  }
  // 호환 키: 뷰모델·감사 카드가 참조하는 회색 규율 재질은 유지 (P2A 캘리브레이션 불변)
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  mats.GREY_LIGHT = std(0x9a9a97); mats.GREY_MID = std(0x7b766f); mats.GREY_DARK = std(0x585b5f);
  for (const k of ['GREY_LIGHT', 'GREY_MID', 'GREY_DARK']) mats[k].name = k;
  // [R4 작업 1] 뷰모델 룩(건메탈·폴리머) — 정의는 viewmodel-look.js(P3), 생성은 **같은 합성기**로 한다.
  // 별도 합성기를 만들면 WebGL 자원과 부팅 비용이 두 벌이 된다. synth.dispose() 앞이어야 한다.
  const viewmodel = createViewmodelMaterials({ synth });
  synth.dispose();
  return { mats, matOf: SURFACE_MAT, viewmodel, synth: { ms: +synth.totalMs.toFixed(0), breakdown: synth.breakdown } };
}

/** CSM 패치(pipeline.patchScene) 이후 호출 — 표면 셰이더 모드 적용 */
/** groundAo: { texture, bounds } — 레시피 shader.groundAo === true 인 재질에만 접지 음영 맵을 건다 (R4, render/groundao.js) */
export function finalizeSurfaceShaders(mats, { groundAo = null } = {}) {
  let n = 0;
  for (const m of Object.values(mats)) {
    const o = m.userData.surfaceOpts;
    if (!o || o.mode === 'uv') continue;
    applySurfaceShader(m, groundAo ? { ...o, groundAoMap: groundAo } : o); // 맵은 전 재질 공유, o.groundAo 가 적용 스위치
    n++;
  }
  return n;
}
