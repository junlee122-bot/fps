/**
 * src/actors/data/skeletons/biped.js — 공용 이족 골격 템플릿 (P4B 설계서 §2-4, §6-2).
 *
 * 묶음 actors-data. 허용 import 는 actors-data·src/core 뿐(§1-1). three 를 모른다.
 *
 * 좌표 규약(모든 원시·자세·메시가 공유): 오른손계, +y 위, 액터 정면 +z, 왼쪽 +x
 * (three 카메라는 −z 를 보고 오른쪽이 +x 이므로, +z 를 보는 액터의 왼쪽은 +x 다).
 * 뼈 로컬 원시 수치(캐릭터 정의)가 이 규약을 전제로 쓰였다 — 자라 머리 c.z > 0 은 앞, 등껍질 c.z < 0 은 뒤.
 *
 * 휴지 자세: 팔·다리는 월드 수직으로 늘어뜨린다(사지 뼈 로컬 −y 가 뼈 진행 방향).
 * 척추 숙임 `spinePitchDeg` 는 spine 뼈에, 목 숙임 `neckPitchDeg` 는 neck 뼈에 x축 회전으로 들어가고,
 * 어깨는 척추 숙임을 되돌려 팔이 수직으로 처지게 한다. 양의 각 = +y 를 +z(앞)로 기울임.
 *
 * 래그돌 템플릿은 구조(입자·구속·복원표)와 질량 **가중**만 담는다. 실제 질량은 활성화 때
 * 진짜 `body.massKg` 를 분율에 곱해 채운다(§6-1, 재검토 #10). 입자 반지름·뼈 충돌체는
 * 외견 리그 원시에서 유도하므로(§6-2) 템플릿에 없다.
 */

import { BONES_MAX, RAGDOLL_PARTICLES } from '../limits.js';
import { deepFreeze } from '../freeze.js';
import { qmul, qrot, qAxisX } from '../geom.js';

const DEG = Math.PI / 180;

/**
 * 머리 끝 입자의 머리 뼈 축 거리(m). 구현 파라미터(게이트 아님) — 래그돌 머리 막대 길이일 뿐이고
 * 머리 크기·충돌 반지름은 외견 원시가 정한다(§6-2). 사람 턱–정수리 ≈0.2 m 를 따랐다.
 */
const HEAD_TOP_M = 0.20;
/**
 * 예약 dangle 뼈 휴지 간격(m). 구현 파라미터 — 비례 키에 없는 뼈라 휴지 간격을 템플릿이 정하고,
 * dangle 원시를 쓰는 데이터는 원시 길이를 이 간격에 맞춘다(심청 댕기 fixture).
 */
const DANGLE_SEG_M = 0.25;
/** 버팀대 강성(§6-2 "버팀대 6(강성 0.9)") — 구현 파라미터 */
const BRACE_STIFFNESS = 0.9;
/**
 * 래그돌 거리 한계의 굽힘 각 범위(도, 0 = 곧게). 구현 파라미터(게이트 아님) — 사람 관절 가동 범위를
 * 둥글게 따른 값이고 캐릭터 데이터 `ragdoll.limits` 가 덮어쓴다. 코사인 법칙으로 `|ac| ∈ [dmin, dmax]`.
 */
const KNEE_BEND_DEG = Object.freeze([0, 150]);
const ELBOW_BEND_DEG = Object.freeze([0, 150]);
const SPINE_BEND_DEG = Object.freeze([0, 60]);
const NECK_BEND_DEG = Object.freeze([0, 70]);

/**
 * 뼈 표 — 배열 순서 = 스킨 인덱스(부모가 늘 앞). 휴지 로컬 위치 `at` 의 각 성분은
 * `[키, 배율]`(키 = 비례·자세 값 이름, null 이면 배율이 곧 미터), 회전 `rotX` 는 `[자세 키, 부호]`.
 * `rigid` = 래그돌에서 부모 프레임에 강체 부착(§2-4: prop·acc_*·spine, 손목·발목, 예약 뼈).
 */
