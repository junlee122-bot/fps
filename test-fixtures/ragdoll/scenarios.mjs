/**
 * test-fixtures/ragdoll/scenarios.mjs — 래그돌 사망 시나리오(합성 5 + 헤드리스 경내 4)와 실행기.
 * `test/ragdoll.test.mjs` 와 별도 프로세스 실행기(`run-hash.mjs`)가 같은 정의를 쓴다. `test/` 밖(HANDOFF §4-3).
 *
 * 템플릿 = v0 로스터 4종의 시각 리그에서 컴파일(roster-rigs.mjs, 부록 R3 D3). 경내 4곳에는 4종을 하나씩
 * 놓는다(§6-5 "헤드리스 경내 4종"). 질량은 정의의 진짜 massKg.
 */

import { RagdollWorld } from '../../src/physics/ragdoll.js';
import { MASK } from '../../src/physics/surface-registry.js';
import { RIG_IDS, TEMPLATES, MASS_KG_OF, posePositions } from './roster-rigs.mjs';
import { SYNTH, buildSynthetic, buildCompound } from './worlds.mjs';

export const PHYSICS_DT = 1 / 120;
/** playtest p4b_ragdoll_final_pose 와 같은 길이: 360 프레임 × 2 서브스텝 (harness.js:18) */
export const FINAL_POSE_SUBSTEPS = 720;

const CHEST = 1; // 충격 기준 입자(가슴)
const [R0, R1, R2, R3] = RIG_IDS;

/** 시나리오: rig(로스터 id), world('synthetic'|'compound'), 자세, 속도, 충격(가슴 높이 월드 좌표 기준) */
export const SCENARIOS = Object.freeze([
  { name: 'synthetic_pane_reach', rig: R0, world: 'synthetic', pose: { x: 0, y: 0, z: SYNTH.paneZ + 0.3, yaw: Math.PI, reach: true }, vel: [0, 0, 0], J: [0, 0, -25], pane: 'synthetic' },
  { name: 'synthetic_step_fall', rig: R1, world: 'synthetic', pose: { x: 0, y: 0.6, z: 3.15, yaw: Math.PI }, vel: [0, 0, -1.5], J: [0, 0, -20] },
  { name: 'synthetic_lattice', rig: R2, world: 'synthetic', pose: { x: SYNTH.latticeX, y: 0, z: SYNTH.latticeZ + 0.3, yaw: Math.PI }, vel: [0, 0, -3], J: [0, 0, -40] },
  { name: 'synthetic_fast_pane', rig: R3, world: 'synthetic', pose: { x: 0, y: 0, z: SYNTH.paneZ + 0.5, yaw: Math.PI }, vel: [0, 0, -20], J: [0, 0, -40], pane: 'synthetic' },
  { name: 'synthetic_floor', rig: R0, world: 'synthetic', pose: { x: -8, y: 0, z: 8, yaw: 0.3 }, vel: [1, 0, 0], J: [8, 0, 12] },
  { name: 'compound_na_pane_reach', rig: R0, world: 'compound', pose: { x: -31.7, y: 1, z: -11.5, yaw: -Math.PI / 2, reach: true }, vel: [0, 0, 0], J: [-25, 0, 0], pane: 'na_w_-3' },
  { name: 'compound_courtyard', rig: R1, world: 'compound', pose: { x: 0, y: 0, z: -8, yaw: 0 }, vel: [0, 0, 2], J: [0, 0, 30] },
  { name: 'compound_dh_kidan_edge', rig: R2, world: 'compound', pose: { x: 0, y: 1, z: -18.6, yaw: 0 }, vel: [0, 0, 1], J: [0, 0, 25] },
  { name: 'compound_dh_lattice', rig: R3, world: 'compound', pose: { x: 3.2, y: 1, z: -19.88, yaw: 0 }, vel: [0, 0, 3], J: [0, 0, 40] },
]);

const worldCache = new Map();
/** 정적 월드는 읽기 전용이라 시나리오 간 공유한다(래그돌 상태는 RagdollWorld 에만 있다) */
export function physicsFor(kind) {
  if (!worldCache.has(kind)) worldCache.set(kind, kind === 'synthetic' ? buildSynthetic() : buildCompound());
  return worldCache.get(kind);
}

/** 로스터 4종 템플릿을 리그 id 로 등록한 RagdollWorld */
export function newRagdoll(physics, rd = new RagdollWorld(physics.static, { slots: 6, gravity: physics.gravity, mask: MASK.CHARACTER })) {
  for (const id of RIG_IDS) rd.registerTemplate(id, TEMPLATES[id]);
  return rd;
}

/** 시나리오 활성화. rig·massKg 를 바꿔 외견 리그 ≠ 진짜 질량 경우를 만들 수 있다. Jdelta 로 섭동 시험 */
export function activateScenario(rd, sc, { slot = 0, rig = sc.rig, massKg = MASS_KG_OF[sc.rig], Jdelta = 0 } = {}) {
  const pos = posePositions(rig, sc.pose);
  const at = [pos[CHEST * 3], pos[CHEST * 3 + 1], pos[CHEST * 3 + 2]];
  const J = [sc.J[0] + Jdelta, sc.J[1], sc.J[2]];
  rd.activate(slot, rig, massKg, pos, sc.vel, at, J, PHYSICS_DT);
  return pos;
}

/**
 * 실행: 매 서브스텝 onStep(prev, cur, k) — prev·cur 는 Float64Array(48) (서브스텝 시작·끝 입자).
 */
export function runScenario(rd, steps = FINAL_POSE_SUBSTEPS, onStep = null, slot = 0) {
  const prev = new Float64Array(48), cur = new Float64Array(48);
  for (let k = 0; k < steps; k++) {
    rd.particles(slot, prev);
    rd.step(PHYSICS_DT);
    if (onStep) { rd.particles(slot, cur); onStep(prev, cur, k); }
  }
  return rd.state(slot);
}

/** 한 시나리오를 새 RagdollWorld 에서 끝까지 → { hash, sleeping, forced, steps } */
export function finalPose(name, opts = {}) {
  const sc = SCENARIOS.find((s) => s.name === name);
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const rd = newRagdoll(physicsFor(sc.world));
  activateScenario(rd, sc, opts);
  const st = runScenario(rd, opts.steps ?? FINAL_POSE_SUBSTEPS);
  return { hash: rd.hash(), sleeping: st.sleeping, forced: st.forced, steps: st.steps };
}
