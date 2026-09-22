#!/usr/bin/env node
/**
 * src/audio/assets/_prepare.mjs — 녹음 소재 전처리 (P4-BRIEF §2-1 · TAB-B 판정 1-9).
 *
 * 런타임은 이 파일을 import하지 않는다. 소재를 교체할 때 한 번 돌리는 도구다.
 * (tools/ 는 이 탭의 쓰기 범위가 audioaudit.mjs 하나라 src/audio 아래에 둔다.)
 *
 *   node src/audio/assets/_prepare.mjs <Prepared SFX Library 디렉터리>
 *
 * 처리 (파일당, manifest.js 의 PREPARE 표를 그대로 따른다):
 *  1. WAV(PCM 16/24-bit) 읽기 → 스테레오 합산 모노
 *  2. 테이크 분할: 피크 대비 -20 dB 를 넘는 온셋, 불응기 300 ms
 *  3. 테이크마다 온셋 -5 ms 부터 엔벨로프가 피크 대비 TAIL_DB 아래로 내려간 지점까지 자르고
 *     20 ms 코사인 페이드 — 꼬리(녹음 공간)는 버린다. 잔향은 §2-4가 붙인다
 *  4. 96 kHz → 48 kHz: 윈도우드 싱크 FIR(127탭, 블랙먼) 후 2:1 데시메이션.
 *     브라우저 리샘플러를 거치지 않게 렌더 컨텍스트 레이트(48 kHz)로 저장 (판정 1-10)
 *  5. 피크 -1 dBFS 정규화 → 16-bit PCM 모노 WAV. 디더 없음(반올림) — 결정적
 *
 * 계열 간 음량 균형은 파일이 아니라 manifest 의 gainDb(데이터)가 맡는다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PREPARE, TARGET_RATE } from './manifest.js';

const TAIL_DB = -40;
const ONSET_DB = -20;
const REFRACTORY_S = 0.3;
const PRE_S = 0.005;
const FADE_S = 0.02;
const MAX_TAKE_S = 0.9;
const PEAK_DBFS = -1;

export function readWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = tag(off), size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') fmt = { ch: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    else if (id === 'data') data = { off: off + 8, size };
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV missing fmt/data');
  const bps = fmt.bits / 8, frames = Math.floor(data.size / (bps * fmt.ch));
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const p = data.off + (i * fmt.ch + c) * bps;
      let v;
      if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) { let x = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
      else throw new Error(`unsupported bits ${fmt.bits}`);
      acc += v;
    }
    mono[i] = acc / fmt.ch;
  }
  return { rate: fmt.rate, samples: mono };
}

export function writeWav16(samples, rate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

/** 2:1 데시메이션 — 윈도우드 싱크 저역통과(fc = 0.45 · 출력 나이퀴스트) */
function decimate2(x) {
  const TAPS = 127, M = (TAPS - 1) / 2, fc = 0.45 * 0.5; // 입력 레이트 대비 정규화
  const h = new Float64Array(TAPS);
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const k = i - M;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (TAPS - 1));
    h[i] = sinc * w; sum += h[i];
  }
  for (let i = 0; i < TAPS; i++) h[i] /= sum;
  const out = new Float64Array(Math.floor(x.length / 2));
  for (let o = 0; o < out.length; o++) {
    const c = o * 2;
    let acc = 0;
    for (let i = 0; i < TAPS; i++) { const j = c + i - M; if (j >= 0 && j < x.length) acc += x[j] * h[i]; }
    out[o] = acc;
  }
  return out;
}

/** 10 ms 창 피크 엔벨로프 */
function envelope(x, rate) {
  const hop = Math.round(rate * 0.01), env = new Float64Array(Math.floor(x.length / hop));
  for (let w = 0; w < env.length; w++) { let m = 0; for (let i = w * hop; i < (w + 1) * hop; i++) m = Math.max(m, Math.abs(x[i])); env[w] = m; }
  return { env, hop };
}

export function sliceTakes(x, rate) {
  const { env, hop } = envelope(x, rate);
  let peak = 0; for (const v of env) peak = Math.max(peak, v);
  const onTh = peak * 10 ** (ONSET_DB / 20);
  const takes = [];
  let w = 1;
  while (w < env.length) {
    if (env[w] > onTh && env[w - 1] <= onTh) {
      // 테이크 자기 피크 기준으로 꼬리 판정
      let tp = 0, tw = w;
      for (let k = w; k < Math.min(env.length, w + 10); k++) if (env[k] > tp) { tp = env[k]; tw = k; }
      const tailTh = tp * 10 ** (TAIL_DB / 20);
      let end = tw;
      while (end < env.length && env[end] > tailTh) end++;
      const s0 = Math.max(0, w * hop - Math.round(PRE_S * rate));
      const s1 = Math.min(x.length, Math.min(end * hop, s0 + Math.round(MAX_TAKE_S * rate)));
      takes.push([s0, s1]);
      w = Math.max(end, w + Math.round(REFRACTORY_S * 100));
    } else w++;
  }
  return takes;
}

function finishTake(seg, rate) {
  const fade = Math.round(FADE_S * rate), n = seg.length;
  const out = Float64Array.from(seg);
  for (let i = 0; i < fade && i < n; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  const g = 10 ** (PEAK_DBFS / 20) / pk;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lib = process.argv[2];
  if (!lib) { console.error('usage: node src/audio/assets/_prepare.mjs <Prepared SFX Library dir>'); process.exit(2); }
  const outDir = resolve(import.meta.dirname, 'gun');
  mkdirSync(outDir, { recursive: true });
  for (const p of PREPARE) {
    const { rate, samples } = readWav(readFileSync(join(lib, p.sourceDir, p.sourceFile)));
    if (rate !== TARGET_RATE * 2) throw new Error(`${p.sourceFile}: ${rate} Hz — 2:1 경로는 ${TARGET_RATE * 2} Hz 입력 전제`);
    const ranges = sliceTakes(samples, rate);
    const use = p.takes.map((i) => { if (!ranges[i]) throw new Error(`${p.sourceFile}: take ${i} 없음 (${ranges.length}개)`); return ranges[i]; });
    use.forEach(([a, b], k) => {
      const y = finishTake(decimate2(samples.subarray(a, b)), TARGET_RATE);
      const name = `${p.out}_${k}.wav`;
      writeFileSync(join(outDir, name), writeWav16(y, TARGET_RATE));
      console.log(`${name}  ${p.sourceFile} take ${p.takes[k]}  ${(y.length / TARGET_RATE).toFixed(3)} s`);
    });
  }
}