const BONES = [
  { name: 'root',       parent: null },
  { name: 'pelvis',     parent: 'root',       at: { y: ['hip', 1] } },
  { name: 'spine',      parent: 'pelvis',     rotX: ['spinePitchDeg', 1] },
  { name: 'chest',      parent: 'spine',      at: { y: ['spine', 1] } },
  { name: 'neck',       parent: 'chest',      at: { y: ['chest', 1] }, rotX: ['neckPitchDeg', 1] },
  { name: 'head',       parent: 'neck',       at: { y: ['neck', 1] } },
  { name: 'shoulder_L', parent: 'chest',      at: { x: ['shoulderWidth', 0.5],  y: ['chest', 1] }, rotX: ['spinePitchDeg', -1] },
  { name: 'elbow_L',    parent: 'shoulder_L', at: { y: ['upperArm', -1] } },
  { name: 'wrist_L',    parent: 'elbow_L',    at: { y: ['foreArm', -1] } },
  { name: 'shoulder_R', parent: 'chest',      at: { x: ['shoulderWidth', -0.5], y: ['chest', 1] }, rotX: ['spinePitchDeg', -1] },
  { name: 'elbow_R',    parent: 'shoulder_R', at: { y: ['upperArm', -1] } },
  { name: 'wrist_R',    parent: 'elbow_R',    at: { y: ['foreArm', -1] } },
  { name: 'hip_L',      parent: 'pelvis',     at: { x: ['hipWidth', 0.5] } },
  { name: 'knee_L',     parent: 'hip_L',      at: { y: ['thigh', -1] } },
  { name: 'ankle_L',    parent: 'knee_L',     at: { y: ['shin', -1] } },
  { name: 'hip_R',      parent: 'pelvis',     at: { x: ['hipWidth', -0.5] } },
  { name: 'knee_R',     parent: 'hip_R',      at: { y: ['thigh', -1] } },
  { name: 'ankle_R',    parent: 'knee_R',     at: { y: ['shin', -1] } },
  // prop 의 휴지 부모는 오른 손목. 실제 부착 뼈는 시각 리그 `pose.aim.propBone`(자세·래그돌 컴파일이 해석)
  { name: 'prop',       parent: 'wrist_R' },
  { name: 'acc_head',   parent: 'head' },
  { name: 'acc_back',   parent: 'chest' },
  { name: 'acc_waist',  parent: 'pelvis' },
  // 예약 2 — dangle 사슬(§2-4). 데이터가 `pose.dangle[].chain` 으로 쓸 때만 의미가 있다
  { name: 'dangle_0',   parent: 'head' },
  { name: 'dangle_1',   parent: 'dangle_0',   at: { y: [null, -DANGLE_SEG_M] } },
];

/**
 * 래그돌 입자 16 — 골격 트리 순서(pelvis 뿌리, 부모가 늘 앞, §6-4 초기 클램프 순서).
 * `offset` 은 뼈 로컬 m. `w` 는 질량 가중(구현 파라미터 — 기준 인체 분절 질량 ≈65 kg 를 관절 입자에
 * 뭉친 상대값, 정규화는 massFractions). 막대 15 = 부모 간선.
 */
