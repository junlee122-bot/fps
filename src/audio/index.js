/**
 * src/audio/index.js — AudioSystem (P4A).
 *
 * 서브시스템 간 직접 import 금지(ARCHITECTURE §3) — physics · 카메라는 **주입**받는다
 * (fx 의 debris 콜백과 같은 패턴, 판정 1-5). main.js 배선은 병합 시 A 탭 몫이다:
 *
 *   const audio = new AudioSystem({
 *     bus, clock,
 *     traceChain: (from, to) => { … collectRayChain(physics.static, …, dist, MASK.BULLET).layers },
 *     raycast: (origin, dir, maxDist) => 첫 비-DECAL 층 { dist, surface, normal } | null,
 *     getListener: () => ({ pos, forward, up }),       // 카메라
 *   });
 *   // 첫 사용자 입력(포인터 락)에서: audio.start()
 *   // 프레임마다: audio.update()
 *   // resetState 경로: audio.reset()
 *
 * 구독은 생성자에서 한다 — bus.markBoot() 이전이라 resetToBoot 가 걷어내지 않는다.
 * 컨텍스트가 시작되기 전 이벤트는 조용히 버린다(소리를 낼 장치가 없음 — 상태 변화 없음).
 *
 * 결정성: 테이크 선택은 rngStream('audio:take'), 합성·임펄스는 이름 고정 시드. 시간은
 * clock(중복 억제 프레임)과 오디오 장치 시각(재생 스케줄)뿐 — performance.now 를 읽지 않는다.
 * 비트 동일 검증은 오프라인 렌더(render.js)가 맡는다: 실시간 재생 타이밍은 장치 소관이다.
 */

import { rngStream } from '../core/rng.js';
import { ROUTES } from './routes.js';
import { soundDef } from './sounds.js';
import { BufferBank } from './buffers.js';
import { playVoice, setListener, toStereoBuffer } from './graph.js';
import { probeSpace, buildImpulse } from './reverb.js';
import { collectDetours, NO_GRAPH } from './propagation.js';
import { TARGET_RATE } from './assets/manifest.js';

/** 동시 음성 상한 — 산탄 9펠릿 × 다층 임팩트 폭주 방지 */
export const MAX_VOICES = 32;
/** 청자가 이만큼(m) 움직이면 공간을 다시 잰다 */
export const REVERB_MOVE_M = 1.5;
/** 잔향 교체 크로스페이드 (s) */
const REVERB_XFADE_S = 0.25;

export class AudioSystem {
  constructor({ bus, clock, traceChain, raycast, getListener, contextFactory } = {}) {
    if (!bus || !clock) throw new Error('AudioSystem: bus · clock 필요');
    this.bus = bus;
    this.clock = clock;
    this.traceChain = traceChain ?? (() => []);
    this.raycast = raycast ?? (() => null);
    this.getListener = getListener ?? (() => ({ pos: [0, 1.6, 0], forward: [0, 0, -1], up: [0, 1, 0] }));
    this.contextFactory = contextFactory ?? (() => new AudioContext({ sampleRate: TARGET_RATE, latencyHint: 'interactive' }));
    this.graph = NO_GRAPH;
    this.ctx = null;
    this.voices = new Set();
    this.counters = { played: 0, dropped: 0, deduped: 0 };
    this._dedupe = new Set();
    this._dedupeFrame = -1;
    this._reverbAt = null;
    for (const r of ROUTES) bus.on(r.event, (e) => this._route(r, e));
  }

  /** 첫 사용자 제스처에서 호출 (브라우저 자동재생 정책) */
  async start() {
    if (this.ctx) { await this.ctx.resume?.(); return; }
    const ctx = this.contextFactory();
    this.ctx = ctx;
    this.bank = new BufferBank(ctx);
    await this.bank.loadGuns();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.reverbIn = ctx.createGain();
    this.reverbSlots = [0, 1].map(() => {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const g = ctx.createGain();
      g.gain.value = 0;
      this.reverbIn.connect(conv); conv.connect(g); g.connect(this.master);
      return { conv, g };
    });
    this.reverbActive = 0;
    await ctx.resume?.();
  }

