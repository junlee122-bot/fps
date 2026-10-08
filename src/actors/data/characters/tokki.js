/**
 * 토끼 — 인간계(수비), 카빈, 스킬 projectSilhouette(가짜 실루엣). 좁고 높은 윤곽: 귀 ×2(최고점 ≈2.00 m),
 * 가는 사지, 긴 발, 둥근 꼬리. 어깨 폭 ≈0.40 m(1.3 m).
 * 설계서 §2-6 표 초안 수치(형식 예시이자 설계 의도 — 확정 디자인 아님, silhouettepredict 로 조정).
 * 순수 데이터: 함수·계산식·import 금지(actor-data 테스트의 JSON 왕복·린트).
 * 귀는 머리 장식 뼈(acc_head)에 강체 부착, 길이 0.40·바깥 벌림 8°(b = a + 0.40·(sin8°, cos8°, 0)).
 * 귀 가운데 accent 밴드는 rc 가 한쪽 면만 칠할 수 없어 호 길이 구간 띠로 둔다(§3-3).
 * 무기 금속은 무채 ACTOR_METAL(검토 #8).
 */
export default Object.freeze({
  schema: 1, id: 'tokki', faction: 'ingan', displayName: { ko: '토끼' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.86, spine: 0.14, chest: 0.30, neck: 0.10, upperArm: 0.26, foreArm: 0.24, thigh: 0.40, shin: 0.40 },
    posture: { spinePitchDeg: 4, neckPitchDeg: -2, shoulderWidth: 0.30, hipWidth: 0.18 } },
  shape: { primitives: [
    { id: 'body',   bone: 'chest',  kind: 'el', c: [0, 0.14, 0], r: [0.17, 0.28, 0.13], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.30, v1: 0.36, mode: 'stripe' }] },
    { id: 'pelvis', bone: 'pelvis', kind: 'rc', a: [-0.07, 0, 0], b: [0.07, 0, 0], ra: 0.10, rb: 0.10, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    { id: 'neck',   bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.045, rb: 0.040, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',   bone: 'head',   kind: 'el', c: [0, 0.10, 0.02], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'ear_L',  bone: 'acc_head', kind: 'rc', a: [0.05, 0.17, -0.01], b: [0.1057, 0.5661, -0.01], ra: 0.045, rb: 0.035, slot: 'hide', surface: 'FABRIC', zone: 'head',
      bands: [{ slot: 'accent', v0: 0.30, v1: 0.80, mode: 'stripe' }] },
    { id: 'ear_R',  bone: 'acc_head', kind: 'rc', a: [-0.05, 0.17, -0.01], b: [-0.1057, 0.5661, -0.01], ra: 0.045, rb: 0.035, slot: 'hide', surface: 'FABRIC', zone: 'head',
      bands: [{ slot: 'accent', v0: 0.30, v1: 0.80, mode: 'stripe' }] },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.055, rb: 0.050, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0.02], ra: 0.050, rb: 0.045, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.055, rb: 0.050, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0.02], ra: 0.050, rb: 0.045, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.075, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.075, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.055, rb: 0.045, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.055, rb: 0.045, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.025, 0.07], r: [0.05, 0.035, 0.12], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.025, 0.07], r: [0.05, 0.035, 0.12], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'tail',    bone: 'acc_waist',  kind: 'el', c: [0, 0.02, -0.15], r: [0.06, 0.06, 0.06], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.60],       ra: 0.020, rb: 0.018, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.06, -0.26], ra: 0.038, rb: 0.033, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.25 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.30, height: 1.62, crouchHeight: 1.10, stepHeight: 0.42 }, massKg: 58, health: { max: 90, provisional: true } },
  movement: { walk: 3.9, sprint: 5.8, crouch: 2.1, jumpSpeed: 6.5, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'CARBINE', instance: { id: 'tokki_carbine_v0', displayName: null, handling: {} } },
  skills: [{ primitive: 'projectSilhouette', params: { panel: null, shape: 'decoy_v0' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'light_pad' },
  ragdoll: { template: 'biped', massScale: { headTop: 0.8 } },
  pose: { style: { strideM: 0.55, armSwing: 0.40, bob: 0.035, idleBreath: 0.012 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
