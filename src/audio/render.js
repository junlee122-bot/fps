/**
 * src/audio/render.js — OfflineAudioContext 렌더 (audioaudit · 결정성 해시 전용, 브라우저에서 실행).
 *
 * 런타임과 **같은** graph.js 경로로 노드를 만든다 — 감사가 재는 것이 게임이 듣는 것이다.
 * 레이트는 48 kHz 고정(판정 1-10). 시간은 전부 명시 스케줄(렌더 시각 0 기준)이라 벽시계와 무관.
 */

import { resetAllStreams, rngStream } from '../core/rng.js';
import { OCCLUSION_PROFILES, chainResponse } from './occlusion.js';
import { connectOcclusion, playVoice, setListener, toBuffer, toStereoBuffer, SumChain } from './graph.js';
import { probeBuffer } from './synth.js';
import { BufferBank } from './buffers.js';
import { soundDef } from './sounds.js';
import { probeSpace, buildImpulse } from './reverb.js';
import { collectDetours } from './propagation.js';
import { TARGET_RATE } from './assets/manifest.js';

/**
 * 시험 음원을 표면 한 겹(refCm) 너머로 렌더. surface=null 이면 기준(차폐 없음).
 * @returns {Promise<Float32Array>}
 */
export async function renderProbe(surface, { profiles = OCCLUSION_PROFILES, seconds = 1.0 } = {}) {
  const ctx = new OfflineAudioContext(1, Math.round(seconds * TARGET_RATE), TARGET_RATE);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, probeBuffer(TARGET_RATE));
  const resp = surface
    ? chainResponse([{ surface, thicknessCm: profiles[surface].refCm }], profiles)
    : chainResponse([], profiles);
  connectOcclusion(ctx, src, resp).connect(ctx.destination);
  src.start(0);
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

/** 시험 공간 — 8×3×6 m 방(판벽 바닥 · 창호지 벽 · 흙벽 · 기와 천장). 순수 함수 레이캐스트 */
export function boxRoomRaycast(size = [8, 3, 6], walls = { floor: 'WOOD_PLANK', ceil: 'ROOF_TILE', xNeg: 'HANJI', xPos: 'EARTH_WALL', zNeg: 'HANJI', zPos: 'WOOD_PLANK' }) {
  const [W, H, D] = size;
  return (o, d, maxDist) => {
    let best = null;
    const test = (t, surface, normal) => { if (t > 1e-6 && t <= maxDist && (!best || t < best.dist)) best = { dist: t, surface, normal }; };
    if (d[1] < 0) test((0 - o[1]) / d[1], walls.floor, [0, 1, 0]);
    if (d[1] > 0) test((H - o[1]) / d[1], walls.ceil, [0, -1, 0]);
    if (d[0] < 0) test((-W / 2 - o[0]) / d[0], walls.xNeg, [1, 0, 0]);
    if (d[0] > 0) test((W / 2 - o[0]) / d[0], walls.xPos, [-1, 0, 0]);
    if (d[2] < 0) test((-D / 2 - o[2]) / d[2], walls.zNeg, [0, 0, 1]);
    if (d[2] > 0) test((D / 2 - o[2]) / d[2], walls.zPos, [0, 0, -1]);
    return best;
  };
}

/** 결정성 해시용 고정 시나리오 — 총성 3계열 · 범종 · 발소리 + 우회 · 공간 잔향 */
export const SCENARIO = Object.freeze([
  { t: 0.05, key: 'gun:DMR', pos: [0, 1.6, -12], layers: [{ surface: 'EARTH_WALL', thicknessCm: 15 }] },
  { t: 0.60, key: 'gun:SHOTGUN', pos: [5, 1.6, -6], layers: [{ surface: 'HANJI', thicknessCm: 0.03 }, { surface: 'HANJI', thicknessCm: 0.03 }] },
  { t: 1.00, key: 'impact:bronze_resonate', pos: [20, 1.1, -20], layers: [] },
  { t: 1.20, key: 'step:WOOD_PLANK', pos: [-3, 1.0, -4], layers: [{ surface: 'WOOD_PLANK', thicknessCm: 4.5 }],
    graph: { findDetours: () => [{ apparentPos: [-1, 1.6, -2], pathLength: 7, turns: 1 }] } },
  { t: 1.50, key: 'gun:CARBINE', pos: [0, 1.6, -8], layers: [{ surface: 'ROOF_SOIL', thicknessCm: 10 }] },
  { t: 1.80, key: 'mech:reload_begin', pos: null, layers: [] },
]);

/**
 * 시나리오 렌더 (스테레오, HRTF). 소재는 런타임과 같은 fetch + decodeAudioData 경로로 로드.
 * @returns {Promise<[Float32Array, Float32Array]>}
 */
export async function renderScenario({ seconds = 4.0, assetBase } = {}) {
  resetAllStreams();
  const ctx = new OfflineAudioContext(2, Math.round(seconds * TARGET_RATE), TARGET_RATE);
  const bank = new BufferBank(ctx);
  await bank.loadGuns(assetBase);
  const listener = { pos: [0, 1.6, 0], forward: [0, 0, -1], up: [0, 1, 0] };
  setListener(ctx, listener);
  // 합산점은 전부 SumChain — 노드당 입력 ≤ 2 (graph.js SumChain 주석)
  const master = new SumChain(ctx);
  const reverbIn = new SumChain(ctx);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  const room = probeSpace([0, 1.6, 0], boxRoomRaycast());
  conv.buffer = toStereoBuffer(ctx, buildImpulse(room, TARGET_RATE, 'scenario'));
  const rnd = rngStream('audio:take');
  for (const ev of SCENARIO) {
    playVoice(ctx, {
      buffer: bank.get(ev.key, rnd),
      def: soundDef(ev.key),
      pos: ev.pos,
      layers: ev.layers,
      detours: ev.pos ? collectDetours(ev.graph, ev.pos, listener.pos) : [],
      out: master,
      reverbSend: ev.pos ? reverbIn : null,
      when: ev.t,
    });
  }
  reverbIn.connect(conv);
  conv.connect(master.input());
  master.connect(ctx.destination);
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

export { chainResponse };