  /** P4B 공간 그래프 연결 (§2-2 두 번째 경로). null 이면 직선 경로만 */
  setPropagationGraph(graph) {
    this.graph = graph ?? NO_GRAPH;
  }

  /** 프레임마다 — 청자 자세, 필요하면 공간 재측정 */
  update() {
    if (!this.ctx) return;
    const pose = this.getListener();
    setListener(this.ctx, pose);
    const p = pose.pos;
    if (!this._reverbAt || Math.hypot(p[0] - this._reverbAt[0], p[1] - this._reverbAt[1], p[2] - this._reverbAt[2]) > REVERB_MOVE_M) {
      this._rebuildReverb(p);
    }
  }

  _rebuildReverb(pos) {
    this._reverbAt = pos.slice();
    const space = probeSpace(pos, this.raycast);
    const key = pos.map((v) => Math.round(v / REVERB_MOVE_M)).join(',');
    const ir = toStereoBuffer(this.ctx, buildImpulse(space, this.ctx.sampleRate, key));
    const t = this.ctx.currentTime;
    const next = 1 - this.reverbActive;
    const a = this.reverbSlots[this.reverbActive], b = this.reverbSlots[next];
    b.conv.buffer = ir;
    a.g.gain.setValueAtTime(a.g.gain.value, t); a.g.gain.linearRampToValueAtTime(0, t + REVERB_XFADE_S);
    b.g.gain.setValueAtTime(0, t); b.g.gain.linearRampToValueAtTime(1, t + REVERB_XFADE_S);
    this.reverbActive = next;
    this.space = space;
  }

  _route(r, e) {
    if (!this.ctx) return;
    const key = r.sound(e);
    if (!key) return;
    const at = r.at(e);
    this.play(key, at === 'listener' ? null : at, r.gainDb ? r.gainDb(e) : 0);
  }

  /**
   * 소리 하나 재생 — 이벤트 경로와 테스트 이미터의 공용 입구.
   * @param {string} key  sounds.js 키
   * @param {[number,number,number]|null} pos  null = 청자 몸
   */
  play(key, pos, gainDb = 0) {
    if (!this.ctx) return null;
    soundDef(key); // 미등록 키는 throw
    if (this.clock.frame !== this._dedupeFrame) { this._dedupe.clear(); this._dedupeFrame = this.clock.frame; }
    const dk = pos ? `${key}|${pos.map((v) => Math.round(v * 2)).join(',')}` : key;
    if (this._dedupe.has(dk)) { this.counters.deduped++; return null; }
    this._dedupe.add(dk);
    if (this.voices.size >= MAX_VOICES) { this.counters.dropped++; return null; }

    const listener = this.getListener();
    let layers = [], detours = [];
    if (pos) {
      layers = this.traceChain(pos, listener.pos);
      detours = collectDetours(this.graph, pos, listener.pos);
      this.bus.emit('audio:occlusion', {
        listenerPos: listener.pos.slice(),
        sourcePos: pos.slice(),
        surfaceChain: layers.map((L) => L.surface),
      });
    }
    const v = playVoice(this.ctx, {
      buffer: this.bank.get(key, rngStream('audio:take')),
      def: soundDef(key),
      gainDb,
      pos,
      layers,
      detours,
      out: this.master,
      reverbSend: pos ? this.reverbIn : null,
      when: 0,
    });
    this.voices.add(v.source);
    v.source.onended = () => this.voices.delete(v.source);
    this.counters.played++;
    return v;
  }

  /** resetState 경로 — 울리는 소리를 끊고 공간 측정을 다시 하게 한다 */
  reset() {
    for (const s of this.voices) { try { s.stop(); } catch { /* 이미 끝남 */ } }
    this.voices.clear();
    this._dedupe.clear();
    this._dedupeFrame = -1;
    this._reverbAt = null;
    this.counters = { played: 0, dropped: 0, deduped: 0 };
  }
}

export { OCCLUSION_PROFILES, occluderSurfaces, chainResponse, GROUND_PLANE_SURFACES } from './occlusion.js';
