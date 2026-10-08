/**
 * 자라 — 이세계(공격), 산탄, 스킬 spawnSurface(등껍질 차폐). 낮고 넓고 머리가 앞으로 나온 윤곽.
 * 설계서 §2-6 초안 수치(형식 예시이자 설계 의도 — 확정 디자인 아님, silhouettepredict 로 조정).
 * 순수 데이터: 함수·계산식·import 금지(actor-data 테스트의 JSON 왕복·린트).
 * 등껍질 탄도 표면은 FABRIC(결정 9), 보이는 것은 ACTOR_BRONZE_{team} 녹청(결정 7). 총열 BRONZE 는
 * hitbox:false 라 판정에 쓰지 않고, 보이는 무기 금속은 무채 ACTOR_METAL(검토 #8).
 */
export default Object.freeze({
  schema: 1, id: 'jara', faction: 'isegye', displayName: { ko: '자라' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.55, spine: 0.12, chest: 0.18, neck: 0.12, upperArm: 0.24, foreArm: 0.22, thigh: 0.26, shin: 0.24 },
    posture: { spinePitchDeg: 18, neckPitchDeg: -24, shoulderWidth: 0.36, hipWidth: 0.22 } },
  shape: { primitives: [
    { id: 'shell',    bone: 'acc_back', kind: 'el', c: [0, 0.05, -0.14], r: [0.42, 0.40, 0.20], rotDeg: [0, 0, 0], slot: 'shell', surface: 'FABRIC', zone: 'shell',
      bands: [{ slot: 'accent', v0: 0.46, v1: 0.54, mode: 'stripe' }] },
    { id: 'plastron', bone: 'chest',  kind: 'el', c: [0, -0.06, 0.10], r: [0.28, 0.32, 0.11], rotDeg: [0, 0, 0], slot: 'shell', surface: 'FABRIC', zone: 'torso' },
    { id: 'pelvis',   bone: 'pelvis', kind: 'rc', a: [-0.11, 0, 0], b: [0.11, 0, 0], ra: 0.14, rb: 0.14, slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.40, v1: 0.60, mode: 'stripe' }] },
    { id: 'neck',     bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.08, 0.08], ra: 0.07, rb: 0.06, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',     bone: 'head',   kind: 'el', c: [0, 0.05, 0.08], r: [0.11, 0.10, 0.15], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0],    ra: 0.075, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb',
      bands: [{ slot: 'accent', v0: 0.80, v1: 1.0, mode: 'stripe' }] },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.22, 0.02], ra: 0.060, rb: 0.075, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0],    ra: 0.075, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb',
      bands: [{ slot: 'accent', v0: 0.80, v1: 1.0, mode: 'stripe' }] },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.22, 0.02], ra: 0.060, rb: 0.075, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.095, rb: 0.085, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.095, rb: 0.085, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0],    ra: 0.085, rb: 0.090, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0],    ra: 0.085, rb: 0.090, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.01, 0.05], r: [0.07, 0.04, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.01, 0.05], r: [0.07, 0.04, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.62],       ra: 0.025, rb: 0.020, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.06, -0.25], ra: 0.040, rb: 0.035, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    shell:  { material: 'ACTOR_BRONZE_{team}', tileMeters: 0.40 },
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.25 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.34, height: 1.25, crouchHeight: 1.00, stepHeight: 0.42 }, massKg: 80, health: { max: 110, provisional: true } },
  movement: { walk: 3.4, sprint: 5.0, crouch: 1.8, jumpSpeed: 6.0, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'SHOTGUN', instance: { id: 'jara_shotgun_v0', displayName: null, handling: {} } },
  skills: [{ primitive: 'spawnSurface', params: { class: 'GRANITE', shape: 'shell_wall_v0' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'heavy_shell' },
  ragdoll: { template: 'biped', massScale: { chest: 1.6 } },
  pose: { style: { strideM: 0.45, armSwing: 0.35, bob: 0.02, idleBreath: 0.01 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
