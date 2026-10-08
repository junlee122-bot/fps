/**
 * 견우 — v1 제안 윤곽(P4-BRIEF §3-1-B, 발주자 확정 전). 제품 데이터가 아니라 스키마·메시·내비 클래스가
 * 코드 추가 없이 v1 을 받는지 시험하는 fixture 다(설계서 §2-7 4).
 * 이세계, DMR(P4-BRIEF §4-6), 스킬 setMovementMode(vault) — 이동 능력에 'vault' 가 있는 유일한 정의.
 * 윤곽: 납작한 el 삿갓(챙 지름 0.72 m) + 정수리 둥근 꼭지, 왼손 소고삐(가는 rc) + 허리 사리(el).
 * 삿갓·고삐는 장비라 zone 'prop'·hitbox:false. 순수 데이터: 함수·계산식·import 금지.
 */
export default Object.freeze({
  schema: 1, id: 'gyeonu', faction: 'isegye', displayName: { ko: '견우' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.90, spine: 0.14, chest: 0.32, neck: 0.10, upperArm: 0.29, foreArm: 0.27, thigh: 0.42, shin: 0.42 },
    posture: { spinePitchDeg: 6, neckPitchDeg: -4, shoulderWidth: 0.40, hipWidth: 0.22 } },
  shape: { primitives: [
    { id: 'hat_brim',  bone: 'acc_head', kind: 'el', c: [0, 0.20, 0.01], r: [0.36, 0.035, 0.36], rotDeg: [0, 0, 0], slot: 'hat', surface: 'THATCH', zone: 'prop', hitbox: false },
    { id: 'hat_crown', bone: 'acc_head', kind: 'el', c: [0, 0.25, 0.01], r: [0.11, 0.08, 0.11], rotDeg: [0, 0, 0], slot: 'hat', surface: 'THATCH', zone: 'prop', hitbox: false },
    { id: 'head',   bone: 'head',   kind: 'el', c: [0, 0.10, 0.02], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'neck',   bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.055, rb: 0.050, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'chest',  bone: 'chest',  kind: 'el', c: [0, 0.15, 0.01], r: [0.22, 0.24, 0.14], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.12, v1: 0.18, mode: 'stripe' }] },
    { id: 'pelvis', bone: 'pelvis', kind: 'rc', a: [-0.09, 0, 0], b: [0.09, 0, 0], ra: 0.12, rb: 0.12, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.29, 0],    ra: 0.065, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.27, 0.02], ra: 0.055, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.29, 0],    ra: 0.065, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.27, 0.02], ra: 0.055, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.42, 0],    ra: 0.085, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.42, 0],    ra: 0.085, rb: 0.070, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.42, 0],    ra: 0.065, rb: 0.055, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.42, 0],    ra: 0.065, rb: 0.055, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.025, 0.05], r: [0.055, 0.035, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.025, 0.05], r: [0.055, 0.035, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'rein',    bone: 'wrist_L',    kind: 'rc', a: [0, 0, 0.02], b: [0.05, -0.30, 0.25], ra: 0.015, rb: 0.015, slot: 'rope', surface: 'FABRIC', zone: 'prop', hitbox: false },
    { id: 'rein_coil', bone: 'acc_waist', kind: 'el', c: [0.17, -0.02, 0.03], r: [0.09, 0.09, 0.04], rotDeg: [0, 90, 0], slot: 'rope', surface: 'FABRIC', zone: 'prop', hitbox: false },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.80],       ra: 0.022, rb: 0.018, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.07, -0.30], ra: 0.040, rb: 0.035, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    hat:    { material: 'ACTOR_WOOD',          tileMeters: 0.20 },
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.25 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    rope:   { material: 'ACTOR_FABRIC',        tileMeters: 0.10 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.32, height: 1.78, crouchHeight: 1.22, stepHeight: 0.42 }, massKg: 75, health: { max: 100, provisional: true } },
  movement: { walk: 3.8, sprint: 5.4, crouch: 2.0, jumpSpeed: 6.2, abilities: ['walk', 'jump', 'drop', 'crouch', 'vault'], provisional: true },
  weapon: { family: 'DMR', instance: { id: 'gyeonu_dmr_v1', displayName: null, handling: {} } },
  skills: [{ primitive: 'setMovementMode', params: { mode: 'vault' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'straw_sandal' },
  ragdoll: { template: 'biped', massScale: {} },
  pose: { style: { strideM: 0.60, armSwing: 0.30, bob: 0.025, idleBreath: 0.010 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