const PARTICLES = [
  { name: 'pelvis',     bone: 'pelvis',     parent: null,         w: 11.0 },
  { name: 'chest',      bone: 'chest',      parent: 'pelvis',     w: 16.0 },
  { name: 'neck',       bone: 'neck',       parent: 'chest',      w: 2.5 },
  { name: 'headTop',    bone: 'head',       parent: 'neck',       w: 4.5, offset: [0, HEAD_TOP_M, 0] },
  { name: 'shoulder_L', bone: 'shoulder_L', parent: 'chest',      w: 2.0 },
  { name: 'elbow_L',    bone: 'elbow_L',    parent: 'shoulder_L', w: 1.6 },
  { name: 'wrist_L',    bone: 'wrist_L',    parent: 'elbow_L',    w: 0.9 },
  { name: 'shoulder_R', bone: 'shoulder_R', parent: 'chest',      w: 2.0 },
  { name: 'elbow_R',    bone: 'elbow_R',    parent: 'shoulder_R', w: 1.6 },
  { name: 'wrist_R',    bone: 'wrist_R',    parent: 'elbow_R',    w: 0.9 },
  { name: 'hip_L',      bone: 'hip_L',      parent: 'pelvis',     w: 6.0 },
  { name: 'knee_L',     bone: 'knee_L',     parent: 'hip_L',      w: 3.6 },
  { name: 'ankle_L',    bone: 'ankle_L',    parent: 'knee_L',     w: 1.6 },
  { name: 'hip_R',      bone: 'hip_R',      parent: 'pelvis',     w: 6.0 },
  { name: 'knee_R',     bone: 'knee_R',     parent: 'hip_R',      w: 3.6 },
  { name: 'ankle_R',    bone: 'ankle_R',    parent: 'knee_R',     w: 1.6 },
];

/** 래그돌 국소 프레임(경첩 법선용): 정면 = lateral × up. lateral 은 오른쪽 → 왼쪽(+x) */
const FRAMES = {
  pelvis: { up: ['pelvis', 'chest'], lateral: ['hip_R', 'hip_L'] },
  chest:  { up: ['chest', 'neck'],   lateral: ['shoulder_R', 'shoulder_L'] },
};

const TORSO_UP = ['pelvis', 'chest'];
const HIP_LAT = ['hip_R', 'hip_L'];
const SHO_LAT = ['shoulder_R', 'shoulder_L'];

/**
 * 프레임 복원표(§2-4 "입자 13 + 강체 자식 11"). 입자 프레임은 `origin` 입자에서 `primary` 축을 잡고
 * `secondary`(평행에 가까우면 `fallback`)로 둘째 축을 직교화한다. 휴지 자세에서 이 프레임과 뼈 휴지
 * 변환의 상대 변환을 한 번 구해 두면 뼈 = 프레임 ∘ 상대 변환이다(축 부호 규약이 표에 새지 않는다).
 * 강체 자식은 부모 뼈 프레임에 휴지 로컬 변환으로 붙는다. 순서 = 해석 순서(부모가 늘 앞).
 */
const RESTORE = {
  particleFrames: [
    { bone: 'root',       origin: 'pelvis',     primary: ['pelvis', 'chest'],         secondary: HIP_LAT, fallback: SHO_LAT },
    { bone: 'pelvis',     origin: 'pelvis',     primary: ['pelvis', 'chest'],         secondary: HIP_LAT, fallback: SHO_LAT },
    { bone: 'chest',      origin: 'chest',      primary: ['chest', 'neck'],           secondary: SHO_LAT, fallback: HIP_LAT },
    { bone: 'neck',       origin: 'neck',       primary: ['neck', 'headTop'],         secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'head',       origin: 'neck',       primary: ['neck', 'headTop'],         secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'shoulder_L', origin: 'shoulder_L', primary: ['shoulder_L', 'elbow_L'],   secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'elbow_L',    origin: 'elbow_L',    primary: ['elbow_L', 'wrist_L'],      secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'shoulder_R', origin: 'shoulder_R', primary: ['shoulder_R', 'elbow_R'],   secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'elbow_R',    origin: 'elbow_R',    primary: ['elbow_R', 'wrist_R'],      secondary: SHO_LAT, fallback: TORSO_UP },
    { bone: 'hip_L',      origin: 'hip_L',      primary: ['hip_L', 'knee_L'],         secondary: HIP_LAT, fallback: TORSO_UP },
    { bone: 'knee_L',     origin: 'knee_L',     primary: ['knee_L', 'ankle_L'],       secondary: HIP_LAT, fallback: TORSO_UP },
    { bone: 'hip_R',      origin: 'hip_R',      primary: ['hip_R', 'knee_R'],         secondary: HIP_LAT, fallback: TORSO_UP },
    { bone: 'knee_R',     origin: 'knee_R',     primary: ['knee_R', 'ankle_R'],       secondary: HIP_LAT, fallback: TORSO_UP },
  ],
  rigidChildren: [
    { bone: 'spine',     parent: 'pelvis' },
    { bone: 'wrist_L',   parent: 'elbow_L' },
    { bone: 'wrist_R',   parent: 'elbow_R' },
    { bone: 'ankle_L',   parent: 'knee_L' },
    { bone: 'ankle_R',   parent: 'knee_R' },
    { bone: 'prop',      parent: 'wrist_R' },
    { bone: 'acc_head',  parent: 'head' },
    { bone: 'acc_back',  parent: 'chest' },
    { bone: 'acc_waist', parent: 'pelvis' },
    { bone: 'dangle_0',  parent: 'head' },
    { bone: 'dangle_1',  parent: 'dangle_0' },
  ],
};

