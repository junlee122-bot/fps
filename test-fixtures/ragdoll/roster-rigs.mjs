/**
 * test-fixtures/ragdoll/roster-rigs.mjs — v0 로스터 4종의 래그돌 템플릿·관절 자세 (P4B 단계 5, 3a 병합 뒤).
 *
 * 설계서 부록 R3 D3: 3a 병합 전 합성 템플릿으로 개발한 시험을 `biped.js` + 로스터 시각 리그로 바꿔 끼운다.
 * 템플릿 = `compileRagdollRig(visualRig)`(src/actors/sim/ragdoll-rig.js), 관절 원점 = `buildRest` 의 입자 휴지 위치.
 * `test/` 밖에 둔다 — `node --test` 는 `test/` 아래 모든 .js/.mjs 를 테스트로 실행한다(HANDOFF §4-3).
 */

import { ROSTER_DEFS } from '../../src/actors/data/index.js';
import { buildRest, particleIndex } from '../../src/actors/data/skeletons/biped.js';
import { compileRagdollRig } from '../../src/actors/sim/ragdoll-rig.js';

/** 로스터 순서의 리그 id */
export const RIG_IDS = Object.freeze(ROSTER_DEFS.map((d) => d.id));
/** id → 래그돌 템플릿(시각 리그에서 컴파일) */
export const TEMPLATES = Object.freeze(Object.fromEntries(ROSTER_DEFS.map((d) => [d.id, compileRagdollRig(d)])));
/** id → 진짜 질량(kg) */
export const MASS_KG_OF = Object.freeze(Object.fromEntries(ROSTER_DEFS.map((d) => [d.id, d.body.massKg])));

const REST = Object.fromEntries(ROSTER_DEFS.map((d) => [d.id, buildRest(d.skeleton.proportions, d.skeleton.posture)]));
const SHOULDER_R = particleIndex('shoulder_R'), ELBOW_R = particleIndex('elbow_R'), WRIST_R = particleIndex('wrist_R');

/**
 * 휴지 자세의 관절 원점을 월드에 놓는다(Float64Array 48). 뿌리 = 두 발 가운데 바닥, 정면 = (sin yaw, 0, cos yaw).
 * reach: 오른팔을 어깨 높이에서 정면 수평으로 뻗는다(뼈 길이는 휴지 그대로 — 판 앞 사망 시험용).
 */
export function posePositions(rigId, { x = 0, y = 0, z = 0, yaw = 0, reach = false } = {}) {
  const rest = REST[rigId];
  if (!rest) throw new Error(`posePositions: 미지 리그 '${rigId}'`);
  const src = Float64Array.from(rest.particlePos);
  if (reach) {
    const len = (a, b) => Math.hypot(src[b * 3] - src[a * 3], src[b * 3 + 1] - src[a * 3 + 1], src[b * 3 + 2] - src[a * 3 + 2]);
    const upper = len(SHOULDER_R, ELBOW_R), fore = len(ELBOW_R, WRIST_R);
    const s = SHOULDER_R * 3;
    src[ELBOW_R * 3] = src[s]; src[ELBOW_R * 3 + 1] = src[s + 1]; src[ELBOW_R * 3 + 2] = src[s + 2] + upper;
    src[WRIST_R * 3] = src[s]; src[WRIST_R * 3 + 1] = src[s + 1]; src[WRIST_R * 3 + 2] = src[s + 2] + upper + fore;
  }
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const out = new Float64Array(48);
  for (let i = 0; i < 16; i++) {
    const px = src[i * 3], py = src[i * 3 + 1], pz = src[i * 3 + 2];
    out[i * 3] = x + px * c + pz * sn;
    out[i * 3 + 1] = y + py;
    out[i * 3 + 2] = z - px * sn + pz * c;
  }
  return out;
}
