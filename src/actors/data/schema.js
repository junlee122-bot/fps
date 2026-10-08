/**
 * src/actors/data/schema.js — 캐릭터 정의 검증·정규화·삼각형 추정 (P4B 설계서 §2-2 ~ §2-5, §3-2, §3-7).
 *
 * 묶음 actors-data. 허용 import 는 actors-data·src/core 뿐이다(§1-1). 재질 키·무기 계열은 materials·
 * weapons 가 소유하므로 import 하지 않고 ctx 로 주입받는다(main.js·테스트, §2-1).
 *
 * 규칙: 위반은 problems[] 로 모으고 조용히 고치지 않는다. 레지스트리(index.js)가 비어 있지 않은
 * problems 에 throw 한다(PATCH-001-D). 경고(warnings)는 판정이 아니라 보고다(§2-5 규칙 7·8).
 *
 * ctx = {
 *   surfaces,        // SURFACES(core) — 표면 존재·DECAL 판별
 *   materialKeys,    // 재질 키 목록(materials 소유, 주입) — 필수
 *   weaponFamilies,  // 무기 계열 목록(weapons 소유, 주입) — 필수
 *   skeletons,       // {이름: 골격 템플릿}
 *   abilityNames, skillPrimitives,
 *   characters,      // {id: def} — 외견·identicalTo 교차 참조(없으면 다른 캐릭터 참조는 문제로 낸다)
 *   footstepProfiles?, // 발소리 프로파일 키 목록(있으면 소속 검사)
 *   stageBand?,      // [y0, y1] 무대 가시 대역(있으면 최고점 경고, §2-5 규칙 7)
 *   skipInjected?,   // true = 주입 목록(materialKeys·weaponFamilies) 소속 검사를 건너뛰고 skipped 에 기록
 * }
 */

import {
  PRIMS_PER_ACTOR_MAX, TRIS_PER_CHARACTER_MAX, STEP_HEIGHT, AGENT_RADIUS_MAX, CAPSULE_STEM_MIN,
  FACTIONS, TEAM_KEYS, RESERVED_ABILITIES, SKILL_MAX_ACTIVE, ZONES, PRIM_KINDS, BAND_MODES,
  AUDIT_POSES, APPEARANCE_TEAMS, SELF, DEFAULT_STATE,
} from './limits.js';
import { PenClass } from '../../core/surfaces.js';
import { buildRestFor, bendDegAt } from './skeletons/biped.js';
import { qrot, quatToMat3, eulerXYZToMat3, mat3mul } from './geom.js';

export const SCHEMA_VERSION = 1;

/** 캐릭터·외견 상태·슬롯 이름 형식(§2-2 `[a-z][a-z0-9_]*`) */
export const ID_RE = /^[a-z][a-z0-9_]*$/;
/** 원시 id 형식 — 뼈 이름처럼 좌우 접미사 대문자를 허용(`uarm_L`) */
export const PRIM_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** 재질 키의 진영 자리 */
export const TEAM_TOKEN = '{team}';
/** 액터 재질 키 접두(§2-2 `'ACTOR_*'`) — 건축 재질을 액터에 그대로 쓰는 것을 막는다 */
export const ACTOR_MATERIAL_PREFIX = 'ACTOR_';

/**
 * 분할 규칙(§3-2, 구현 파라미터 — 게이트 아님). meshgen(단계 3c)은 tessOf 를 import 해서 쓴다 —
 * 추정과 생성이 같은 함수를 보므로 `index.count/3 = estimateTris` 가 구성으로 성립한다.
 *   R     = clamp(2·ceil(π / (2·acos(1 − ε/r_max))), 12, 32) × seg   (새그 ε = 3 mm)
 *   nCap  = clamp(ceil(r_max/0.03), 3, 6),  nSide = clamp(ceil(L/0.08), 1, 8)
 *   rc 프로파일 점 P = 2(nCap+1) + nSide − 1, el Q = R/2 + 1, 밴드 경계 고리마다 +1 점
 *   tris  = 2R(점 수 − 2)  (양 극은 부채꼴, 사이는 사각띠 — §3-7)
 */
export const TESS = Object.freeze({
  sagM: 0.003,
  rMin: 12, rMax: 32,
  capStepM: 0.03, capMin: 3, capMax: 6,
  sideStepM: 0.08, sideMin: 1, sideMax: 8,
});

/** 보고 전용 수평 돌출 표본 방향 수(구현 파라미터, 판정에 쓰지 않음) */
const HORIZ_SAMPLES = 360;

const TOP_KEYS = ['schema', 'id', 'faction', 'displayName', 'skeleton', 'shape', 'look', 'body', 'movement',
  'weapon', 'skills', 'appearance', 'silhouette', 'audio', 'ragdoll', 'pose'];
const PRIM_COMMON = ['id', 'bone', 'kind', 'slot', 'surface', 'zone', 'occluder', 'hitbox', 'seg', 'bands'];
const PRIM_KIND_KEYS = { rc: ['a', 'b', 'ra', 'rb'], el: ['c', 'r', 'rotDeg'] };

/* ================================ 작은 판별 도우미 ================================ */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;
const isNonNeg = (v) => isNum(v) && v >= 0;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function makeSink() {
  const problems = [];
  const warnings = [];
  const skipped = [];
  return {
    problems, warnings, skipped,
    bad(code, path, msg) { problems.push({ code, path, msg }); },
    warn(code, path, msg) { warnings.push({ code, path, msg }); },
  };
}

/** 닫힌 키 집합 — 빠진 필수 키·모르는 키를 문제로(오타가 조용히 무시되지 않게) */
function closedKeys(sink, obj, path, required, optional = []) {
  if (!isObj(obj)) { sink.bad('field.type', path, '객체여야 한다'); return false; }
  for (const k of required) if (!(k in obj)) sink.bad('field.missing', `${path}.${k}`, '필수 필드 없음');
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) sink.bad('field.unknown', `${path}.${k}`, '모르는 필드');
  return true;
}

/* ================================ 분할·삼각형 ================================ */

function primRMax(p) {
  return p.kind === 'rc' ? Math.max(p.ra, p.rb) : Math.max(p.r[0], p.r[1], p.r[2]);
}