export const BIPED = deepFreeze({
  name: 'biped',
  bones: BONES,
  /** 비례 키(전부 필수·양수, §2-4). hip = 골반 높이(바닥 기준), 나머지는 해당 뼈의 다음 뼈까지 길이 */
  proportionKeys: ['hip', 'spine', 'chest', 'neck', 'upperArm', 'foreArm', 'thigh', 'shin'],
  /** 자세 키 — 너비(양수)와 숙임 각(도, 부호 있음) */
  postureKeys: ['spinePitchDeg', 'neckPitchDeg', 'shoulderWidth', 'hipWidth'],
  postureWidthKeys: ['shoulderWidth', 'hipWidth'],
  /** 예약 뼈(dangle 전용) — 사슬에 들지 않은 예약 뼈에 원시를 달면 휴지 자리에 고정된 죽은 뼈가 된다 */
  reserved: ['dangle_0', 'dangle_1'],
  /** 무기를 쥘 수 있는 뼈(`pose.aim.propBone`) */
  propBones: ['wrist_R', 'wrist_L'],
  ragdoll: {
    particles: PARTICLES,
    braces: {
      stiffness: BRACE_STIFFNESS,
      // 어깨–어깨, 고관절–고관절, 어깨 × 고관절 교차 4 — 몸통 상자를 버틴다
      pairs: [
        ['shoulder_L', 'shoulder_R'], ['hip_L', 'hip_R'],
        ['shoulder_L', 'hip_L'], ['shoulder_L', 'hip_R'], ['shoulder_R', 'hip_L'], ['shoulder_R', 'hip_R'],
      ],
    },
    /** 거리 한계 — `key` 는 데이터 `ragdoll.limits` 의 키(좌우 공통) */
    limits: [
      { key: 'knee',  a: 'hip_L',      joint: 'knee_L',  c: 'ankle_L', bendDeg: KNEE_BEND_DEG },
      { key: 'knee',  a: 'hip_R',      joint: 'knee_R',  c: 'ankle_R', bendDeg: KNEE_BEND_DEG },
      { key: 'elbow', a: 'shoulder_L', joint: 'elbow_L', c: 'wrist_L', bendDeg: ELBOW_BEND_DEG },
      { key: 'elbow', a: 'shoulder_R', joint: 'elbow_R', c: 'wrist_R', bendDeg: ELBOW_BEND_DEG },
      { key: 'spine', a: 'pelvis',     joint: 'chest',   c: 'neck',    bendDeg: SPINE_BEND_DEG },
      { key: 'neck',  a: 'chest',      joint: 'neck',    c: 'headTop', bendDeg: NECK_BEND_DEG },
    ],
    /**
     * 경첩 반공간(§6-2) `(x_joint − (x_a + x_c)/2)·(sign·forward(frame)) ≥ 0`.
     * 무릎은 앞으로(+1), 팔꿈치는 뒤로(−1) 꺾인다.
     */
    hinges: [
      { joint: 'knee_L',  a: 'hip_L',      c: 'ankle_L', frame: 'pelvis', sign: 1 },
      { joint: 'knee_R',  a: 'hip_R',      c: 'ankle_R', frame: 'pelvis', sign: 1 },
      { joint: 'elbow_L', a: 'shoulder_L', c: 'wrist_L', frame: 'chest',  sign: -1 },
      { joint: 'elbow_R', a: 'shoulder_R', c: 'wrist_R', frame: 'chest',  sign: -1 },
    ],
    frames: FRAMES,
    restore: RESTORE,
  },
});

