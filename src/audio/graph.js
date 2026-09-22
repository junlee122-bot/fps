/**
 * src/audio/graph.js — Web Audio 노드 조립 (런타임 · 오프라인 공용).
 *
 * 같은 함수가 실시간 AudioContext 와 OfflineAudioContext 양쪽에 노드를 만든다 —
 * audioaudit 가 재는 그래프가 게임이 듣는 그래프다.
 *
 * 음성(voice) 하나의 경로:
 *
 *   src ─ gain(소리 이득) ─┬─ [직선] 지연(lag) ─ 단×N(LP·LP·dip) ─┬─ ×√(1−c)·g_tl ─────────┬─ panner(음원) ─┬─ out
 *                         │                                       └─ ×√c·g_tl ─ body IR ──┘               └─ reverbSend
 *                         └─ [우회]×K  gain ─ LP(회절) ─ panner(마지막 열린 곳) ─┬─ out
 *                                                                               └─ reverbSend
 */

import { bodyIR } from './synth.js';
import { chainResponse } from './occlusion.js';

/** Float32Array → AudioBuffer (모노) */
export function toBuffer(ctx, data) {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.copyToChannel(data, 0);
  return b;
}

const bodyCache = new WeakMap(); // ctx → Map(key → AudioBuffer)
function bodyBuffer(ctx, modes, bodyMs) {
  let m = bodyCache.get(ctx);
  if (!m) { m = new Map(); bodyCache.set(ctx, m); }
  const k = `${JSON.stringify(modes)}|${bodyMs}`;
  let b = m.get(k);
  if (!b) { b = toBuffer(ctx, bodyIR(modes, bodyMs, ctx.sampleRate)); m.set(k, b); }
  return b;
}

const dbToGain = (db) => 10 ** (db / 20);

/**
 * 결정적 합산 체인 — 오프라인 렌더 전용.
 * Chromium 은 한 노드로 들어오는 연결을 순서 없는 집합으로 합산한다. 입력이 3개 이상이면
 * 부동소수 덧셈의 결합 순서가 실행마다 달라져 해시가 흔들린다(실측: 우회 + 잔향 음성).
 * 그래서 합산점마다 GainNode 를 하나씩 이어 붙여 모든 노드의 입력을 2개 이하로 둔다
 * (a + b 는 교환법칙상 순서 무관). 실시간 경로는 해시 대상이 아니라 일반 GainNode 를 쓴다.
 */
export class SumChain {
  constructor(ctx) { this.ctx = ctx; this.tail = null; }
  /** 입력 하나를 받을 새 노드 */
  input() {
    const n = this.ctx.createGain();
    if (this.tail) this.tail.connect(n);
    this.tail = n;
    return n;
  }
  /** 모든 음성을 만든 뒤 1회 */
  connect(dest) { if (this.tail) this.tail.connect(dest); }
}

/** 합산점: AudioNode 그대로, 또는 SumChain(연결마다 새 입력 노드) */
const sinkOf = (s) => (s instanceof SumChain ? s.input() : s);

/**
 * 오클루전 경로 연결.
 * @param resp  occlusion.chainResponse() 결과
 * @returns 출력 노드 (투과음 + 재방사)
 */
export function connectOcclusion(ctx, input, resp) {
  const out = ctx.createGain();
  if (resp.stages.length === 0) { input.connect(out); return out; }
  let node = input;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = resp.lagMs / 1000;
  node.connect(delay); node = delay;
  for (const s of resp.stages) {
    for (let i = 0; i < 2; i++) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = s.cutoffHz; lp.Q.value = Math.SQRT1_2;
      node.connect(lp); node = lp;
    }
    if (s.dip) {
      const pk = ctx.createBiquadFilter();
      pk.type = 'peaking'; pk.frequency.value = s.dip.hz; pk.Q.value = 1.2; pk.gain.value = s.dip.db;
      node.connect(pk); node = pk;
    }
  }
  const g = dbToGain(-resp.tlDb);
  const dry = ctx.createGain();
  dry.gain.value = g * Math.sqrt(1 - resp.couple);
  node.connect(dry); dry.connect(out);
  if (resp.couple > 0) {
    const send = ctx.createGain();
    send.gain.value = g * Math.sqrt(resp.couple);
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = bodyBuffer(ctx, resp.bodyModes, resp.bodyMs);
    node.connect(send); send.connect(conv); conv.connect(out);
  }
  return out;
}

function makePanner(ctx, pos, d, model) {
  const p = ctx.createPanner();
  p.panningModel = model;
  p.distanceModel = 'inverse';
  p.refDistance = d.refDistance;
  p.rolloffFactor = d.rolloff;
  p.maxDistance = d.maxDistance;
  p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
  return p;
}

/**
 * 음성 하나를 만들고 when(ctx 시각)에 시작한다.
 * @param {object} v
 *   buffer, def(soundDef), gainDb, pos|null(null = 청자 몸 — 패너·오클루전 없음),
 *   layers(체인 층), detours(collectDetours 결과), out, reverbSend|null (AudioNode 또는 SumChain), panningModel
 * @returns {{source, resp}}
 */
export function playVoice(ctx, v) {
  const src = ctx.createBufferSource();
  src.buffer = v.buffer;
  const g = ctx.createGain();
  g.gain.value = dbToGain(v.def.gainDb + (v.gainDb ?? 0));
  src.connect(g);
  const model = v.panningModel ?? 'HRTF';
  let resp = null;
  if (!v.pos) {
    g.connect(sinkOf(v.out));
  } else {
    resp = chainResponse(v.layers ?? [], v.profiles);
    const occ = connectOcclusion(ctx, g, resp);
    const p = makePanner(ctx, v.pos, v.def, model);
    occ.connect(p); p.connect(sinkOf(v.out));
    if (v.reverbSend) p.connect(sinkOf(v.reverbSend));
    for (const d of v.detours ?? []) {
      const dg = ctx.createGain();
      dg.gain.value = dbToGain(d.gainDb);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = d.cutoffHz; lp.Q.value = Math.SQRT1_2;
      const dp = makePanner(ctx, d.pos, v.def, model);
      g.connect(dg); dg.connect(lp); lp.connect(dp); dp.connect(sinkOf(v.out));
      if (v.reverbSend) dp.connect(sinkOf(v.reverbSend));
    }
  }
  src.start(v.when ?? 0);
  return { source: src, resp };
}

/** 청자 자세 설정 */
export function setListener(ctx, pose) {
  const L = ctx.listener;
  const [px, py, pz] = pose.pos, [fx, fy, fz] = pose.forward, [ux, uy, uz] = pose.up ?? [0, 1, 0];
  if (L.positionX) {
    L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
    L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
    L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
  } else {
    L.setPosition(px, py, pz);
    L.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}

/** 스테레오 임펄스(Float32Array ×2) → AudioBuffer */
export function toStereoBuffer(ctx, [L, R]) {
  const b = ctx.createBuffer(2, L.length, ctx.sampleRate);
  b.copyToChannel(L, 0); b.copyToChannel(R, 1);
  return b;
}
