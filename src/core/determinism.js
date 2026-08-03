/**
 * src/core/determinism.js — 캡처 빌드 Math.random 구조 트랩 (PATCH-004-B).
 *
 * 원안은 "캡처 빌드에서 Math.random을 throw로 교체"였으나 실행 불가를 증명했다:
 * three 코어의 MathUtils.generateUUID()가 Math.random ×4를 호출하고, 모든
 * Object3D·Material·BufferGeometry 생성자가 이를 호출한다 (ESM 모듈 내부
 * 바인딩이라 외부에서 재지향 불가). throw면 첫 Object3D에서 엔진이 죽어
 * PATCH-004-B 자체의 적용 확인(부팅 성공 + identical 픽셀)과 양립 불가.
 *
 * 대체 설계 (목표 등가 이상 — CONTRACT-NOTES P3 판정):
 *  1. Math.random → 고정 시드 mulberry32. 미지의 서드파티 난수 소비자(부팅
 *     시점 포함)도 부팅마다 동일 수열을 받아 **비결정성 자체가 구조적으로
 *     소멸**한다. throw는 발견 시점까지 비결정을 허용하지만, 시드 교체는
 *     발견 전에도 결정적이다 (C1의 GTAOPass 재발 클래스 원천 차단).
 *  2. 시끄러움 보존: 호출 카운터를 유지하고, 하네스 stepFrames가 시뮬 창을
 *     표시한다. 시뮬·렌더 창 안에서의 호출은 harness 오류로 승격되어 모든
 *     게이트를 실패시킨다 (런타임 경로의 미지 소비자는 여전히 크게 실패).
 *  3. 정적 조기 경보는 tools/determinismaudit.mjs가 담당한다.
 *
 * realtime 모드에서는 장착하지 않는다 — 단, 픽셀에 닿는 서드파티 난수는
 * 개별 결정화(GTAO pdNoiseTexture 교체)로 realtime==capture 픽셀을 유지한다.
 */

const state = {
  armed: false,
  seed: 0x1f2e3d4c | 0,
  totalCalls: 0,
  simWindow: false,
  simWindowCalls: 0,
  nativeRandom: Math.random,
};

function mulberry32() {
  state.seed = (state.seed + 0x6D2B79F5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 캡처(fixed) 부팅 최초에 1회 장착 */
export function armCaptureDeterminism() {
  if (state.armed) return;
  state.armed = true;
  Math.random = () => {
    state.totalCalls++;
    if (state.simWindow) state.simWindowCalls++;
    return mulberry32();
  };
}

/** stepFrames 시뮬 창 표시 — 창 내 호출은 하네스가 오류로 승격 */
export function markSimWindow(on) {
  state.simWindow = on;
  if (on) state.simWindowCalls = 0;
}

export function simWindowCalls() {
  return state.simWindowCalls;
}

export function mathRandomStats() {
  return { armed: state.armed, totalCalls: state.totalCalls };
}