/* ----------------------------- 파생 색인(모듈 적재 시 1회) ----------------------------- */

const boneIdx = Object.create(null);
BIPED.bones.forEach((b, i) => { boneIdx[b.name] = i; });
const particleIdx = Object.create(null);
BIPED.ragdoll.particles.forEach((p, i) => { particleIdx[p.name] = i; });

if (BIPED.bones.length > BONES_MAX) throw new Error(`biped: 뼈 ${BIPED.bones.length} > BONES_MAX ${BONES_MAX}`);
if (BIPED.ragdoll.particles.length !== RAGDOLL_PARTICLES) {
  throw new Error(`biped: 래그돌 입자 ${BIPED.ragdoll.particles.length} ≠ RAGDOLL_PARTICLES ${RAGDOLL_PARTICLES}`);
}

/** 뼈 이름 → 스킨 인덱스. 미지 이름은 throw(조용한 −1 금지, PATCH-001-D) */
export function boneIndex(name) {
  const i = boneIdx[name];
  if (i === undefined) throw new Error(`biped: 미지 뼈 '${name}'`);
  return i;
}

export function hasBone(name) {
  return boneIdx[name] !== undefined;
}

/** 입자 이름 → 입자 인덱스 */
export function particleIndex(name) {
  const i = particleIdx[name];
  if (i === undefined) throw new Error(`biped: 미지 래그돌 입자 '${name}'`);
  return i;
}

/** 부모 인덱스 표(−1 = 뿌리) — 새 배열을 돌려준다 */
export function boneParents() {
  return BIPED.bones.map((b) => (b.parent === null ? -1 : boneIdx[b.parent]));
}

/** 막대 15 = 입자 부모 간선, 데이터 순서(자식 입자 순) */
export function ragdollRods() {
  const out = [];
  for (const p of BIPED.ragdoll.particles) if (p.parent !== null) out.push([p.parent, p.name]);
  return out;
}

/** 질량 가중 묶음 이름 — 좌우 접미사를 뗀 이름(데이터 `ragdoll.massScale` 의 키) */
export function massGroupOf(particleName) {
  return particleName.replace(/_[LR]$/, '');
}

export const MASS_GROUPS = Object.freeze([...new Set(BIPED.ragdoll.particles.map((p) => massGroupOf(p.name)))]);
export const LIMIT_KEYS = Object.freeze([...new Set(BIPED.ragdoll.limits.map((l) => l.key))]);

/**
 * 입자 질량 분율(합 1). 가중 × massScale(묶음별 배율, 없으면 1) 을 정규화한다.
 * 활성화가 진짜 massKg 를 곱해 invMass 를 채우므로 외견 리그가 달라도 총질량은 진짜 값이다(§6-2).
 */
export function massFractions(massScale = {}) {
  const ps = BIPED.ragdoll.particles;
  const out = new Float64Array(ps.length);
  let sum = 0;
  for (let i = 0; i < ps.length; i++) {
    const s = massScale[massGroupOf(ps[i].name)];
    out[i] = ps[i].w * (s === undefined ? 1 : s);
    sum += out[i];
  }
  for (let i = 0; i < ps.length; i++) out[i] /= sum;
  return out;
}

function valueOf(key, proportions, posture) {
  const v = key in proportions ? proportions[key] : posture[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`buildRest: '${key}' 값이 유한수가 아니다`);
  return v;
}

const AXES = ['x', 'y', 'z'];
const ZERO3 = [0, 0, 0];