/**
 * 원시 분할 파라미터 — meshgen 과 estimateTris 의 공용 단일 출처.
 * rings = 밴드 경계값 중 (0, 1) 안의 서로 다른 값(오름차순). 끝점(0·1)은 극이라 고리가 없다.
 */
export function tessOf(p) {
  const rMax = primRMax(p);
  const x = Math.max(-1, 1 - TESS.sagM / rMax);
  const r0 = 2 * Math.ceil(Math.PI / (2 * Math.acos(x)));
  const seg = p.seg === undefined ? 1 : p.seg;
  const R = clamp(r0, TESS.rMin, TESS.rMax) * seg;
  const bounds = new Set();
  for (const b of p.bands || []) {
    if (b.v0 > 0 && b.v0 < 1) bounds.add(b.v0);
    if (b.v1 > 0 && b.v1 < 1) bounds.add(b.v1);
  }
  const rings = [...bounds].sort((a, b) => a - b);
  if (p.kind === 'rc') {
    const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
    const nCap = clamp(Math.ceil(rMax / TESS.capStepM), TESS.capMin, TESS.capMax);
    const nSide = clamp(Math.ceil(L / TESS.sideStepM), TESS.sideMin, TESS.sideMax);
    const points = 2 * (nCap + 1) + nSide - 1 + rings.length;
    return { kind: 'rc', R, nCap, nSide, rings, points, tris: 2 * R * (points - 2) };
  }
  const Q = R / 2 + 1;
  const points = Q + rings.length;
  return { kind: 'el', R, Q, rings, points, tris: 2 * R * (points - 2) };
}

export function primTris(p) {
  return tessOf(p).tris;
}

/**
 * 캐릭터 1종 추정 삼각형(§3-7) = Σ 원시. 무기 원시 포함(결정 13 보수 해석).
 * 메시는 원시만으로 만들어지므로(강체 스키닝, 뼈 로컬 원시) 골격 인자가 필요 없다.
 */
export function estimateTris(def) {
  let n = 0;
  for (const p of def.shape.primitives) n += primTris(p);
  return n;
}

/* ================================ 휴지 자세 경계(보고) ================================ */

/**
 * 휴지 자세 월드 경계 — 원시 최고점·뿌리 수직축에서의 최대 수평 반경(보고 전용, §2-5 규칙 7·8).
 * rc 는 양끝 구로 정확, el 은 지지 함수(최고점 정확, 수평은 HORIZ_SAMPLES 방향 표본).
 */
export function restExtents(def, tpl) {
  const rest = buildRestFor(tpl, def.skeleton.proportions, def.skeleton.posture);
  const idx = Object.create(null);
  tpl.bones.forEach((b, i) => { idx[b.name] = i; });
  const pa = new Float64Array(3), pb = new Float64Array(3);
  const Rb = new Float64Array(9), Re = new Float64Array(9), M = new Float64Array(9);
  let topY = -Infinity, maxHoriz = 0, topPrim = null, horizPrim = null;
  const perPrim = [];
  for (const p of def.shape.primitives) {
    const bi = idx[p.bone];
    const ox = rest.worldPos[bi * 3], oy = rest.worldPos[bi * 3 + 1], oz = rest.worldPos[bi * 3 + 2];
    let top, horiz;
    if (p.kind === 'rc') {
      qrot(rest.worldQuat, bi * 4, p.a, 0, pa, 0);
      qrot(rest.worldQuat, bi * 4, p.b, 0, pb, 0);
      const ay = oy + pa[1], by = oy + pb[1];
      top = Math.max(ay + p.ra, by + p.rb);
      horiz = Math.max(Math.hypot(ox + pa[0], oz + pa[2]) + p.ra, Math.hypot(ox + pb[0], oz + pb[2]) + p.rb);
    } else {
      qrot(rest.worldQuat, bi * 4, p.c, 0, pa, 0);
      const cx = ox + pa[0], cy = oy + pa[1], cz = oz + pa[2];
      quatToMat3(rest.worldQuat, bi * 4, Rb, 0);
      eulerXYZToMat3(p.rotDeg, Re, 0);
      mat3mul(Rb, 0, Re, 0, M, 0);
      // 축 스케일: M 의 열 j 에 r[j] 를 곱한 행렬 A 에 대해 지지 함수 h(d) = c·d + |Aᵀd|
      const A = (r, c) => M[r * 3 + c] * p.r[c];
      top = cy + Math.hypot(A(1, 0), A(1, 1), A(1, 2));
      horiz = 0;
      for (let k = 0; k < HORIZ_SAMPLES; k++) {
        const t = (2 * Math.PI * k) / HORIZ_SAMPLES;
        const dx = Math.cos(t), dz = Math.sin(t);
        const s = cx * dx + cz * dz + Math.hypot(A(0, 0) * dx + A(2, 0) * dz, A(0, 1) * dx + A(2, 1) * dz, A(0, 2) * dx + A(2, 2) * dz);
        if (s > horiz) horiz = s;
      }
    }
    perPrim.push({ id: p.id, top, horiz });
    if (top > topY) { topY = top; topPrim = p.id; }
    if (horiz > maxHoriz) { maxHoriz = horiz; horizPrim = p.id; }
  }
  return { rest, topY, topPrim, maxHoriz, horizPrim, perPrim };
}

/* ================================ 외견 해석 ================================ */

/**
 * 외견 상태 → 시각 리그 출처 캐릭터 id. rigOf = 'self' 이면 그 캐릭터, 아니면 대상 캐릭터의
 * default 상태를 따라간다(대상의 default 가 또 다른 캐릭터를 가리키면 연쇄). 순환·미지 참조는
 * { error } 로 돌려준다 — 호출자가 문제로 기록하거나 throw 한다.
 */
export function resolveRigId(characters, charId, state) {
  const seen = [];
  let id = charId, st = state;
  for (;;) {
    const key = `${id}:${st}`;
    if (seen.includes(key)) return { error: 'cycle', chain: [...seen, key] };
    seen.push(key);
    const def = characters[id];
    if (!def) return { error: 'ref', chain: seen, missing: id };
    const states = def.appearance && def.appearance.states;
    const s = isObj(states) ? states[st] : undefined;
    if (!isObj(s)) return { error: 'state', chain: seen, missing: key };
    if (s.rigOf === SELF || s.rigOf === id) return { rigId: id, chain: seen };
    id = s.rigOf;
    st = DEFAULT_STATE;
  }
}

