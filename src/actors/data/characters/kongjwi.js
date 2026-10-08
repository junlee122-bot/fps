/**
 * 콩쥐 — 인간계(수비), DMR, 스킬 editHoles(fill, 구멍 메우기). 아래가 퍼지는 윤곽: 치마 2단
 * (상단 1.20 → 0.65 m, r .16 → .30 / 하단 0.65 → 0.05 m, r .30 → .42), 짧은 저고리 + 고름 띠, 쪽머리.
 * 설계서 §2-6 표 초안 수치(형식 예시이자 설계 의도 — 확정 디자인 아님, silhouettepredict 로 조정).
 * 순수 데이터: 함수·계산식·import 금지(actor-data 테스트의 JSON 왕복·린트).
 * 치마는 골반 뼈 로컬(골반 휴지 회전 = 단위, 높이 hip 0.86)이라 월드 높이 − 0.86 이 로컬 y 다.
 * 하단 rc 의 B 반구(r .42)는 바닥 아래로 들어가 보이지 않는다 — 최대폭 0.84 m(바닥)는 판에 투영되지
 * 않으므로 판정은 대역 안 퍼짐 경향으로 한다(결정 20, 발주자 확정 대기).
 * 무기 금속은 무채 ACTOR_METAL(검토 #8).
 */