/**
 * 휴지 골격 — 템플릿 일반형(같은 표 형식이면 어떤 골격 템플릿에도 쓴다. 검증이 시험용 둘째 템플릿에도
 * 같은 규칙을 돌리려면 필요하다). 순수 함수: 같은 입력 → 같은 바이트. 뿌리는 원점(발 기준), 정면 +z.
 * 반환: 뼈별 로컬·월드 위치(3)·회전(xyzw 4)와 래그돌 입자 휴지 위치(입자 수·3), 모두 Float64Array.
 * 키가 없거나 유한수가 아니면 throw 한다(기본값 없음).
 */
export function buildRestFor(tpl, proportions, posture) {
  for (const k of tpl.proportionKeys) valueOf(k, proportions, {});
  for (const k of tpl.postureKeys) valueOf(k, {}, posture);
  const bones = tpl.bones;
  const n = bones.length;
  const idx = Object.create(null);
  bones.forEach((b, i) => { idx[b.name] = i; });
  const localPos = new Float64Array(n * 3);
  const localQuat = new Float64Array(n * 4);
  const worldPos = new Float64Array(n * 3);
  const worldQuat = new Float64Array(n * 4);
  const tmp = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const b = bones[i];
    const at = b.at || {};
    for (let c = 0; c < 3; c++) {
      const term = at[AXES[c]];
      localPos[i * 3 + c] = term ? (term[0] === null ? term[1] : valueOf(term[0], proportions, posture) * term[1]) : 0;
    }
    qAxisX(b.rotX ? valueOf(b.rotX[0], proportions, posture) * b.rotX[1] : 0, localQuat, i * 4);
    if (b.parent === null) {
      for (let c = 0; c < 3; c++) worldPos[i * 3 + c] = localPos[i * 3 + c];
      for (let c = 0; c < 4; c++) worldQuat[i * 4 + c] = localQuat[i * 4 + c];
    } else {
      const p = idx[b.parent];
      if (p === undefined || p >= i) throw new Error(`buildRest: 뼈 '${b.name}' 의 부모 '${b.parent}' 가 앞에 없다`);
      qmul(worldQuat, p * 4, localQuat, i * 4, worldQuat, i * 4);
      qrot(worldQuat, p * 4, localPos, i * 3, tmp, 0);
      for (let c = 0; c < 3; c++) worldPos[i * 3 + c] = worldPos[p * 3 + c] + tmp[c];
    }
  }
  const ps = tpl.ragdoll.particles;
  const particlePos = new Float64Array(ps.length * 3);
  for (let j = 0; j < ps.length; j++) {
    const bi = idx[ps[j].bone];
    qrot(worldQuat, bi * 4, ps[j].offset || ZERO3, 0, tmp, 0);
    for (let c = 0; c < 3; c++) particlePos[j * 3 + c] = worldPos[bi * 3 + c] + tmp[c];
  }
  return { boneCount: n, localPos, localQuat, worldPos, worldQuat, particlePos };
}

/** biped 휴지 골격 — 설계서 §1-2 공개 API `buildRest(proportions, posture)` */
export function buildRest(proportions, posture) {
  return buildRestFor(BIPED, proportions, posture);
}

/**
 * 입자 세 점(a, joint, c)의 굽힘 각(도, 0 = 곧게) — 거리 한계 검증·래그돌 컴파일 공용.
 * `tpl` 을 주면 그 템플릿의 입자 순서로 이름을 푼다(기본 biped).
 */
export function bendDegAt(particlePos, a, joint, c, tpl = BIPED) {
  const names = tpl.ragdoll.particles.map((p) => p.name);
  const at = (nm) => {
    const i = names.indexOf(nm);
    if (i < 0) throw new Error(`bendDegAt: 미지 입자 '${nm}'`);
    return i * 3;
  };
  const ia = at(a), ij = at(joint), ic = at(c);
  const ux = particlePos[ij] - particlePos[ia], uy = particlePos[ij + 1] - particlePos[ia + 1], uz = particlePos[ij + 2] - particlePos[ia + 2];
  const vx = particlePos[ic] - particlePos[ij], vy = particlePos[ic + 1] - particlePos[ij + 1], vz = particlePos[ic + 2] - particlePos[ij + 2];
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (lu * lv)));
  return Math.acos(cos) / DEG;
}