/** 외견 팀 표시 → 진영. team = 'self' 면 자기 진영, 'opponent' 면 상대 진영 */
export function apparentFaction(def, state) {
  const s = def.appearance.states[state];
  if (s.team === SELF) return def.faction;
  const other = FACTIONS.find((f) => f !== def.faction);
  return other;
}

/** look slot 재질 키의 `{team}` 을 진영 접미사로 치환 */
export function resolveMaterialKey(material, faction) {
  return material.split(TEAM_TOKEN).join(TEAM_KEYS[faction]);
}

/* ================================ 검증 ================================ */

function requireCtx(ctx) {
  if (!isObj(ctx)) throw new TypeError('validateCharacter: ctx 가 필요하다');
  for (const k of ['surfaces', 'skeletons', 'abilityNames', 'skillPrimitives']) {
    if (ctx[k] === undefined) throw new TypeError(`validateCharacter: ctx.${k} 가 필요하다`);
  }
  if (!ctx.skipInjected) {
    // 주입 목록이 없을 때 그 검사를 조용히 건너뛰면 "덜 엄격한 통과"가 된다(PATCH-001-C) — 명시 생략만 허용
    if (!Array.isArray(ctx.materialKeys)) throw new TypeError('validateCharacter: ctx.materialKeys(재질 키 목록, 주입) 가 필요하다');
    if (!Array.isArray(ctx.weaponFamilies)) throw new TypeError('validateCharacter: ctx.weaponFamilies(무기 계열 목록, 주입) 가 필요하다');
  }
}

function checkSkeleton(sink, def, ctx) {
  const sk = def.skeleton;
  if (!closedKeys(sink, sk, 'skeleton', ['template', 'proportions', 'posture'])) return null;
  const tpl = ctx.skeletons[sk.template];
  if (!tpl) { sink.bad('skeleton.template', 'skeleton.template', `미지 골격 템플릿 '${sk.template}'`); return null; }
  let ok = true;
  if (closedKeys(sink, sk.proportions, 'skeleton.proportions', tpl.proportionKeys)) {
    for (const k of tpl.proportionKeys) {
      if (k in sk.proportions && !isPos(sk.proportions[k])) { sink.bad('skeleton.proportion', `skeleton.proportions.${k}`, '양의 유한수여야 한다'); ok = false; }
    }
    if (tpl.proportionKeys.some((k) => !(k in sk.proportions))) ok = false;
  } else ok = false;
  if (closedKeys(sink, sk.posture, 'skeleton.posture', tpl.postureKeys)) {
    for (const k of tpl.postureKeys) {
      if (!(k in sk.posture)) { ok = false; continue; }
      const v = sk.posture[k];
      const good = tpl.postureWidthKeys.includes(k) ? isPos(v) : isNum(v);
      if (!good) { sink.bad('skeleton.posture', `skeleton.posture.${k}`, tpl.postureWidthKeys.includes(k) ? '양의 유한수여야 한다' : '유한수여야 한다'); ok = false; }
    }
  } else ok = false;
  return { tpl, restOk: ok };
}

function checkLook(sink, def, ctx) {
  const look = def.look;
  if (!closedKeys(sink, look, 'look', ['slots'])) return null;
  if (!isObj(look.slots) || Object.keys(look.slots).length === 0) { sink.bad('look.slots', 'look.slots', '비어 있지 않은 객체여야 한다'); return null; }
  const faction = FACTIONS.includes(def.faction) ? def.faction : null;
  for (const [name, slot] of Object.entries(look.slots)) {
    const path = `look.slots.${name}`;
    if (!ID_RE.test(name)) sink.bad('look.slotName', path, `slot 이름 형식 ${ID_RE}`);
    if (!closedKeys(sink, slot, path, ['material', 'tileMeters'])) continue;
    if (!isStr(slot.material) || !slot.material.startsWith(ACTOR_MATERIAL_PREFIX)) {
      sink.bad('look.material', `${path}.material`, `'${ACTOR_MATERIAL_PREFIX}*' 재질 키여야 한다`);
    } else if (faction) {
      const key = resolveMaterialKey(slot.material, faction);
      if (ctx.skipInjected) sink.skipped.push(`${path}.material ∈ materialKeys`);
      else if (!ctx.materialKeys.includes(key)) sink.bad('look.materialKey', `${path}.material`, `재질 키 '${key}' 가 주입 목록에 없다`);
    }
    if (!isPos(slot.tileMeters)) sink.bad('look.tile', `${path}.tileMeters`, '양의 유한수여야 한다');
  }
  return look.slots;
}

