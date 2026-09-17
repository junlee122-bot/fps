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
import { ProceduralSynth, PAT, V4 } from './synth.js';
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
    shader: { mode: 'tri', pom: true, wear: true, scale: 0.9, pomScale: 0.015, wearColor: C(0xb9b9b5), wearWidth: 0.03, wearAmount: 0.5, macro: 0.08 },
  },
  // R1 수정 D: 결 신장 14→8·알베도 결 대비 .8→.6·결 높이 .12→.08·노멀 5→3.5·반복 1.2→1.0·거칠기 .82→.88 —
  // 계약 해상도에서 세로 줄무늬 모아레, 야간 등롱광 스페큘러가 노멀 잡음을 드러냄(R1 S02·S03·S06·S10)
  WOOD_COLUMN: {
    size: 512, seed: 202, period: 4, intendedAlbedo: 0.16, gain: 1.5,
    colA: C(0x8c7660), colB: C(0x594b3c), colC: C(0x4a3d30), colD: C(0x3a2f25),
    L0: V4(1, 3, 1, 1), L1: V4(1, 4, 2, 8), L2: V4(1, 0, 2, 0.9), L3: V4(60, 9, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.6, 0, 0), hgt: V4(0.04, 0.08, 0, 0.03), rgh: V4(0.88, -0.08, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.KNOTS, 2, 0.88, 0.3), normalStrength: 3.5,
    shader: { mode: 'tri', pom: false, wear: true, scale: 1.0, wearColor: C(0xa89478), wearWidth: 0.02, wearAmount: 0.45 },
  },
  WOOD_PLANK: {
    size: 512, seed: 203, period: 4, intendedAlbedo: 0.20, gain: 1.74,
    colA: C(0x9c8468), colB: C(0x6b5a46), colC: C(0x55463a), colD: C(0x3a2f25),
    L0: V4(1, 3, 4, 1), L1: V4(1, 4, 5, 10), L2: V4(1, 0, 2, 0.9), L3: V4(60, 9, 0, 0), gate: V4(1, 0, 0, 0),
    remap: V4(0, 0, 0.3, 0.7), alb: V4(0, 0.6, 0, 0), hgt: V4(0.03, 0.07, 0, 0.03), rgh: V4(0.82, -0.08, 0, 0), aom: V4(0, 0, 0, 2),
    pat: V4(PAT.KNOTS, 2, 0.85, 0.28), normalStrength: 3, // R1 수정 D (WOOD_COLUMN 주석): 신장 18→10·결 대비·노멀·반복 완화
    shader: { mode: 'tri', pom: false, wear: true, scale: 0.8, wearColor: C(0xb8a68a), wearWidth: 0.015, wearAmount: 0.4 },
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
  ROOF_SOIL: {
    size: 256, seed: 305, period: 4, intendedAlbedo: 0.40, gain: 1.0,
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
    shader: { mode: 'tri', pom: true, wear: false, scale: 0.7, pomScale: 0.01, macro: 0.18 },
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
  WOOD_COLUMN: 0.6, WOOD_PLANK: 0.6, WOOD_LATTICE: 0.6, EARTH_WALL: 0.6, PACKED_DIRT: 0.6, THATCH: 0.6, BRONZE: 0.6,
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
/** 창호지 불투명도 — R1 수정 F: 0.62 → 0.82. 격자 뒤 건물 너머 하늘까지 비치고 여러 겹 격자가 중첩돼 보였다(R1 S03·S09).
 *  P2A 균일 불투명도 물성은 유지(값만), 국소 산란은 HANJI 레시피(섬유 결·hgt)가 맡는다. kit.js 호환 재질도 동일 값. */
export const HANJI_OPACITY = 0.82;
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
    if (key === 'HANJI') { m.transparent = true; m.opacity = HANJI_OPACITY; m.side = THREE.DoubleSide; }
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
  synth.dispose();
  return { mats, matOf: SURFACE_MAT, synth: { ms: +synth.totalMs.toFixed(0), breakdown: synth.breakdown } };
}

/** CSM 패치(pipeline.patchScene) 이후 호출 — 표면 셰이더 모드 적용 */
export function finalizeSurfaceShaders(mats) {
  let n = 0;
  for (const m of Object.values(mats)) {
    const o = m.userData.surfaceOpts;
    if (!o || o.mode === 'uv') continue;
    applySurfaceShader(m, o);
    n++;
  }
  return n;
}
