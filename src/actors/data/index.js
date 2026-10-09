/**
 * src/actors/data/index.js — 캐릭터 레지스트리·외견 해석 (P4B 설계서 §1-2, §2-1, §2-2, §5-5).
 *
 * 묶음 actors-data. 허용 import 는 actors-data·src/core 뿐(§1-1). 재질 키·무기 계열은 materials·weapons 가
 * 소유하므로 ctx 로 주입받는다(main.js 는 `Object.keys(ACTOR_RECIPES)`·`Object.keys(WEAPONS)`, 테스트는 §3-6 키 목록).
 *
 * 두 번 검증한다.
 *   1. import 시: 주입 목록 없이 할 수 있는 검사 전부(구조·기하·외견 참조·래그돌 한계·삼각형 예산).
 *      데이터 파일이 깨져 있으면 이 모듈을 import 하는 순간 throw 한다 — 부팅이 조용히 반쪽 로스터로
 *      돌지 않는다(PATCH-001-D). 생략한 주입 검사는 이 단계 결과에만 있고 getRoster 가 다시 한다.
 *   2. getRoster(ctx): 주입 목록까지 포함한 전수 검증. 문제가 하나라도 있으면 throw.
 *
 * 외견 = 시각 리그 단위(§2-2 "외견 상태의 닫힌 규칙"). 외견 상태는 시각 리그
 * {skeleton, shape, pose, ragdoll(massScale·limits), look, auditPose} 와 팀 표시를 통째로 rigOf 대상의 것으로
 * 바꾼다. 진짜 값(TRUE_KEYS)은 늘 자기 정의에서 읽는다. 리그 객체는 캐릭터마다 1개를 부팅에 만들어 두므로
 * "외견 A 인 B"가 받는 리그는 A 의 리그와 같은 객체다(비트 동일이 구성으로 성립, 결정 1).
 */

import { SURFACES } from '../../core/surfaces.js';
import {
  ABILITY_NAMES, ABILITY_BITS, SKILL_PRIMITIVES, DEFAULT_STATE,
} from './limits.js';
import { BIPED } from './skeletons/biped.js';
import {
  SCHEMA_VERSION, validateRoster, normalizeCharacter, resolveRigId, apparentFaction,
} from './schema.js';
import { deepFreeze } from './freeze.js';
import { ROSTER_DEFS } from './roster.js';

export { ROSTER_DEFS, SCHEMA_VERSION };

/** 시각 리그 항목(§2-2) — 외견 상태가 통째로 바꾸는 것 */
export const VISUAL_RIG_KEYS = Object.freeze(['skeleton', 'shape', 'pose', 'look', 'auditPose', 'ragdoll']);
/**
 * 진짜 값 닫힌 목록(§2-2) — 외견과 무관하게 자기 정의에서 읽는다. 래그돌은 구조·질량 분율이 시각 리그,
 * 총질량(body.massKg)이 진짜다(§6-2).
 */
export const TRUE_KEYS = Object.freeze(['body.capsule', 'movement', 'audio.footstep', 'body.massKg', 'body.health', 'weapon', 'skills']);
/** 이동 클래스 튜플 필드(§5-1 `(radius, height, crouchHeight, walk, jumpSpeed)`) — 순서 = 사전순 정렬 키 순서 */
export const AGENT_CLASS_FIELDS = Object.freeze(['radius', 'height', 'crouchHeight', 'walk', 'jumpSpeed']);

/** 레지스트리가 스스로 아는 검증 문맥 — 시뮬 묶음이 import 해도 되는 것만(core·actors-data) */
const BASE_CTX = Object.freeze({
  surfaces: SURFACES,
  skeletons: Object.freeze({ [BIPED.name]: BIPED }),
  abilityNames: ABILITY_NAMES,
  skillPrimitives: SKILL_PRIMITIVES,
});

function formatProblems(head, problems) {
  return `${head} — 문제 ${problems.length}건:\n${problems.map((p) => `  [${p.code}] ${p.path}: ${p.msg}`).join('\n')}`;
}