function checkPrims(sink, def, ctx, tpl, slots, dangleBones) {
  const shape = def.shape;
  if (!closedKeys(sink, shape, 'shape', ['primitives'])) return false;
  const prims = shape.primitives;
  if (!Array.isArray(prims) || prims.length === 0) { sink.bad('prims.count', 'shape.primitives', '원시 ≥ 1 이어야 한다'); return false; }
  if (prims.length > PRIMS_PER_ACTOR_MAX) sink.bad('prims.count', 'shape.primitives', `원시 ${prims.length} > ${PRIMS_PER_ACTOR_MAX}`);
  const ids = new Set();
  const usedSlots = new Set();
  let geomOk = true;
  const boneNames = tpl ? new Set(tpl.bones.map((b) => b.name)) : null;
  prims.forEach((p, i) => {
    const path = `shape.primitives[${i}]`;
    if (!isObj(p)) { sink.bad('field.type', path, '객체여야 한다'); geomOk = false; return; }
    const kindKeys = PRIM_KIND_KEYS[p.kind];
    if (!kindKeys) { sink.bad('prim.kind', `${path}.kind`, `종류는 ${PRIM_KINDS.join('|')}`); geomOk = false; return; }
    closedKeys(sink, p, path, ['id', 'bone', 'kind', 'slot', 'surface', 'zone', ...kindKeys], ['occluder', 'hitbox', 'seg', 'bands']);
    if (!isStr(p.id) || !PRIM_ID_RE.test(p.id)) sink.bad('prim.id', `${path}.id`, `형식 ${PRIM_ID_RE}`);
    else if (ids.has(p.id)) sink.bad('prim.id', `${path}.id`, `원시 id '${p.id}' 중복`);
    ids.add(p.id);
    if (boneNames && !boneNames.has(p.bone)) { sink.bad('prim.bone', `${path}.bone`, `미지 뼈 '${p.bone}'`); geomOk = false; }
    if (tpl && tpl.reserved.includes(p.bone) && !dangleBones.has(p.bone)) {
      sink.bad('prim.reservedBone', `${path}.bone`, `예약 뼈 '${p.bone}' 는 pose.dangle 사슬에 든 경우에만 원시를 단다`);
    }
    if (slots && !(p.slot in slots)) sink.bad('prim.slot', `${path}.slot`, `look.slots 에 없는 slot '${p.slot}'`);
    usedSlots.add(p.slot);
    const surf = ctx.surfaces[p.surface];
    if (!surf) sink.bad('surface.unknown', `${path}.surface`, `미지 표면 '${p.surface}' (SURFACES)`);
    else if (surf.penClass === PenClass.DECAL) sink.bad('surface.decal', `${path}.surface`, `DECAL 등급 '${p.surface}' 는 탄도 표면이 될 수 없다(결정 9)`);
    if (!ZONES.includes(p.zone)) sink.bad('prim.zone', `${path}.zone`, `구역은 ${ZONES.join('|')}`);
    for (const f of ['occluder', 'hitbox']) if (f in p && typeof p[f] !== 'boolean') sink.bad('prim.flag', `${path}.${f}`, '불리언이어야 한다');
    if (p.zone === 'prop' && p.hitbox !== false) sink.bad('prim.propHitbox', `${path}.hitbox`, "무기·장비(zone 'prop') 원시는 hitbox:false 여야 한다(§2-3)");
    if (p.bone === 'prop' && p.zone !== 'prop') sink.bad('prim.propZone', `${path}.zone`, "prop 뼈 원시는 zone 'prop' 이어야 한다");
    if ('seg' in p && !(Number.isInteger(p.seg) && p.seg >= 1)) { sink.bad('prim.seg', `${path}.seg`, '1 이상의 정수여야 한다'); geomOk = false; }
    if (p.kind === 'rc') {
      if (!isVec3(p.a) || !isVec3(p.b) || !isPos(p.ra) || !isPos(p.rb)) { sink.bad('prim.rc', path, 'a·b 는 유한 3벡터, ra·rb 는 양수'); geomOk = false; }
      else {
        const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
        if (!(Math.abs(p.ra - p.rb) < L)) { sink.bad('prim.rc', path, `|ra − rb| < |b − a| 위반(${Math.abs(p.ra - p.rb)} ≥ ${L})`); geomOk = false; }
      }
    } else if (!isVec3(p.c) || !isVec3(p.r) || !p.r.every((v) => v > 0) || !isVec3(p.rotDeg)) {
      sink.bad('prim.el', path, 'c·rotDeg 는 유한 3벡터, r 은 양의 3벡터');
      geomOk = false;
    }
    if ('bands' in p) {
      if (!Array.isArray(p.bands)) { sink.bad('band.type', `${path}.bands`, '배열이어야 한다'); geomOk = false; }
      else {
        let lastV1 = -Infinity;
        const sorted = [...p.bands].map((b, j) => ({ b, j })).sort((x, y) => (x.b?.v0 ?? 0) - (y.b?.v0 ?? 0));
        for (const { b, j } of sorted) {
          const bp = `${path}.bands[${j}]`;
          if (!closedKeys(sink, b, bp, ['slot', 'v0', 'v1', 'mode'])) { geomOk = false; continue; }
          if (slots && !(b.slot in slots)) sink.bad('band.slot', `${bp}.slot`, `look.slots 에 없는 slot '${b.slot}'`);
          usedSlots.add(b.slot);
          if (!(isNum(b.v0) && isNum(b.v1) && b.v0 >= 0 && b.v0 < b.v1 && b.v1 <= 1)) { sink.bad('band.range', bp, '0 ≤ v0 < v1 ≤ 1'); geomOk = false; }
          else if (b.v0 < lastV1) sink.bad('band.overlap', bp, '같은 원시의 밴드 구간이 겹친다');
          if (isNum(b.v1)) lastV1 = Math.max(lastV1, b.v1);
          if (!BAND_MODES.includes(b.mode)) sink.bad('band.mode', `${bp}.mode`, `모드는 ${BAND_MODES.join('|')}`);
        }
      }
    }
  });
  if (slots) {
    for (const name of Object.keys(slots)) {
      if (!usedSlots.has(name)) sink.bad('look.unused', `look.slots.${name}`, '어느 원시·밴드도 쓰지 않는 slot(그룹 ↔ slot 완전, §3-9)');
    }
  }
  return geomOk;
}

function checkBody(sink, def) {
  const body = def.body;
  if (!closedKeys(sink, body, 'body', ['capsule', 'massKg', 'health'])) return;
  const c = body.capsule;
  if (closedKeys(sink, c, 'body.capsule', ['radius', 'height', 'crouchHeight', 'stepHeight'])) {
    if (!isPos(c.radius) || c.radius > AGENT_RADIUS_MAX) sink.bad('capsule.radius', 'body.capsule.radius', `0 < radius ≤ ${AGENT_RADIUS_MAX}(플레이어 반경 재사용, 내아 동문 0.7425 m)`);
    if (isPos(c.radius)) {
      const min = 2 * c.radius + CAPSULE_STEM_MIN;
      if (!isNum(c.height) || c.height < min) sink.bad('capsule.height', 'body.capsule.height', `height ≥ 2r + ${CAPSULE_STEM_MIN} = ${min}`);
      if (!isNum(c.crouchHeight) || c.crouchHeight < min) sink.bad('capsule.crouchHeight', 'body.capsule.crouchHeight', `crouchHeight ≥ 2r + ${CAPSULE_STEM_MIN} = ${min}`);
    }
    if (isNum(c.height) && isNum(c.crouchHeight) && c.crouchHeight > c.height) sink.bad('capsule.crouchHeight', 'body.capsule.crouchHeight', 'crouchHeight ≤ height');
    if (c.stepHeight !== STEP_HEIGHT) sink.bad('capsule.stepHeight', 'body.capsule.stepHeight', `stepHeight == ${STEP_HEIGHT}`);
  }
  if (!isPos(body.massKg)) sink.bad('body.mass', 'body.massKg', '양의 유한수여야 한다');
  if (closedKeys(sink, body.health, 'body.health', ['max', 'provisional'])) {
    if (!isPos(body.health.max)) sink.bad('body.health', 'body.health.max', '양의 유한수여야 한다');
    if (typeof body.health.provisional !== 'boolean') sink.bad('body.health', 'body.health.provisional', '불리언이어야 한다');
  }
}

