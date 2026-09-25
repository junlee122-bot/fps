/**
 * src/audio/routes.js — 이벤트 → 소리 키 표 (판정 1-5 ~ 1-9, P4-BRIEF §4-9 확장 원칙).
 *
 * 오디오의 입구는 이 표 하나다. 새 이벤트가 어휘(ARCHITECTURE §3)에 들어오면 여기에 한 줄을
 * 더하는 것으로 기존 오클루전 · 우회 · 잔향 경로를 그대로 탄다 — 코드 추가 없음.
 *
 *   event  : 구독할 이벤트 (EVENT_VOCABULARY 안 — 밖이면 버스가 throw)
 *   sound  : payload → 소리 키 | null (null 이면 소리 없음)
 *   at     : payload → 월드 위치 | 'listener'(자기 몸에서 나는 소리 — 오클루전 없음)
 *   gainDb : payload → 추가 이득 (선택)
 *
 * P4C 예시(구현하지 않음 — TAB-B §3): 장독 깨짐은 surface:breach 가 이미 받는다(장독 표면의
 * audio 키만 있으면 된다). 장독 열기 · 변장 · 발소리 이벤트는 어휘에 없다 → 계약 작성자 판정 후 한 줄씩.
 * 흥부 변장 중 발소리는 **행위자의 실제 정체**로 키를 고른다(간파 단서, §4-1-C) — 외형 교체와 무관.
 */

import { SURFACES } from '../core/surfaces.js';
import { GUN_FAMILIES, INSTANCE_OVERRIDES } from './assets/manifest.js';

/** 무기 id → 계열. 계열 id 그대로이거나 개체 오버라이드에 적힌 계열 */
export function familyOf(weaponId) {
  if (GUN_FAMILIES[weaponId]) return weaponId;
  const o = INSTANCE_OVERRIDES[weaponId];
  if (o?.family && GUN_FAMILIES[o.family]) return o.family;
  throw new Error(`audio: weapon ${weaponId} has no gun family`); // PATCH-001-D
}

/** 표면 → 임팩트 소리 키. DECAL(audio:null)은 하부재 층이 따로 소리를 낸다 */
export function impactKeyOf(surfaceType) {
  const def = SURFACES[surfaceType];
  if (!def) throw new Error(`audio: unknown surface ${surfaceType}`);
  return def.audio ? `impact:${def.audio}` : null;
}

/** 입사 에너지(J) → 이득 dB. DMR 초구(3400 J) 0 dB, 10 J 에서 약 -25 dB */
export function energyGainDb(energy) {
  return 10 * Math.log10(Math.max(1e-3, energy) / 3400);
}

export const ROUTES = Object.freeze([
  { event: 'weapon:fire', sound: (e) => `gun:${familyOf(e.weaponId)}`, at: (e) => e.muzzleWorldPos },
  { event: 'audio:impact', sound: (e) => impactKeyOf(e.surfaceType), at: (e) => e.worldPos, gainDb: (e) => Math.max(-30, energyGainDb(e.energy) * 0.5) },
  { event: 'surface:breach', sound: (e) => impactKeyOf(e.surfaceType), at: (e) => e.worldPos, gainDb: () => 4 },
  { event: 'weapon:reload:begin', sound: () => 'mech:reload_begin', at: () => 'listener' },
  { event: 'weapon:reload:end', sound: () => 'mech:reload_end', at: () => 'listener' },
]);
