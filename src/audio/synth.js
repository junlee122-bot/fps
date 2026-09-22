/**
 * src/audio/synth.js — 절차 합성 소리 (P4-BRIEF §2-1 "소재가 도착하기 전에는 합성").
 *
 * 전부 순수 JS(Float32Array)로 생성한다 — Web Audio 노드의 구현 차이와 무관하게 비트 동일.
 * 난수는 이름 붙은 시드(전역 시드 ^ FNV(이름))로 매번 새로 만든다: 생성 순서·캐시 적중과 무관하게
 * 같은 이름이면 같은 버퍼다. Math.random 금지(HARNESS §2-2).
 *
 * 소재(녹음)가 오면 sounds.js 의 해당 항목만 kind:'sample' 로 바뀐다 — 이 파일은 그대로다.
 */

import { mulberry32, getGlobalSeed } from '../core/rng.js';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** 이름 고정 시드 난수 — 호출할 때마다 같은 수열의 처음부터 */
export function seeded(name) {
  return mulberry32((getGlobalSeed() ^ fnv1a(`audio:${name}`)) >>> 0);
}

const T60K = Math.log(1000); // -60 dB 감쇠 상수

/** 감쇠 사인 합 + 대역 제한 노이즈 */
function modal(rate, durS, modes, noise, name) {
  const n = Math.max(1, Math.round(durS * rate));
  const out = new Float32Array(n);
  const rnd = seeded(name);
  for (const [hz, t60, amp] of modes) {
    const w = (2 * Math.PI * hz) / rate, k = T60K / (t60 * rate);
    const ph = rnd() * 2 * Math.PI;
    for (let i = 0; i < n; i++) out[i] += amp * Math.exp(-k * i) * Math.sin(w * i + ph);
  }
  if (noise) {
    const { amp, t60, lpHz, hpHz = 20 } = noise;
    const k = T60K / (t60 * rate);
    const aL = Math.exp((-2 * Math.PI * lpHz) / rate), aH = Math.exp((-2 * Math.PI * hpHz) / rate);
    let lp = 0, hpIn = 0, hp = 0;
    for (let i = 0; i < n; i++) {
      const x = rnd() * 2 - 1;
      lp = (1 - aL) * x + aL * lp;
      hp = aH * (hp + lp - hpIn); hpIn = lp;
      out[i] += amp * Math.exp(-k * i) * hp;
    }
  }
  // 1 ms 어택 램프 — 클릭 방지
  const att = Math.min(n, Math.round(rate * 0.001));
  for (let i = 0; i < att; i++) out[i] *= i / att;
  return normalize(out, 0.9);
}