function checkMovement(sink, def, ctx) {
  const m = def.movement;
  if (!closedKeys(sink, m, 'movement', ['walk', 'sprint', 'crouch', 'jumpSpeed', 'abilities', 'provisional'])) return;
  for (const k of ['walk', 'sprint', 'crouch', 'jumpSpeed']) if (!isPos(m[k])) sink.bad('movement.speed', `movement.${k}`, '양의 유한수여야 한다');
  if (typeof m.provisional !== 'boolean') sink.bad('movement.provisional', 'movement.provisional', '불리언이어야 한다');
  if (!Array.isArray(m.abilities)) { sink.bad('movement.abilities', 'movement.abilities', '배열이어야 한다'); return; }
  if (new Set(m.abilities).size !== m.abilities.length) sink.bad('movement.abilities', 'movement.abilities', '중복 능력');
  for (const a of m.abilities) {
    if (!ctx.abilityNames.includes(a)) sink.bad('ability.unknown', 'movement.abilities', `미지 능력 '${a}'`);
    else if (RESERVED_ABILITIES.includes(a)) sink.bad('ability.reserved', 'movement.abilities', `예약 능력 '${a}' — 이동·내비 구현 전 사용 불가`);
  }
}

function checkWeapon(sink, def, ctx) {
  const w = def.weapon;
  if (!isObj(w)) { sink.bad('field.type', 'weapon', '객체여야 한다'); return; }
  const hasOne = 'family' in w, hasMany = 'familyChoices' in w;
  if (hasOne === hasMany) sink.bad('weapon.family', 'weapon', 'family 와 familyChoices 중 정확히 하나');
  closedKeys(sink, w, 'weapon', ['instance'], ['family', 'familyChoices']);
  const fams = hasOne ? [w.family] : Array.isArray(w.familyChoices) ? w.familyChoices : null;
  if (!fams || fams.length === 0) sink.bad('weapon.family', 'weapon.familyChoices', '비어 있지 않은 배열이어야 한다');
  else {
    if (new Set(fams).size !== fams.length) sink.bad('weapon.family', 'weapon.familyChoices', '중복 계열');
    for (const f of fams) {
      if (!isStr(f)) sink.bad('weapon.family', 'weapon', '계열은 문자열');
      else if (ctx.skipInjected) sink.skipped.push(`weapon '${f}' ∈ weaponFamilies`);
      else if (!ctx.weaponFamilies.includes(f)) sink.bad('weapon.family', 'weapon', `미지 무기 계열 '${f}'`);
    }
  }
  const inst = w.instance;
  if (closedKeys(sink, inst, 'weapon.instance', ['id', 'displayName', 'handling'])) {
    if (!isStr(inst.id) || !ID_RE.test(inst.id)) sink.bad('weapon.instance', 'weapon.instance.id', `형식 ${ID_RE}`);
    if (!(inst.displayName === null || isStr(inst.displayName))) sink.bad('weapon.instance', 'weapon.instance.displayName', '문자열 또는 null');
    if (!isObj(inst.handling)) sink.bad('weapon.instance', 'weapon.instance.handling', '객체여야 한다');
  }
}

function checkSkills(sink, def, ctx) {
  if (!Array.isArray(def.skills)) { sink.bad('field.type', 'skills', '배열이어야 한다'); return; }
  def.skills.forEach((s, i) => {
    const path = `skills[${i}]`;
    if (!closedKeys(sink, s, path, ['primitive', 'params', 'maxActive', 'cooldownS', 'durationS'])) return;
    if (!ctx.skillPrimitives.includes(s.primitive)) sink.bad('skill.primitive', `${path}.primitive`, `닫힌 원시 효과 밖 '${s.primitive}'`);
    if (!isObj(s.params)) sink.bad('skill.params', `${path}.params`, '객체여야 한다');
    if (s.maxActive !== SKILL_MAX_ACTIVE) sink.bad('skill.maxActive', `${path}.maxActive`, `남아 있는 스킬은 캐릭터당 ${SKILL_MAX_ACTIVE}(P4-BRIEF §4-1-D)`);
    for (const k of ['cooldownS', 'durationS']) if (!(s[k] === null || isPos(s[k]))) sink.bad('skill.timing', `${path}.${k}`, '양수 또는 null(값은 플레이테스트로 정한다)');
  });
}