export default Object.freeze({
  schema: 1, id: 'kongjwi', faction: 'ingan', displayName: { ko: '콩쥐' },
  skeleton: { template: 'biped',
    proportions: { hip: 0.86, spine: 0.12, chest: 0.28, neck: 0.10, upperArm: 0.25, foreArm: 0.23, thigh: 0.40, shin: 0.40 },
    posture: { spinePitchDeg: 2, neckPitchDeg: 0, shoulderWidth: 0.30, hipWidth: 0.18 } },
  shape: { primitives: [
    { id: 'jeogori',  bone: 'chest',  kind: 'el', c: [0, 0.14, 0.01], r: [0.16, 0.17, 0.12], rotDeg: [0, 0, 0], slot: 'cloth', surface: 'FABRIC', zone: 'torso',
      bands: [{ slot: 'accent', v0: 0.55, v1: 0.65, mode: 'stripe' }] },
    { id: 'skirt_up', bone: 'pelvis', kind: 'rc', a: [0, 0.34, 0], b: [0, -0.21, 0], ra: 0.16, rb: 0.30, slot: 'skirt', surface: 'FABRIC', zone: 'cloth' },
    { id: 'skirt_lo', bone: 'pelvis', kind: 'rc', a: [0, -0.21, 0], b: [0, -0.81, 0], ra: 0.30, rb: 0.42, slot: 'skirt', surface: 'FABRIC', zone: 'cloth',
      bands: [{ slot: 'trim', v0: 0.62, v1: 0.70, mode: 'meoricho' }] },
    { id: 'neck',     bone: 'neck',   kind: 'rc', a: [0, 0, 0], b: [0, 0.10, 0.01], ra: 0.045, rb: 0.040, slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'head',     bone: 'head',   kind: 'el', c: [0, 0.12, 0.01], r: [0.10, 0.11, 0.11], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'head' },
    { id: 'jjok',     bone: 'acc_head', kind: 'el', c: [0, 0.20, -0.09], r: [0.07, 0.06, 0.07], rotDeg: [0, 0, 0], slot: 'hair', surface: 'FABRIC', zone: 'head' },
    { id: 'sleeve_uL', bone: 'shoulder_L', kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0],    ra: 0.070, rb: 0.080, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'sleeve_fL', bone: 'elbow_L',    kind: 'rc', a: [0, 0, 0], b: [0, -0.23, 0.02], ra: 0.080, rb: 0.090, slot: 'cloth', surface: 'FABRIC', zone: 'limb',
      bands: [{ slot: 'accent', v0: 0.80, v1: 1.0, mode: 'stripe' }] },
    { id: 'sleeve_uR', bone: 'shoulder_R', kind: 'rc', a: [0, 0, 0], b: [0, -0.25, 0],    ra: 0.070, rb: 0.080, slot: 'cloth', surface: 'FABRIC', zone: 'limb' },
    { id: 'sleeve_fR', bone: 'elbow_R',    kind: 'rc', a: [0, 0, 0], b: [0, -0.23, 0.02], ra: 0.080, rb: 0.090, slot: 'cloth', surface: 'FABRIC', zone: 'limb',
      bands: [{ slot: 'accent', v0: 0.80, v1: 1.0, mode: 'stripe' }] },
    { id: 'thigh_L', bone: 'hip_L',      kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.075, rb: 0.060, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'thigh_R', bone: 'hip_R',      kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.075, rb: 0.060, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_L',  bone: 'knee_L',     kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.055, rb: 0.045, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'shin_R',  bone: 'knee_R',     kind: 'rc', a: [0, 0, 0], b: [0, -0.40, 0],    ra: 0.055, rb: 0.045, slot: 'skirt', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_L',  bone: 'ankle_L',    kind: 'el', c: [0, -0.03, 0.05], r: [0.05, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'foot_R',  bone: 'ankle_R',    kind: 'el', c: [0, -0.03, 0.05], r: [0.05, 0.035, 0.10], rotDeg: [0, 0, 0], slot: 'hide', surface: 'FABRIC', zone: 'limb' },
    { id: 'gun_barrel', bone: 'prop', kind: 'rc', a: [0, 0, 0.05], b: [0, 0, 0.78],       ra: 0.022, rb: 0.018, slot: 'metal', surface: 'BRONZE',      zone: 'prop', hitbox: false },
    { id: 'gun_stock',  bone: 'prop', kind: 'rc', a: [0, -0.02, 0], b: [0, -0.07, -0.30], ra: 0.040, rb: 0.035, slot: 'wood',  surface: 'WOOD_COLUMN', zone: 'prop', hitbox: false },
  ] },
  look: { slots: {
    cloth:  { material: 'ACTOR_FABRIC',           tileMeters: 0.25 },
    skirt:  { material: 'ACTOR_FABRIC',           tileMeters: 0.30 },
    accent: { material: 'ACTOR_ACCENT_{team}',    tileMeters: 0.25 },
    trim:   { material: 'ACTOR_DANCHEONG_{team}', tileMeters: 0.20 },
    hide:   { material: 'ACTOR_HIDE',             tileMeters: 0.30 },
    hair:   { material: 'ACTOR_WOOD',             tileMeters: 0.20 },
    metal:  { material: 'ACTOR_METAL',            tileMeters: 0.30 },
    wood:   { material: 'ACTOR_WOOD',             tileMeters: 0.50 } } },
  body: { capsule: { radius: 0.34, height: 1.60, crouchHeight: 1.15, stepHeight: 0.42 }, massKg: 62, health: { max: 100, provisional: true } },
  movement: { walk: 3.5, sprint: 5.1, crouch: 1.8, jumpSpeed: 5.8, abilities: ['walk', 'jump', 'drop', 'crouch'], provisional: true },
  weapon: { family: 'DMR', instance: { id: 'kongjwi_dmr_v0', displayName: null, handling: {} } },
  skills: [{ primitive: 'editHoles', params: { op: 'fill', panel: null, region: null }, maxActive: 1, cooldownS: null, durationS: null }],
  appearance: { states: { default: { rigOf: 'self', lookOf: 'self', team: 'self' } } },
  silhouette: { audit: true, auditPose: 'low_ready', identicalTo: [] },
  audio: { footstep: 'soft_shoe' },
  ragdoll: { template: 'biped', massScale: { pelvis: 1.3 } },
  pose: { style: { strideM: 0.40, armSwing: 0.22, bob: 0.015, idleBreath: 0.010 }, aim: { propBone: 'wrist_R', twoHand: true }, dangle: [] },
});