function normalize(buf, peak) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) { const g = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

/**
 * 임팩트 프로파일 — surfaces.js `audio` 키 전수.
 * modes: [Hz, T60(s), 진폭] · noise: 대역 노이즈 버스트
 */
export const IMPACT_SYNTH = Object.freeze({
  paper_rupture:    { dur: 0.18, modes: [], noise: { amp: 1, t60: 0.08, lpHz: 9000, hpHz: 1500 } },
  wood_crack_light: { dur: 0.25, modes: [[1450, 0.10, 0.5], [2300, 0.06, 0.3]], noise: { amp: 0.8, t60: 0.06, lpHz: 6000, hpHz: 600 } },
  wood_thud:        { dur: 0.35, modes: [[310, 0.18, 0.8], [720, 0.12, 0.4]], noise: { amp: 0.5, t60: 0.05, lpHz: 3000, hpHz: 150 } },
  wood_deep:        { dur: 0.45, modes: [[170, 0.30, 0.9], [410, 0.20, 0.4]], noise: { amp: 0.35, t60: 0.05, lpHz: 2000, hpHz: 80 } },
  muffled_thud:     { dur: 0.30, modes: [[95, 0.15, 0.7]], noise: { amp: 0.8, t60: 0.08, lpHz: 900, hpHz: 60 } },
  ceramic_crack:    { dur: 0.40, modes: [[2100, 0.12, 0.5], [3350, 0.09, 0.4], [4900, 0.07, 0.3]], noise: { amp: 0.7, t60: 0.10, lpHz: 10000, hpHz: 1200 } },
  stone_sharp:      { dur: 0.25, modes: [[3100, 0.04, 0.4]], noise: { amp: 1, t60: 0.04, lpHz: 12000, hpHz: 2000 } },
  cloth_soft:       { dur: 0.15, modes: [], noise: { amp: 1, t60: 0.05, lpHz: 2500, hpHz: 200 } },
  straw_rustle:     { dur: 0.35, modes: [], noise: { amp: 1, t60: 0.20, lpHz: 7000, hpHz: 900 } },
  // §2-3: 감쇠 3 s 이상 — 범종 부분음 비(험·프라임·티어스·퀸트·노미널…). 짧게 줄이지 마라.
  bronze_resonate:  { dur: 9.0, modes: [[112, 8.0, 0.8], [224, 6.5, 0.7], [265, 5.0, 0.45], [337, 4.2, 0.35], [448, 3.6, 0.5], [566, 2.8, 0.25], [745, 2.0, 0.2], [1010, 1.2, 0.12]], noise: { amp: 0.3, t60: 0.04, lpHz: 8000, hpHz: 1500 } },
  water_impact:     { dur: 0.40, modes: [[850, 0.08, 0.3]], noise: { amp: 1, t60: 0.22, lpHz: 5000, hpHz: 300 } },
  dirt_dull:        { dur: 0.20, modes: [[140, 0.06, 0.4]], noise: { amp: 1, t60: 0.06, lpHz: 1800, hpHz: 100 } },
  soil_dull:        { dur: 0.25, modes: [[210, 0.05, 0.3]], noise: { amp: 1, t60: 0.10, lpHz: 2600, hpHz: 250 } },
});

export function impactBuffer(key, rate) {
  const p = IMPACT_SYNTH[key];
  if (!p) throw new Error(`audio synth: no impact profile ${key}`);
  return modal(rate, p.dur, p.modes, p.noise, `impact:${key}`);
}

/** 발소리 — 딛는 바닥 표면별 (테스트 이미터 · P4B 액터가 같은 키를 쓴다) */
export const FOOTSTEP_SYNTH = Object.freeze({
  WOOD_PLANK:  { dur: 0.22, modes: [[190, 0.12, 0.8], [520, 0.07, 0.3]], noise: { amp: 0.5, t60: 0.04, lpHz: 3500, hpHz: 120 } },
  PACKED_DIRT: { dur: 0.20, modes: [[90, 0.05, 0.5]], noise: { amp: 1, t60: 0.07, lpHz: 1600, hpHz: 60 } },
  GRANITE:     { dur: 0.16, modes: [[1200, 0.03, 0.2]], noise: { amp: 1, t60: 0.03, lpHz: 9000, hpHz: 700 } },
  THATCH:      { dur: 0.25, modes: [], noise: { amp: 1, t60: 0.12, lpHz: 6000, hpHz: 700 } },
  ROOF_TILE:   { dur: 0.22, modes: [[1900, 0.06, 0.4], [2900, 0.05, 0.3]], noise: { amp: 0.8, t60: 0.05, lpHz: 9000, hpHz: 900 } },
});

export function footstepBuffer(floor, rate) {
  const p = FOOTSTEP_SYNTH[floor] ?? FOOTSTEP_SYNTH.PACKED_DIRT;
  return modal(rate, p.dur, p.modes, p.noise, `step:${floor}`);
}

/** 기계음 층 — 1단계 소재에 없어 합성(판정 2). 움직이는 부품(§4-8)이 오면 소재로 교체 */
export const MECH_SYNTH = Object.freeze({
  reload_begin: { dur: 0.30, clicks: [[0.00, 2600, 1.0], [0.12, 1700, 0.7]] },
  reload_end:   { dur: 0.40, clicks: [[0.00, 1900, 0.8], [0.18, 3200, 1.0], [0.24, 2400, 0.6]] },
});

export function mechBuffer(key, rate) {
  const p = MECH_SYNTH[key];
  if (!p) throw new Error(`audio synth: no mech profile ${key}`);
  const n = Math.round(p.dur * rate), out = new Float32Array(n);
  p.clicks.forEach(([t, hz, amp], i) => {
    const c = modal(rate, 0.06, [[hz, 0.03, 0.6], [hz * 1.73, 0.02, 0.3]], { amp: 1, t60: 0.012, lpHz: 12000, hpHz: 1500 }, `mech:${key}:${i}`);
    const o = Math.round(t * rate);
    for (let j = 0; j < c.length && o + j < n; j++) out[o + j] += amp * c[j];
  });
  return normalize(out, 0.9);
}

/**
 * 오클루전 측정용 시험 음원 — 핑크 경향 노이즈 버스트(250 ms) + 선두 임펄스.
 * 임펄스는 광대역 위상 기준, 노이즈는 스펙트럼·감쇠·군지연 축의 에너지.
 */
export function probeBuffer(rate) {
  const n = Math.round(0.25 * rate), out = new Float32Array(n);
  const rnd = seeded('probe');
  // Paul Kellet 핑크 필터
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
  }
  const fade = Math.round(0.005 * rate);
  for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[n - 1 - i] *= i / fade; }
  out[0] = 0.9;
  return out;
}

/**
 * 벽체 재방사 울림(body IR) — 프로파일의 고유 모드 + 감쇠 노이즈. 잔향 결합 축의 소리.
 * 시드도 모드 · 감쇠 값에서 만든다: 같은 프로파일이면 표면 이름과 무관하게 같은 울림.
 * 에너지 1로 정규화(결합 비율이 곧 재방사 에너지 비가 되게).
 */
export function bodyIR(modes, bodyMs, rate) {
  const t60 = Math.max(0.005, bodyMs / 1000);
  const m = (modes?.length ? modes : [[300, 1]]).map(([hz, a]) => [hz, t60, a]);
  const buf = modal(rate, Math.min(10, t60 * 1.2), m, { amp: 0.4, t60: t60 * 0.5, lpHz: 4000, hpHz: 60 }, `body:${JSON.stringify(modes)}:${bodyMs}`);
  let e = 0; for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
  const g = 1 / Math.sqrt(e || 1);
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** 단순 T60 측정 (슈뢰더 역적분, -5 → -25 dB 기울기 외삽) — 감사·테스트 공용 */
export function measureT60(buf, rate) {
  const n = buf.length, edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += buf[i] * buf[i]; edc[i] = acc; }
  const total = edc[0] || 1;
  const db = (i) => 10 * Math.log10(edc[i] / total + 1e-30);
  let i5 = -1, i25 = -1;
  for (let i = 0; i < n; i++) { if (i5 < 0 && db(i) <= -5) i5 = i; if (db(i) <= -25) { i25 = i; break; } }
  if (i5 < 0 || i25 < 0) return Infinity;
  return ((i25 - i5) / rate) * 3; // 20 dB 구간 × 3 = 60 dB
}
