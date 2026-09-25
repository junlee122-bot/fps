/**
 * src/audio/sounds.js — 소리 정의 표 (데이터).
 *
 * 소리 키 → 소재 종류 · 음량 · 거리 감쇠. 소재가 합성이든 녹음이든 재생 경로(오클루전 ·
 * 우회 · 잔향)는 같다 — §2-1 "오클루전 · 잔향 · 전파는 항상 우리 처리".
 *
 * 새 소리(P4C 장독 열기 · 깨짐, 변장 소리 등)는 여기에 한 줄 + routes.js 에 한 줄이다.
 * 장독 깨짐처럼 녹음 소재가 오면 kind 를 'sample' 로 두고 files 를 적는다.
 */

import { GUN_FAMILIES } from './assets/manifest.js';
import { IMPACT_SYNTH, FOOTSTEP_SYNTH, MECH_SYNTH } from './synth.js';

/**
 * kind: 'gun'(manifest 계열) | 'impact' | 'step' | 'mech' | 'probe' | 'sample'(files)
 * refDistance · rolloff · maxDistance : PannerNode 'inverse' 거리 모델
 */
function def(kind, extra) {
  return Object.freeze({ gainDb: 0, refDistance: 2, rolloff: 1, maxDistance: 300, ...extra, kind });
}

const table = {};
for (const fam of Object.keys(GUN_FAMILIES)) table[`gun:${fam}`] = def('gun', { family: fam, refDistance: 6, rolloff: 0.8, maxDistance: 600 });
for (const key of Object.keys(IMPACT_SYNTH)) table[`impact:${key}`] = def('impact', { key, gainDb: -8 });
// §2-3: 범종은 경내 전체가 듣는다 — 거리 감쇠를 완만하게. 짧게 줄이지 마라
table['impact:bronze_resonate'] = def('impact', { key: 'bronze_resonate', gainDb: 0, refDistance: 20, rolloff: 0.4, maxDistance: 1000 });
for (const floor of Object.keys(FOOTSTEP_SYNTH)) table[`step:${floor}`] = def('step', { floor, gainDb: -10, refDistance: 1.5 });
for (const key of Object.keys(MECH_SYNTH)) table[`mech:${key}`] = def('mech', { key, gainDb: -12, refDistance: 1 });
table.probe = def('probe', { refDistance: 1 });

export const SOUNDS = Object.freeze(table);

export function soundDef(key) {
  const d = SOUNDS[key];
  if (!d) throw new Error(`audio: unknown sound key ${key}`); // PATCH-001-D
  return d;
}
