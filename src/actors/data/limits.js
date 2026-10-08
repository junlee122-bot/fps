/**
 * src/actors/data/limits.js — 액터 상한·닫힌 어휘의 단일 출처 (P4B 설계서 §1-2, §2-5).
 *
 * 묶음 actors-data(시뮬·데이터). import 0 — three·materials·weapons·audio 를 모른다.
 * 렌더 쪽 용량 상수(HJ_SLOT_MAX·HJ_PRIM_MAX)는 각자 두고, main.js 부팅 단언과 테스트가
 * `시뮬 상한 ≤ 렌더 용량`을 검사한다(§1-1). 여기 숫자를 렌더 쪽에 복사하지 마라.
 *
 * 숫자의 성격(014-C, §8-13): 계약값 / 기존 값 재사용 / 구현 파라미터 중 하나이고 줄마다 적는다.
 * 게이트 임계는 이 파일에 없다.
 */

/** 액터 슬롯 수 — 3:3(§0-6). 차폐 풀 용량 = 슬롯 + 비액터 소스(§4-5 용량 단언 6 + 2 ≤ 8) */
export const ACTOR_SLOTS = 6;
/** 비액터 차폐 소스 상한(레거시 더미·P4C 가짜 실루엣 자리, §4-5) */
export const NON_ACTOR_OCCLUDERS_MAX = 2;
/** 액터당 형상 원시 상한 — 차폐 텍스처 행 수와 같은 값이어야 한다(§4-4 HJ_PRIM_MAX, 부팅 단언) */
export const PRIMS_PER_ACTOR_MAX = 24;
/** 골격 뼈 상한 — biped 24(§2-4) */
export const BONES_MAX = 24;
/** 캐릭터 1종 삼각형 상한 — 계약값 PATCH-010-C, 3인칭 무기 포함(결정 13 보수 해석) */
export const TRIS_PER_CHARACTER_MAX = 25000;
/** 래그돌 입자 수 — biped 템플릿(§2-4, §6-1) */
export const RAGDOLL_PARTICLES = 16;
/** 디딤 높이 — 기존 값 재사용(character.js:38, player.js 컨트롤러 생성 인자) */
export const STEP_HEIGHT = 0.42;
/**
 * 캡슐 반경 상한 — 플레이어 반경 재사용(player.js:30). 내아 동문 0.7425 m 때문에 0.40 은 못 지난다
 * (심사 A-3, §2-5 규칙 2). 반경 차이는 내비 이동 클래스가 다룬다(결정 8).
 */
export const AGENT_RADIUS_MAX = 0.34;
/**
 * 캡슐 줄기 최소 길이 — `height ≥ 2r + 0.05`(§2-2). canFit 이 `p1y < p0y` 이면 겹침 검사를
 * 건너뛰므로(character.js:119-130) 두 반구 사이에 줄기가 없는 캡슐은 천장 검사가 공허해진다.
 */
export const CAPSULE_STEM_MIN = 0.05;

/** 진영 — 팀 대역·`{team}` 치환의 출처(§2-2). 순서는 고정(팀 인덱스) */
export const FACTIONS = Object.freeze(['isegye', 'ingan']);
/** 재질 키의 `{team}` 자리에 들어가는 진영 접미사(§3-6 ACTOR_*_ISEGYE / _INGAN) */
export const TEAM_KEYS = Object.freeze({ isegye: 'ISEGYE', ingan: 'INGAN' });

/**
 * 이동 능력 비트(§5-5). climb·swim 은 예약 — 이동·내비 구현이 없으므로 데이터가 쓰면 문제로 낸다
 * (구현 없는 능력을 조용히 받으면 내비가 그 비트를 영영 무시한다, PATCH-001-D 정신).
 */
export const ABILITY_BITS = Object.freeze({
  walk: 1, jump: 2, drop: 4, crouch: 8, vault: 16, climb: 32, swim: 64,
});
export const ABILITY_NAMES = Object.freeze(Object.keys(ABILITY_BITS));
export const RESERVED_ABILITIES = Object.freeze(['climb', 'swim']);

/** 스킬 원시 효과 — 닫힌 6종(P4-BRIEF §4-1-B). 추가는 surfaces.js 등급 추가와 같은 무게의 계약 변경 */
export const SKILL_PRIMITIVES = Object.freeze([
  'spawnSurface', 'spawnLight', 'projectSilhouette', 'editHoles', 'setMovementMode', 'applyModifier',
]);
/** 스킬은 캐릭터당 동시에 하나(P4-BRIEF §4-1-D) */
export const SKILL_MAX_ACTIVE = 1;

/** 무기 계열 — 이름만. 실제 목록은 weapons/params.js 를 아는 main.js·테스트가 ctx.weaponFamilies 로 주입 */

/** 원시 구역(§2-3). 히트 구역·차폐·surfaceaudit 분류가 이 어휘를 쓴다 */
export const ZONES = Object.freeze(['head', 'torso', 'limb', 'shell', 'cloth', 'prop']);
/** 원시 종류 — 둥근원뿔·타원체(§2-3). 추가는 셰이더·히트·메시·래그돌이 함께 바뀌는 계약 변경 */
export const PRIM_KINDS = Object.freeze(['rc', 'el']);
/** 밴드 모드(§3-5) */
export const BAND_MODES = Object.freeze(['stripe', 'meoricho', 'geummun']);
/**
 * 감사 자세 이름 — 시각 리그 항목(결정 4 후보 `low_ready`, 발주자 확정 대기).
 * evalPose(단계 3b)가 이 이름을 모두 구현해야 한다. 이름을 늘리면 pose 와 함께 늘린다.
 */
export const AUDIT_POSES = Object.freeze(['low_ready']);
/** 외견 상태의 팀 표시 — 자기 진영 / 상대 진영(§2-2) */
export const APPEARANCE_TEAMS = Object.freeze(['self', 'opponent']);
/** 외견 참조의 자기 자신 표기 */
export const SELF = 'self';
/** 기본 외견 상태 이름 — 필수(§2-2) */
export const DEFAULT_STATE = 'default';