function checkAppearance(sink, def, ctx, tpl) {
  const ap = def.appearance;
  if (!closedKeys(sink, ap, 'appearance', ['states'])) return;
  if (!isObj(ap.states)) { sink.bad('appearance.states', 'appearance.states', '객체여야 한다'); return; }
  if (!(DEFAULT_STATE in ap.states)) sink.bad('appearance.default', 'appearance.states', `'${DEFAULT_STATE}' 상태 필수`);
  const characters = { ...(ctx.characters || {}), [def.id]: def };
  for (const [name, s] of Object.entries(ap.states)) {
    const path = `appearance.states.${name}`;
    if (!ID_RE.test(name)) sink.bad('appearance.stateName', path, `상태 이름 형식 ${ID_RE}`);
    if (!closedKeys(sink, s, path, ['rigOf', 'lookOf', 'team'])) continue;
    for (const k of ['rigOf', 'lookOf']) {
      if (!(s[k] === SELF || (isStr(s[k]) && ID_RE.test(s[k])))) sink.bad('appearance.ref', `${path}.${k}`, `'${SELF}' 또는 캐릭터 id`);
    }
    if (!APPEARANCE_TEAMS.includes(s.team)) sink.bad('appearance.team', `${path}.team`, `팀 표시는 ${APPEARANCE_TEAMS.join('|')}`);
    const norm = (v) => (v === SELF ? def.id : v);
    // 풀 메시는 캐릭터당 그 look slot 그룹으로 1개 — 독립 룩은 스키마 v2(§2-2, 재검토 #10)
    if (norm(s.lookOf) !== norm(s.rigOf)) sink.bad('appearance.lookOf', `${path}.lookOf`, `lookOf('${s.lookOf}') === rigOf('${s.rigOf}') 여야 한다`);
    if (!(s.rigOf === SELF || isStr(s.rigOf))) continue;
    if (s.rigOf !== SELF && s.rigOf !== def.id && !ctx.characters) {
      sink.bad('appearance.ref', `${path}.rigOf`, `다른 캐릭터 '${s.rigOf}' 참조 — ctx.characters 없이 해석할 수 없다`);
      continue;
    }
    const res = resolveRigId(characters, def.id, name);
    if (res.error === 'cycle') { sink.bad('appearance.cycle', `${path}.rigOf`, `외견 순환 ${res.chain.join(' → ')}`); continue; }
    if (res.error) { sink.bad('appearance.ref', `${path}.rigOf`, `해석 불가(${res.error}: ${res.missing})`); continue; }
    const target = characters[res.rigId];
    const tTpl = target.skeleton && target.skeleton.template;
    // 같은 biped 위상의 메시가 슬롯당 Skeleton 1개를 공유하므로(§3-4) 템플릿이 같아야 한다
    if (tpl && tTpl !== def.skeleton.template) sink.bad('appearance.template', `${path}.rigOf`, `rigOf 대상 '${res.rigId}' 템플릿 '${tTpl}' ≠ '${def.skeleton.template}'`);
    // 풀 재질 `{team}` 은 부팅에 rigOf 대상 진영으로 고정 — 외견 팀이 다르면 보이는 색과 팀 표시가 어긋난다(§3-8)
    if (APPEARANCE_TEAMS.includes(s.team) && FACTIONS.includes(def.faction)) {
      const shown = apparentFaction(def, name);
      if (shown !== target.faction) sink.bad('appearance.teamFaction', `${path}.team`, `외견 팀 '${shown}' ≠ rigOf 대상 '${res.rigId}' 진영 '${target.faction}'`);
    }
  }
}

function checkSilhouette(sink, def, ctx) {
  const si = def.silhouette;
  if (!closedKeys(sink, si, 'silhouette', ['audit', 'auditPose', 'identicalTo'])) return;
  if (typeof si.audit !== 'boolean') sink.bad('silhouette.audit', 'silhouette.audit', '불리언이어야 한다');
  if (!AUDIT_POSES.includes(si.auditPose)) sink.bad('silhouette.auditPose', 'silhouette.auditPose', `감사 자세는 ${AUDIT_POSES.join('|')}`);
  if (!Array.isArray(si.identicalTo)) { sink.bad('field.type', 'silhouette.identicalTo', '배열이어야 한다'); return; }
  const characters = { ...(ctx.characters || {}), [def.id]: def };
  const states = isObj(def.appearance) && isObj(def.appearance.states) ? def.appearance.states : {};
  si.identicalTo.forEach((e, i) => {
    const path = `silhouette.identicalTo[${i}]`;
    if (!closedKeys(sink, e, path, ['state', 'character', 'characterState', 'reason'])) return;
    if (!(e.state in states)) { sink.bad('identicalTo.state', `${path}.state`, `자기 외견 상태 '${e.state}' 없음`); return; }
    if (!isStr(e.reason)) sink.bad('identicalTo.reason', `${path}.reason`, '근거 문자열 필수');
    if (e.character === def.id && e.characterState === e.state) { sink.bad('identicalTo.self', path, '자기 자신과의 동일 선언'); return; }
    const other = characters[e.character];
    if (!other) { sink.bad('identicalTo.ref', `${path}.character`, `상대 캐릭터 '${e.character}' 없음${ctx.characters ? '' : '(ctx.characters 없음)'}`); return; }
    const oStates = isObj(other.appearance) && isObj(other.appearance.states) ? other.appearance.states : {};
    if (!(e.characterState in oStates)) { sink.bad('identicalTo.ref', `${path}.characterState`, `상대 상태 '${e.character}:${e.characterState}' 없음`); return; }
    // 선언 예외는 감사 정체끼리의 쌍이다(§8-6) — 어느 쪽이든 감사 대상이 아니면 참조 정체가 없다
    if (si.audit !== true || !(other.silhouette && other.silhouette.audit === true)) {
      sink.bad('identicalTo.audit', path, '선언 쌍의 양쪽 모두 silhouette.audit 이어야 한다');
    }
    const ra = resolveRigId(characters, def.id, e.state);
    const rb = resolveRigId(characters, e.character, e.characterState);
    if (ra.error || rb.error) return; // 외견 해석 문제는 appearance 검사가 이미 기록
    // 선언쌍은 시각 리그가 같아야 판 rect HDR 이 바이트 동일해진다(§8-6) — 다르면 선언이 사실이 아니다
    if (ra.rigId !== rb.rigId) sink.bad('identicalTo.rigOf', path, `해석된 rigOf 불일치 '${ra.rigId}' ≠ '${rb.rigId}'`);
  });
}

function checkRagdoll(sink, def, tpl) {
  const rg = def.ragdoll;
  if (!closedKeys(sink, rg, 'ragdoll', ['template', 'massScale'], ['limits'])) return;
  if (!tpl) return;
  if (rg.template !== def.skeleton.template) sink.bad('ragdoll.template', 'ragdoll.template', `래그돌 템플릿 '${rg.template}' ≠ 골격 '${def.skeleton.template}'`);
  const groups = new Set(tpl.ragdoll.particles.map((p) => p.name.replace(/_[LR]$/, '')));
  if (!isObj(rg.massScale)) sink.bad('ragdoll.massScale', 'ragdoll.massScale', '객체여야 한다');
  else {
    for (const [k, v] of Object.entries(rg.massScale)) {
      if (!groups.has(k)) sink.bad('ragdoll.massScale', `ragdoll.massScale.${k}`, `미지 질량 묶음 '${k}'`);
      if (!isPos(v)) sink.bad('ragdoll.massScale', `ragdoll.massScale.${k}`, '양의 유한수여야 한다');
    }
  }
  if ('limits' in rg) {
    const keys = new Set(tpl.ragdoll.limits.map((l) => l.key));
    if (!isObj(rg.limits)) sink.bad('ragdoll.limits', 'ragdoll.limits', '객체여야 한다');
    else {
      for (const [k, v] of Object.entries(rg.limits)) {
        if (!keys.has(k)) sink.bad('ragdoll.limits', `ragdoll.limits.${k}`, `미지 한계 키 '${k}'`);
        if (!(Array.isArray(v) && v.length === 2 && v.every(isNum) && v[0] >= 0 && v[0] < v[1] && v[1] <= 180)) {
          sink.bad('ragdoll.limits', `ragdoll.limits.${k}`, '[minDeg, maxDeg], 0 ≤ min < max ≤ 180');
        }
      }
    }
  }
}

