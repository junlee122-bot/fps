/**
 * 심청 — v1 제안 윤곽(P4-BRIEF §3-1-B, 발주자 확정 전). 제품 데이터가 아니라 스키마·메시·dangle·내비
 * 클래스가 코드 추가 없이 v1 을 받는지 시험하는 fixture 다(설계서 §2-7 4).
 * 인간계, 산탄(P4-BRIEF §4-6), 스킬 setMovementMode(blink).
 * 윤곽: 길고 좁은 치마(r .17 → .22, 콩쥐는 아래가 퍼지고 심청은 길고 좁게 — 브리프가 구별을 요구),
 * 허리까지 내려오는 댕기 머리 — 예약 dangle 뼈 2마디(biped DANGLE_SEG_M 0.25 간격에 원시 길이를 맞춤),
 * 끝 구간 accent 띠가 댕기. 순수 데이터: 함수·계산식·import 금지.
 */
export default Object.freeze({
  schema: 1, id: 'simcheong', faction: 'ingan', displayName: { ko: '심청' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.88, spine: 0.12, chest: 0.27, neck: 0.10, upperArm: 0.25, foreArm: 0.23, thigh: 0.41, shin: 0.41 },
    posture: { spinePitchDeg: 2, neckPitchDeg: 0, shoulderWidth: 0.28, hipWidth: 0.17 } },
  shape: { primitives: [
    { id: 'jeogori', bone: 'chest',  kind: 'el', c: [0, 0.14, 0.01], r: [0.15, 0.17, 0.11], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    { id: 'skirt',   bone: 'pelvis', kind: 'rc', a: [0, 0.30, 0], b: [0, -0.80, 0], ra: 0.17, rb: 0.22, slot: 'skirt', surface: 'FABRIC', zone: 'cloth' },
    { id: 'neck',    bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.045, rb: 0.040, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',    bone: 'head',   kind: 'el', c: [0, 0.11, 0.01], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'braid_0', bone: 'dangle_0', kind: 'rc', a: [0, 0.06, -0.11], b: [0, -0.19, -0.11], ra: 0.035, rb: 0.030, slot: 'hair', surface: 'FABRIC', zone: 'prop', hitbox: false },
    { id: 'braid_1', bone: 'dangle_1', kind: 'rc', a: [0, 0.06, -0.11], b: [0, -0.19, -0.11], ra: 0.030, rb: 0.025, slot: 'hair', surface: 'FABRIC', zone: 'prop', hitbox: false,
      bands: [{ slot: 'accent', v0: 0.72, v1: 1.0, mode: 'stripe' }] },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0],    ra: 0.060, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.23, 0.02], ra: 0.065, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0],    ra: 0.060, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.23, 0.02], ra: 0.065, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.070, rb: 0.058, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.070, rb: 0.058, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.052, rb: 0.044, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.052, rb: 0.044, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.025, 0.05], r: [0.045, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.025, 0.05], r: [0.045, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.55],       ra: 0.026, rb: 0.022, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.06, -0.24], ra: 0.040, rb: 0.035, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },
    skirt:  { material: 'ACTOR_FABRIC',        tileMeters: 0.30 },
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.10 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    hair:   { material: 'ACTOR_WOOD',          tileMeters: 0.20 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.30, height: 1.60, crouchHeight: 1.10, stepHeight: 0.42 }, massKg: 52, health: { max: 90, provisional: true } },
  movement: { walk: 3.7, sprint: 5.4, crouch: 2.0, jumpSpeed: 6.0, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'SHOTGUN', instance: { id: 'simcheong_shotgun_v1', displayName: null, handling: {} } },
  skills: [{ primitive: 'setMovementMode', params: { mode: 'blink', rangeM: null }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'soft_shoe' },
  ragdoll: { template: 'biped', massScale: {} },
  pose: { style: { strideM: 0.44, armSwing: 0.20, bob: 0.015, idleBreath: 0.010 }, aim: { propBone: 'wrist_R', twoHand: true },
    dangle: [{ chain: ['dangle_0', 'dangle_1'], stiffness: 0.35, damping: 0.20 }] },
});
