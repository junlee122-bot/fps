/**
 * src/audio/buffers.js — 소리 키 → AudioBuffer (소재 로드 · 합성 캐시).
 *
 * 녹음 소재(WAV)는 매니페스트 경로 그대로 fetch → decodeAudioData. 파일과 컨텍스트가 모두
 * 48 kHz 라 리샘플이 없다(판정 1-10). 합성 소리는 처음 요청 때 한 번 만든다.
 */

import { GUN_FAMILIES, TARGET_RATE } from './assets/manifest.js';
import { impactBuffer, footstepBuffer, mechBuffer, probeBuffer } from './synth.js';
import { toBuffer } from './graph.js';
import { soundDef } from './sounds.js';

export class BufferBank {
  constructor(ctx) {
    if (ctx.sampleRate !== TARGET_RATE) throw new Error(`audio: context rate ${ctx.sampleRate} ≠ ${TARGET_RATE}`);
    this.ctx = ctx;
    this.synth = new Map();
    this.guns = new Map(); // family → AudioBuffer[]
  }

  /** 매니페스트 소재 전부 로드. 누락 · 레이트 불일치는 throw (조용한 대체 금지) */
  async loadGuns(baseUrl = new URL('./assets/', import.meta.url)) {
    for (const [fam, g] of Object.entries(GUN_FAMILIES)) {
      const takes = [];
      for (const f of g.files) {
        const res = await fetch(new URL(f, baseUrl));
        if (!res.ok) throw new Error(`audio: asset ${f} → HTTP ${res.status}`);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        if (buf.sampleRate !== TARGET_RATE) throw new Error(`audio: asset ${f} decoded at ${buf.sampleRate}`);
        takes.push(buf);
      }
      this.guns.set(fam, takes);
    }
  }

  /** 소재를 직접 주입 (오프라인 렌더 · 테스트 — 디코딩 없이 PCM) */
  setGunTakes(family, takes) {
    this.guns.set(family, takes.map((t) => (t instanceof Float32Array ? toBuffer(this.ctx, t) : t)));
  }

  /**
   * @param {string} key  소리 키
   * @param {() => number} rnd  테이크 선택 난수 (rngStream)
   */
  get(key, rnd) {
    const d = soundDef(key);
    if (d.kind === 'gun') {
      const takes = this.guns.get(d.family);
      if (!takes?.length) throw new Error(`audio: gun family ${d.family} not loaded`);
      return takes[Math.floor(rnd() * takes.length) % takes.length];
    }
    let b = this.synth.get(key);
    if (!b) {
      const r = this.ctx.sampleRate;
      const data = d.kind === 'impact' ? impactBuffer(d.key, r)
        : d.kind === 'step' ? footstepBuffer(d.floor, r)
        : d.kind === 'mech' ? mechBuffer(d.key, r)
        : d.kind === 'probe' ? probeBuffer(r)
        : null;
      if (!data) throw new Error(`audio: no buffer source for ${key} (${d.kind})`);
      b = toBuffer(this.ctx, data);
      this.synth.set(key, b);
    }
    return b;
  }
}
