/**
 * 직녀 — v1 제안 윤곽(P4-BRIEF §3-1-B, 발주자 확정 전). 제품 데이터가 아니라 스키마·메시·내비 클래스가
 * 코드 추가 없이 v1 을 받는지 시험하는 fixture 다(설계서 §2-7 4).
 * 이세계, 카빈(P4-BRIEF §4-6), 스킬 spawnSurface(EARTH_WALL, durability) 액터 부착(베 방패).
 * 윤곽: 왼팔 아래팔에 가로로 든 베 두루마리(rc, 길이 0.60·r .09) — 한쪽만 넓은 비대칭. 두루마리 양끝
 * 금문 띠는 같은 원시의 겹치지 않는 두 구간이다. 순수 데이터: 함수·계산식·import 금지.
 */
export default Object.freeze({
  schema: 1, id: 'jiknyeo', faction: 'isegye', displayName: { ko: '직녀' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.88, spine: 0.12, chest: 0.28, neck: 0.10, upperArm: 0.26, foreArm: 0.24, thigh: 0.41, shin: 0.41 },
    posture: { spinePitchDeg: 3, neckPitchDeg: -2, shoulderWidth: 0.30, hipWidth: 0.18 } },
  shape: { primitives: [
    { id: 'jeogori', bone: 'chest',  kind: 'el', c: [0, 0.14, 0.01], r: [0.16, 0.18, 0.12], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.55, v1: 0.63, mode: 'stripe' }] },
    { id: 'skirt',   bone: 'pelvis', kind: 'rc', a: [0, 0.32, 0], b: [0, -0.80, 0], ra: 0.17, rb: 0.30, slot: 'skirt', surface: 'FABRIC', zone: 'cloth' },
    { id: 'neck',    bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.045, rb: 0.040, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',    bone: 'head',   kind: 'el', c: [0, 0.11, 0.01], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'hair',    bone: 'acc_head', kind: 'el', c: [0, 0.17, -0.08], r: [0.09, 0.07, 0.08], rotDeg: [0, 0, 0], slot: 'hair', surface: 'FABRIC', zone: 'head' },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.065, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0.02], ra: 0.070, rb: 0.075, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.26, 0],    ra: 0.065, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.24, 0.02], ra: 0.070, rb: 0.075, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'bolt',    bone: 'elbow_L',    kind: 'rc', a: [0.02, -0.16, 0.08], b: [0.62, -0.16, 0.08], ra: 0.09, rb: 0.09, slot: 'bolt', surface: 'FABRIC', zone: 'prop', hitbox: false,
      bands: [{ slot: 'trim', v0: 0.06, v1: 0.14, mode: 'geummun' }, { slot: 'trim', v0: 0.86, v1: 0.94, mode: 'geummun' }] },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.075, rb: 0.060, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.075, rb: 0.060, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.055, rb: 0.045, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.055, rb: 0.045, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.025, 0.05], r: [0.05, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.025, 0.05], r: [0.05, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.62],       ra: 0.020, rb: 0.018, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.06, -0.26], ra: 0.038, rb: 0.033, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    cloth:  { material: 'ACTOR_FABRIC',           tileMeters: 0.25 },
    skirt:  { material: 'ACTOR_FABRIC',           tileMeters: 0.30 },
    accent: { material: 'ACTOR_ACCENT_{team}',    tileMeters: 0.25 },
    trim:   { material: 'ACTOR_DANCHEONG_{team}', tileMeters: 0.20 },
    bolt:   { material: 'ACTOR_FABRIC',           tileMeters: 0.15 },
    hide:   { material: 'ACTOR_HIDE',             tileMeters: 0.30 },
    hair:   { material: 'ACTOR_WOOD',             tileMeters: 0.20 },
    metal:  { material: 'ACTOR_METAL',            tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',             tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.32, height: 1.62, crouchHeight: 1.12, stepHeight: 0.42 }, massKg: 60, health: { max: 100, provisional: true } },
  movement: { walk: 3.5, sprint: 5.0, crouch: 1.8, jumpSpeed: 5.8, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'CARBINE', instance: { id: 'jiknyeo_carbine_v1', displayName: null, handling: {} } },
  skills: [{ primitive: 'spawnSurface', params: { class: 'EARTH_WALL', shape: 'cloth_shield_v1', durability: null, attach: 'actor' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'soft_shoe' },
  ragdoll: { template: 'biped', massScale: { wrist: 1.4 } },
  pose: { style: { strideM: 0.42, armSwing: 0.15, bob: 0.015, idleBreath: 0.010 }, aim: { propBone: 'wrist_R', twoHand: false }, dangle: [] },
});