/* --------------------------- 1. import 시 구조 검증 --------------------------- */

for (const d of ROSTER_DEFS) deepFreeze(d);
const IMPORT_CHECK = validateRoster(ROSTER_DEFS, { ...BASE_CTX, skipInjected: true });
if (!IMPORT_CHECK.ok) throw new Error(formatProblems('actors/data: 로스터 데이터 구조 검증 실패', IMPORT_CHECK.problems));

/* --------------------------- 2. 레지스트리 --------------------------- */

/**
 * 로스터 레지스트리. `ctx = {materialKeys, weaponFamilies, footstepProfiles?, stageBand?, skeletons?, skipInjected?}`.
 * `defs` 기본값은 ROSTER_DEFS — 테스트는 v1 fixture 를 붙인 8종을 같은 경로로 통과시킨다(§2-7 4).
 * 반환(깊은 동결): {schema, ids, defs(정규화), index, rigs, appearance, reports, rigPairs, warnings, skipped}.
 * 넘긴 정의도 깊은 동결한다 — 레지스트리 밖 코드가 원시 수치를 고쳐 메시·차폐·히트가 서로 다른 값을 보는
 * 경로를 막는다(§4-3 일치 보장 1).
 * skipInjected 는 명시할 때만 주입 검사를 건너뛰고, 건너뛴 항목을 skipped 에 남긴다(조용한 완화 금지, PATCH-001-C).
 */
export function getRoster(ctx, defs = ROSTER_DEFS) {
  if (ctx === null || typeof ctx !== 'object') throw new TypeError('getRoster: ctx({materialKeys, weaponFamilies, …}) 가 필요하다');
  const full = { ...BASE_CTX, ...ctx, skeletons: { ...BASE_CTX.skeletons, ...(ctx.skeletons || {}) } };
  const res = validateRoster(defs, full);
  if (!res.ok) throw new Error(formatProblems('getRoster: 로스터 검증 실패', res.problems));
  for (const d of defs) deepFreeze(d);

  const norm = defs.map((d) => normalizeCharacter(d));
  const ids = norm.map((d) => d.id);
  const byId = Object.create(null);
  const index = Object.create(null);
  norm.forEach((d, i) => { byId[d.id] = d; index[d.id] = i; });

  const rigs = Object.create(null);
  for (const d of norm) {
    rigs[d.id] = {
      rigId: d.id,
      skeleton: d.skeleton, shape: d.shape, pose: d.pose, look: d.look,
      auditPose: d.silhouette.auditPose,
      ragdoll: d.ragdoll,
    };
  }
  // 외견 해석표 — 상태마다 {rigId, team}. 검증을 통과했으므로 해석 오류는 없다(있으면 검증 결함이라 throw)
  const appearance = Object.create(null);
  for (const d of norm) {
    const table = Object.create(null);
    for (const state of Object.keys(d.appearance.states)) {
      const r = resolveRigId(byId, d.id, state);
      if (r.error) throw new Error(`getRoster: 검증을 통과한 외견 '${d.id}:${state}' 해석 실패(${r.error}) — schema 결함`);
      table[state] = { rigId: r.rigId, team: apparentFaction(d, state) };
    }
    appearance[d.id] = table;
  }
  return deepFreeze({
    schema: SCHEMA_VERSION,
    ids, defs: norm, index, rigs, appearance,
    reports: res.reports, rigPairs: res.rigPairs, warnings: res.warnings, skipped: res.skipped,
  });
}

/** 캐릭터 인덱스(로스터 순서). 미지 id 는 throw(조용한 −1 금지) */
export function characterIndex(roster, charId) {
  const i = roster.index[charId];
  if (i === undefined) throw new Error(`characterIndex: 로스터에 없는 캐릭터 '${charId}'`);
  return i;
}

/** 정규화된 정의. 미지 id 는 throw */
export function characterOf(roster, charId) {
  return roster.defs[characterIndex(roster, charId)];
}