/** 데이터가 덮어쓴 값을 반영한 거리 한계 굽힘 범위 */
export function effectiveLimits(def, tpl) {
  const over = (def.ragdoll && isObj(def.ragdoll.limits)) ? def.ragdoll.limits : {};
  return tpl.ragdoll.limits.map((l) => ({ ...l, bendDeg: over[l.key] || l.bendDeg }));
}

function checkPose(sink, def, tpl) {
  const po = def.pose;
  const dangleBones = new Set();
  if (!closedKeys(sink, po, 'pose', ['style', 'aim', 'dangle'])) return dangleBones;
  if (closedKeys(sink, po.style, 'pose.style', ['strideM', 'armSwing', 'bob', 'idleBreath'])) {
    if (!isPos(po.style.strideM)) sink.bad('pose.style', 'pose.style.strideM', '양의 유한수여야 한다');
    for (const k of ['armSwing', 'bob', 'idleBreath']) if (!isNonNeg(po.style[k])) sink.bad('pose.style', `pose.style.${k}`, '0 이상의 유한수여야 한다');
  }
  if (closedKeys(sink, po.aim, 'pose.aim', ['propBone', 'twoHand'])) {
    if (tpl && !tpl.propBones.includes(po.aim.propBone)) sink.bad('pose.propBone', 'pose.aim.propBone', `무기 뼈는 ${tpl.propBones.join('|')}`);
    if (typeof po.aim.twoHand !== 'boolean') sink.bad('pose.aim', 'pose.aim.twoHand', '불리언이어야 한다');
  }
  if (!Array.isArray(po.dangle)) { sink.bad('field.type', 'pose.dangle', '배열이어야 한다'); return dangleBones; }
  const parentOf = tpl ? Object.fromEntries(tpl.bones.map((b) => [b.name, b.parent])) : {};
  po.dangle.forEach((d, i) => {
    const path = `pose.dangle[${i}]`;
    if (!closedKeys(sink, d, path, ['chain', 'stiffness', 'damping'])) return;
    if (!Array.isArray(d.chain) || d.chain.length === 0) { sink.bad('pose.dangle', `${path}.chain`, '비어 있지 않은 뼈 배열'); return; }
    d.chain.forEach((bn, j) => {
      if (tpl && !tpl.reserved.includes(bn)) { sink.bad('pose.dangle', `${path}.chain[${j}]`, `dangle 은 예약 뼈만(${tpl.reserved.join('|')}), '${bn}'`); return; }
      if (dangleBones.has(bn)) sink.bad('pose.dangle', `${path}.chain[${j}]`, `뼈 '${bn}' 가 두 사슬에 든다`);
      dangleBones.add(bn);
      if (j > 0 && tpl && parentOf[bn] !== d.chain[j - 1]) sink.bad('pose.dangle', `${path}.chain[${j}]`, `사슬 순서는 부모 → 자식('${bn}' 의 부모 '${parentOf[bn]}')`);
    });
    if (!(isNum(d.stiffness) && d.stiffness > 0 && d.stiffness <= 1)) sink.bad('pose.dangle', `${path}.stiffness`, '0 < stiffness ≤ 1');
    if (!(isNum(d.damping) && d.damping >= 0 && d.damping <= 1)) sink.bad('pose.dangle', `${path}.damping`, '0 ≤ damping ≤ 1');
  });
  return dangleBones;
}

/**
 * 캐릭터 정의 1개 검증. 반환 { ok, problems[], warnings[], skipped[], report }.
 * problems 원소 = { code, path, msg } — code 는 테스트가 음성 fixture 마다 단언하는 안정 식별자.
 */
