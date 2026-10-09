/**
 * 흥부 — v1 제안 윤곽(P4-BRIEF §3-1-B, 발주자 확정 전). 제품 데이터가 아니라 외견 상태(변장)가 코드 추가
 * 없이 들어오는지 시험하는 fixture 다(설계서 §2-7 2·4).
 * 인간계, 카빈(P4-BRIEF §4-6), 스킬 applyModifier(도깨비 힘 빌리기 — 강화는 연사·반동·재장전만).
 * 윤곽: 갓(납작 el 챙 + rc 대우) + 등 지게(양 다리 rc 가 어깨 위로 벌어지고 가로대·짐 el) — 위가 넓다.
 * 변장 = 데이터 두 줄(설계서 §2-7 2): 외견 상태 disguise 는 도깨비 시각 리그를 통째로 쓰고(lookOf = rigOf),
 * 보이는 팀은 상대 진영 = 도깨비 진영(외견 팀 = rigOf 진영). identicalTo 는 그 쌍을 실루엣 감사의
 * 선언 예외로 올린다(P4-BRIEF §4-1-C, 28쌍 중 유일한 면제). 발소리·캡슐·질량·체력·무기는 흥부 그대로.
 * 순수 데이터: 함수·계산식·import 금지.
 */
export default Object.freeze({
  schema: 1, id: 'heungbu', faction: 'ingan', displayName: { ko: '흥부' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.88, spine: 0.14, chest: 0.30, neck: 0.10, upperArm: 0.27, foreArm: 0.25, thigh: 0.41, shin: 0.41 },
    posture: { spinePitchDeg: 10, neckPitchDeg: -6, shoulderWidth: 0.36, hipWidth: 0.20 } },
  shape: { primitives: [
    { id: 'gat_brim',  bone: 'acc_head', kind: 'el', c: [0, 0.22, 0.01], r: [0.30, 0.018, 0.30], rotDeg: [0, 0, 0], slot: 'gat', surface: 'FABRIC', zone: 'prop', hitbox: false },
    { id: 'gat_crown', bone: 'acc_head', kind: 'rc', a: [0, 0.22, 0.01], b: [0, 0.36, 0.01], ra: 0.085, rb: 0.075, slot: 'gat', surface: 'FABRIC', zone: 'prop', hitbox: false },
    { id: 'head',   bone: 'head',   kind: 'el', c: [0, 0.10, 0.02], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'neck',   bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.050, rb: 0.045, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'chest',  bone: 'chest',  kind: 'el', c: [0, 0.14, 0.01], r: [0.20, 0.24, 0.14], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.10, v1: 0.16, mode: 'stripe' }] },
    { id: 'pelvis', bone: 'pelvis', kind: 'rc', a: [-0.08, 0, 0], b: [0.08, 0, 0], ra: 0.12, rb: 0.12, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    { id: 'uarm_L',  bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.27, 0],    ra: 0.065, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_L',  bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0.02], ra: 0.055, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'uarm_R',  bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.27, 0],    ra: 0.065, rb: 0.060, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'farm_R',  bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0.02], ra: 0.055, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.080, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.080, rb: 0.065, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.060, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.41, 0],    ra: 0.060, rb: 0.050, slot: 'hide',  surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.025, 0.05], r: [0.055, 0.035, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.025, 0.05], r: [0.055, 0.035, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'jige_L',   bone: 'acc_back', kind: 'rc', a: [0.12, -0.50, -0.20], b: [0.24, 0.62, -0.26], ra: 0.030, rb: 0.030, slot: 'wood', surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
    { id: 'jige_R',   bone: 'acc_back', kind: 'rc', a: [-0.12, -0.50, -0.20], b: [-0.24, 0.62, -0.26], ra: 0.030, rb: 0.030, slot: 'wood', surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
    { id: 'jige_bar', bone: 'acc_back', kind: 'rc', a: [-0.20, 0.30, -0.24], b: [0.20, 0.30, -0.24], ra: 0.025, rb: 0.025, slot: 'wood', surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
    { id: 'jige_load', bone: 'acc_back', kind: 'el', c: [0, 0.50, -0.34], r: [0.30, 0.16, 0.14], rotDeg: [0, 0, 0], slot: 'load', surface: 'THATCH', zone: 'prop', hitbox: false },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.60],       ra: 0.020, rb: 0.018, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.06, -0.26], ra: 0.038, rb: 0.033, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    gat:    { material: 'ACTOR_HIDE',          tileMeters: 0.15 },
    cloth:  { material: 'ACTOR_FABRIC',        tileMeters: 0.25 },
    accent: { material: 'ACTOR_ACCENT_{team}', tileMeters: 0.25 },
    hide:   { material: 'ACTOR_HIDE',          tileMeters: 0.30 },
    load:   { material: 'ACTOR_WOOD',          tileMeters: 0.20 },
    metal:  { material: 'ACTOR_METAL',         tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',          tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.32, height: 1.70, crouchHeight: 1.18, stepHeight: 0.42 }, massKg: 66, health: { max: 100, provisional: true } },
  movement: { walk: 3.6, sprint: 5.2, crouch: 1.9, jumpSpeed: 6.0, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'CARBINE', instance: { id: 'heungbu_carbine_v1', displayName: null, handling: {} } },
  skills: [{ primitive: 'applyModifier', params: { mods: { fireRate: null, recoil: null, reload: null }, appearanceState: 'disguise' }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: {
    default:  { rigOf: 'self', lookOf: 'self', team: 'self' },
    disguise: { rigOf: 'dokkaebi', lookOf: 'dokkaebi', team: 'opponent' } } },
  silhouette: { audit: true, auditPose: 'low_ready',
    identicalTo: [{ state: 'disguise', character: 'dokkaebi', characterState: 'default', reason: 'P4-BRIEF §4-1-C' }] },
  audio: { footstep: 'straw_sandal' },
  ragdoll: { template: 'biped', massScale: { chest: 1.2 } },
  pose: { style: { strideM: 0.50, armSwing: 0.25, bob: 0.025, idleBreath: 0.012 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