/**
 * 외견 해석 → {rigId, team}. rigId = 시각 리그 출처 캐릭터, team = 보이는 진영(외견 팀 = rigOf 대상 진영, §2-2).
 * 부팅에 만든 동결 객체를 돌려준다(호출마다 할당 없음). 미지 캐릭터·상태는 throw.
 */
export function resolveAppearance(roster, charId, state = DEFAULT_STATE) {
  const table = roster.appearance[charId];
  if (!table) throw new Error(`resolveAppearance: 로스터에 없는 캐릭터 '${charId}'`);
  const r = table[state];
  if (!r) throw new Error(`resolveAppearance: '${charId}' 에 외견 상태 '${state}' 가 없다`);
  return r;
}

/** 시각 리그 {rigId, skeleton, shape, pose, look, auditPose, ragdoll}. 같은 rigId 면 같은 객체 */
export function visualRigOf(roster, rigId) {
  const rig = roster.rigs[rigId];
  if (!rig) throw new Error(`visualRigOf: 로스터에 없는 리그 '${rigId}'`);
  return rig;
}

/* --------------------------- 3. 이동 에이전트(§5-5) --------------------------- */

/** 캐릭터의 이동 클래스 튜플 — 진짜 값(캡슐·이동)에서만 유도한다(외견 무관) */
export function agentClassOf(def) {
  const c = def.body.capsule, m = def.movement;
  return Object.freeze([c.radius, c.height, c.crouchHeight, m.walk, m.jumpSpeed]);
}

function cmpTuple(a, b) {
  for (let i = 0; i < AGENT_CLASS_FIELDS.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * 이동 클래스 표 = 정의들의 고유 튜플 사전순(§5-1, 데이터 유도). navbake 가 로스터 ∪ v1 fixture 로 부르고
 * 매니페스트에 기록한다. 입력 순서와 무관한 같은 표가 나온다.
 */
export function deriveAgentClasses(defs) {
  const out = [];
  for (const d of defs) {
    const t = agentClassOf(d);
    if (!out.some((u) => cmpTuple(u, t) === 0)) out.push(t);
  }
  out.sort(cmpTuple);
  return Object.freeze(out);
}

/** 능력 이름 배열 → 비트(§5-5 ABILITY). 미지 이름은 throw */
export function abilityMask(names) {
  let m = 0;
  for (const n of names) {
    const b = ABILITY_BITS[n];
    if (b === undefined) throw new Error(`abilityMask: 미지 능력 '${n}'`);
    m |= b;
  }
  return m;
}

/**
 * 내비 에이전트 = {radius, height, crouchHeight, abilities(비트), jumpSpeed, maxDrop, navClass}.
 * navClass = classes(매니페스트 표) 안의 튜플 위치. 없으면 throw — 로스터 ⊂ classes 는 부팅 단언이다(§5-3).
 * maxDrop: 데이터에 낙하 한계 필드가 없고 낙하 피해도 없으므로(Player TERMINAL_FALL 뿐) 'drop' 능력이 있으면
 * 무한대, 없으면 0 이다. 실제로 굽히는 DROP 링크의 상한은 내비 설정(NAV_CONFIG dropMax)이 정한다.
 */
export function agentOf(def, classes) {
  const t = agentClassOf(def);
  const navClass = classes.findIndex((u) => u.length === t.length && cmpTuple(u, t) === 0);
  if (navClass < 0) throw new Error(`agentOf: '${def.id}' 의 이동 클래스 (${t.join(', ')}) 가 classes 에 없다 — 재굽기 필요(node tools/navbake.mjs)`);
  const abilities = abilityMask(def.movement.abilities);
  return Object.freeze({
    radius: t[0], height: t[1], crouchHeight: t[2],
    abilities, jumpSpeed: t[4],
    maxDrop: (abilities & ABILITY_BITS.drop) ? Number.POSITIVE_INFINITY : 0,
    navClass,
  });
}