export function validateCharacter(def, ctx) {
  requireCtx(ctx);
  const sink = makeSink();
  const report = { id: def && def.id, tris: null, prims: null, topY: null, topPrim: null, maxHorizM: null, protrusionM: null };
  if (!isObj(def)) {
    sink.bad('field.type', '', '캐릭터 정의는 객체여야 한다');
    return { ok: false, problems: sink.problems, warnings: sink.warnings, skipped: sink.skipped, report };
  }
  closedKeys(sink, def, '', TOP_KEYS);
  if (def.schema !== SCHEMA_VERSION) sink.bad('schema.version', 'schema', `schema == ${SCHEMA_VERSION}`);
  if (!isStr(def.id) || !ID_RE.test(def.id)) sink.bad('id.format', 'id', `형식 ${ID_RE}`);
  if (!FACTIONS.includes(def.faction)) sink.bad('faction.enum', 'faction', `진영은 ${FACTIONS.join('|')}`);
  if (closedKeys(sink, def.displayName, 'displayName', ['ko']) && !isStr(def.displayName.ko)) sink.bad('displayName', 'displayName.ko', '문자열');

  const skel = checkSkeleton(sink, def, ctx);
  const tpl = skel ? skel.tpl : null;
  const slots = checkLook(sink, def, ctx);
  const dangleBones = checkPose(sink, def, tpl);
  const geomOk = checkPrims(sink, def, ctx, tpl, slots, dangleBones);
  checkBody(sink, def);
  checkMovement(sink, def, ctx);
  checkWeapon(sink, def, ctx);
  checkSkills(sink, def, ctx);
  checkAppearance(sink, def, ctx, tpl);
  checkSilhouette(sink, def, ctx);
  checkRagdoll(sink, def, tpl);
  if (!isObj(def.audio) || !closedKeys(sink, def.audio, 'audio', ['footstep'])) {
    // closedKeys 가 이미 기록
  } else if (!isStr(def.audio.footstep) || !ID_RE.test(def.audio.footstep)) {
    sink.bad('audio.footstep', 'audio.footstep', `발소리 프로파일 키 형식 ${ID_RE}`);
  } else if (Array.isArray(ctx.footstepProfiles) && !ctx.footstepProfiles.includes(def.audio.footstep)) {
    sink.bad('audio.footstep', 'audio.footstep', `미지 발소리 프로파일 '${def.audio.footstep}'`);
  }

  if (geomOk && Array.isArray(def.shape?.primitives) && def.shape.primitives.length > 0) {
    report.prims = def.shape.primitives.length;
    report.tris = estimateTris(def);
    if (report.tris > TRIS_PER_CHARACTER_MAX) sink.bad('tris.budget', 'shape.primitives', `추정 삼각형 ${report.tris} > ${TRIS_PER_CHARACTER_MAX}(PATCH-010-C, 무기 포함)`);
    if (skel && skel.restOk && !sink.problems.some((p) => p.code === 'prim.bone')) {
      const ext = restExtents(def, tpl);
      report.topY = ext.topY;
      report.topPrim = ext.topPrim;
      report.maxHorizM = ext.maxHoriz;
      const r = def.body?.capsule?.radius;
      if (isPos(r)) report.protrusionM = Math.max(0, ext.maxHoriz - r);
      if (Array.isArray(ctx.stageBand) && (ext.topY < ctx.stageBand[0] || ext.topY > ctx.stageBand[1])) {
        sink.warn('silhouette.band', 'shape', `최고점 ${ext.topY.toFixed(3)} m(${ext.topPrim}) 가 무대 대역 [${ctx.stageBand.join(', ')}] 밖(보고, 판정 아님)`);
      }
      // 휴지 자세가 래그돌 거리 한계 밖이면 활성화 순간 구속이 자세를 튕긴다
      if (isObj(def.ragdoll) && (!('limits' in def.ragdoll) || isObj(def.ragdoll.limits))) {
        for (const l of effectiveLimits(def, tpl)) {
          const bend = bendDegAt(ext.rest.particlePos, l.a, l.joint, l.c, tpl);
          if (bend < l.bendDeg[0] - 1e-9 || bend > l.bendDeg[1] + 1e-9) {
            sink.bad('ragdoll.restLimit', `ragdoll.limits.${l.key}`, `휴지 굽힘 ${bend.toFixed(2)}° 가 한계 [${l.bendDeg.join(', ')}] 밖(${l.joint})`);
          }
        }
      }
    }
  }
  return { ok: sink.problems.length === 0, problems: sink.problems, warnings: sink.warnings, skipped: sink.skipped, report };
}

/**
 * 로스터 전체 검증 — id 유일, 정의별 검증(교차 참조는 이 집합 안에서). 문제 path 앞에 id 를 붙인다.
 * 반환 { ok, problems[], warnings[], skipped[], reports{id: report} }.
 */
export function validateRoster(defs, ctx) {
  if (!Array.isArray(defs)) throw new TypeError('validateRoster: defs 배열이 필요하다');
  const problems = [], warnings = [], skipped = [], reports = {};
  const characters = Object.create(null);
  defs.forEach((d, i) => {
    const id = isObj(d) ? d.id : undefined;
    if (isStr(id) && characters[id]) problems.push({ code: 'id.duplicate', path: `[${i}].id`, msg: `캐릭터 id '${id}' 중복` });
    else if (isStr(id)) characters[id] = d;
  });
  if (defs.length === 0) problems.push({ code: 'roster.empty', path: '', msg: '로스터가 비었다' });
  defs.forEach((d, i) => {
    const res = validateCharacter(d, { ...ctx, characters });
    const tag = isObj(d) && isStr(d.id) ? d.id : `[${i}]`;
    for (const p of res.problems) problems.push({ ...p, path: `${tag}:${p.path}` });
    for (const w of res.warnings) warnings.push({ ...w, path: `${tag}:${w.path}` });
    for (const s of res.skipped) skipped.push(`${tag}:${s}`);
    reports[tag] = res.report;
  });
  const rigPairs = problems.length === 0 ? rigPairReports(defs, characters, reports) : [];
  return { ok: problems.length === 0, problems, warnings, skipped, reports, rigPairs };
}

/**
 * 외견 상태별 시각 리그 대 진짜 캡슐 보고(§2-5 규칙 8, R11·R21 — 판정 아님).
 * 변장한 흥부는 도깨비 리그(최고점 ≈2.0 m)를 진짜 캡슐(키·반경) 위에 그린다. 그 어긋남을 숫자로 남겨
 * 히트·차폐·충돌의 차이를 발주자가 볼 수 있게 한다. rigOf 가 자기 자신인 상태는 캐릭터별 보고에 이미 있다.
 */
function rigPairReports(defs, characters, reports) {
  const out = [];
  for (const d of defs) {
    for (const state of Object.keys(d.appearance.states)) {
      const res = resolveRigId(characters, d.id, state);
      if (res.error || res.rigId === d.id) continue;
      const rig = reports[res.rigId];
      const cap = d.body.capsule;
      out.push({
        id: d.id, state, rigId: res.rigId,
        rigTopY: rig.topY, trueHeight: cap.height,
        rigMaxHorizM: rig.maxHorizM, trueRadius: cap.radius,
        protrusionM: rig.maxHorizM === null ? null : Math.max(0, rig.maxHorizM - cap.radius),
      });
    }
  }
  return out;
}

/**
 * 정규화 — 원시의 생략 가능 필드(occluder·hitbox 기본 true, bands 기본 [])를 명시한 사본.
 * 소비자(meshgen·차폐·히트·래그돌)가 기본값을 저마다 해석해 어긋나는 일을 막는다.
 * 원본은 건드리지 않는다(데이터 파일은 JSON 왕복 순수성 대상).
 */
export function normalizeCharacter(def) {
  const prims = def.shape.primitives.map((p) => ({
    ...p,
    occluder: p.occluder === undefined ? true : p.occluder,
    hitbox: p.hitbox === undefined ? true : p.hitbox,
    bands: p.bands === undefined ? [] : p.bands.map((b) => ({ ...b })),
  }));
  return { ...def, shape: { ...def.shape, primitives: prims } };
}
