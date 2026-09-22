/**
 * test/audio.test.mjs — P4A 오디오 순수 로직 (브라우저 불필요).
 *
 * 렌더 신호 게이트(4축 · 해시)는 tools/audioaudit.mjs 가 Chromium 에서 본다. 여기서는
 * 그 게이트가 기대는 성질 — 차폐 표면 도출 · 체인 합성 · 매니페스트 · 잔향 유도 · 결정적 합성 ·
 * 이벤트 표 · 우회 인터페이스 · AudioSystem 배선 — 을 고정한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SURFACES, PenClass } from '../src/core/surfaces.js';
import { EVENT_VOCABULARY, bus } from '../src/core/events.js';
import { resetAllStreams } from '../src/core/rng.js';
import { WEAPONS } from '../src/weapons/params.js';
import {
  OCCLUSION_PROFILES, occluderSurfaces, isPassThrough, chainResponse, layerResponse, MAX_STAGES,
} from '../src/audio/occlusion.js';
import { GUN_FAMILIES, TARGET_RATE, PREPARE } from '../src/audio/assets/manifest.js';
import { probeSpace, buildImpulse, ABSORPTION } from '../src/audio/reverb.js';
import { impactBuffer, bodyIR, measureT60, IMPACT_SYNTH } from '../src/audio/synth.js';
import { ROUTES, familyOf, impactKeyOf } from '../src/audio/routes.js';
import { SOUNDS } from '../src/audio/sounds.js';
import { collectDetours, detourResponse, NO_GRAPH, DETOUR } from '../src/audio/propagation.js';
import { measureProfile, distinctAxes } from '../src/audio/measure.js';
import { boxRoomRaycast } from '../src/audio/render.js';
import { readWav } from '../src/audio/assets/_prepare.mjs';
import { AudioSystem } from '../src/audio/index.js';


test('차폐 표면: DECAL · 지면 판 제외, 나머지 전수에 프로파일, 통과 표면엔 프로파일 없음', () => {
  const occ = occluderSurfaces();
  for (const s of Object.keys(SURFACES)) {
    if (SURFACES[s].penClass === PenClass.DECAL) assert.ok(!occ.includes(s), `${s} DECAL 은 제외`);
  }
  assert.ok(!occ.includes('WATER') && !occ.includes('PACKED_DIRT'));
  assert.deepEqual(Object.keys(OCCLUSION_PROFILES).sort(), occ.slice().sort());
  assert.equal(occ.length, 11);
});

test('체인: 통과 표면은 무시, 감쇠·지연은 합산, 재방사는 마지막 벽', () => {
  const r = chainResponse([
    { surface: 'HANJI', thicknessCm: 0.03 }, { surface: 'DANCHEONG', thicknessCm: 0 },
    { surface: 'WOOD_PLANK', thicknessCm: 3 }, { surface: 'PACKED_DIRT', thicknessCm: 100 },
  ]);
  assert.deepEqual(r.surfaces, ['HANJI', 'WOOD_PLANK']);
  assert.equal(r.tlDb, OCCLUSION_PROFILES.HANJI.tlDb + OCCLUSION_PROFILES.WOOD_PLANK.tlDb);
  assert.equal(r.bodySurface, 'WOOD_PLANK');
  assert.equal(chainResponse([]).stages.length, 0);
  assert.throws(() => chainResponse([{ surface: 'NOPE', thicknessCm: 1 }]));
});

test('체인: 필터 단은 MAX_STAGES 로 유계, 감쇠는 전 층 합산', () => {
  const layers = Array.from({ length: 9 }, () => ({ surface: 'HANJI', thicknessCm: 0.03 }));
  const r = chainResponse(layers);
  assert.equal(r.stages.length, MAX_STAGES);
  assert.ok(Math.abs(r.tlDb - 9 * OCCLUSION_PROFILES.HANJI.tlDb) < 1e-9);
});

test('두께: 질량 법칙 — 2배 두께 +6 dB, 차단 주파수 하강', () => {
  const a = layerResponse('EARTH_WALL', 15), b = layerResponse('EARTH_WALL', 30);
  assert.ok(Math.abs(b.tlDb - a.tlDb - 6) < 1e-9);
  assert.ok(b.cutoffHz < a.cutoffHz);
});

test('매니페스트: 계열 = 무기 계열 id, 파일 전부 존재, 48 kHz · 16-bit · 모노 PCM', () => {
  assert.deepEqual(Object.keys(GUN_FAMILIES).sort(), Object.keys(WEAPONS).sort());
  for (const [fam, g] of Object.entries(GUN_FAMILIES)) {
    assert.ok(g.files.length >= 1, fam);
    for (const f of g.files) {
      assert.ok(f.startsWith('file:'), `${f} — new URL(…, import.meta.url) 리터럴`);
      const p = fileURLToPath(f);
      assert.ok(existsSync(p), p);
      const buf = readFileSync(p);
      assert.equal(buf.readUInt16LE(20), 1, `${f} PCM`);
      assert.equal(buf.readUInt16LE(22), 1, `${f} mono`);
      assert.equal(buf.readUInt32LE(24), TARGET_RATE, `${f} rate`);
      assert.equal(buf.readUInt16LE(34), 16, `${f} bits`);
      const { samples } = readWav(buf);
      assert.ok(samples.length > TARGET_RATE * 0.05 && samples.length < TARGET_RATE, `${f} 길이`);
    }
  }
  assert.ok(GUN_FAMILIES.DMR.substitute, 'DMR 대체 사실이 매니페스트에 적혀 있다');
  assert.equal(PREPARE.length, 3);
});

test('잔향: 프리셋 없이 공간에서 유도 — 큰 방이 작은 방보다 길다, 열린 공간은 건조', () => {
  const small = probeSpace([0, 1.5, 0], boxRoomRaycast([4, 3, 4]));
  const big = probeSpace([0, 1.5, 0], boxRoomRaycast([16, 6, 16]));
  assert.ok(big.rt60[1] > small.rt60[1] * 1.5, `${big.rt60[1]} vs ${small.rt60[1]}`);
  const soft = probeSpace([0, 1.5, 0], boxRoomRaycast([8, 3, 8], { floor: 'THATCH', ceil: 'THATCH', xNeg: 'FABRIC', xPos: 'FABRIC', zNeg: 'FABRIC', zPos: 'FABRIC' }));
  const hard = probeSpace([0, 1.5, 0], boxRoomRaycast([8, 3, 8], { floor: 'GRANITE', ceil: 'GRANITE', xNeg: 'GRANITE', xPos: 'GRANITE', zNeg: 'GRANITE', zPos: 'GRANITE' }));
  assert.ok(hard.rt60[1] > soft.rt60[1] * 3);
  const open = probeSpace([0, 1.5, 0], (o, d) => (d[1] < 0 ? { dist: 1.5 / -d[1], surface: 'PACKED_DIRT' } : null));
  assert.ok(open.rt60[1] < small.rt60[1] && open.wetRatio < small.wetRatio);
  for (const s of Object.keys(SURFACES)) if (SURFACES[s].penClass !== PenClass.DECAL) assert.ok(ABSORPTION[s], s);
});

test('결정성: 임펄스 · 합성은 같은 입력이면 비트 동일', () => {
  const sp = probeSpace([0, 1.5, 0], boxRoomRaycast());
  const [a] = buildImpulse(sp, TARGET_RATE, 'k'), [b] = buildImpulse(sp, TARGET_RATE, 'k');
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
  for (const key of Object.keys(IMPACT_SYNTH)) {
    assert.deepEqual(Buffer.from(impactBuffer(key, TARGET_RATE).buffer), Buffer.from(impactBuffer(key, TARGET_RATE).buffer), key);
  }
  const wm = OCCLUSION_PROFILES.WOOD_PLANK.modes;
  assert.deepEqual(Buffer.from(bodyIR(wm, 70, TARGET_RATE).buffer), Buffer.from(bodyIR(wm, 70, TARGET_RATE).buffer));
});

test('BRONZE 공명 T60 ≥ 3 s (§2-3), 일반 임팩트는 짧다', () => {
  assert.ok(measureT60(impactBuffer('bronze_resonate', TARGET_RATE), TARGET_RATE) >= 3);
  assert.ok(measureT60(impactBuffer('wood_thud', TARGET_RATE), TARGET_RATE) < 1);
});

test('이벤트 표: 어휘 안의 이벤트만, 모든 surfaces.js audio 키에 소리 정의', () => {
  for (const r of ROUTES) assert.ok(EVENT_VOCABULARY.includes(r.event), r.event);
  for (const s of Object.values(SURFACES)) {
    const k = impactKeyOf(s.id);
    if (s.audio) assert.ok(SOUNDS[k], k); else assert.equal(k, null);
  }
  for (const w of Object.keys(WEAPONS)) assert.ok(SOUNDS[`gun:${familyOf(w)}`]);
  assert.throws(() => familyOf('BOW'));
});

test('우회 인터페이스: 그래프 없으면 0개, 있으면 마지막 열린 곳에서 들리고 꺾임만큼 약하다', () => {
  assert.deepEqual(collectDetours(null, [0, 0, 0], [5, 0, 0]), []);
  assert.deepEqual(NO_GRAPH.findDetours(), []);
  const g = { findDetours: () => [
    { apparentPos: [2, 0, 0], pathLength: 12, turns: 2 },
    { apparentPos: [3, 0, 0], pathLength: 6, turns: 1 },
    { apparentPos: [4, 0, 0], pathLength: 30, turns: 3 },
  ] };
  const d = collectDetours(g, [0, 0, 0], [5, 0, 0]);
  assert.equal(d.length, DETOUR.maxDetours);
  assert.deepEqual(d[0].pos, [3, 0, 0]);
  assert.ok(d[0].gainDb > d[1].gainDb);
  const one = detourResponse({ apparentPos: [3, 0, 0], pathLength: 6, turns: 1 }, [5, 0, 0]);
  assert.equal(one.cutoffHz, DETOUR.cutoffHz / 2);
  assert.throws(() => detourResponse({ apparentPos: null, pathLength: 1 }, [0, 0, 0]));
});

test('측정 · 구별: 같은 신호는 0축, 감쇠만 다르면 1축, 지연 · 하한 아래 결합은 세지 않는다', () => {
  const n = TARGET_RATE, x = new Float32Array(n);
  for (let i = 0; i < 12000; i++) x[i] = Math.sin(i * 0.37) * Math.sin(i * 0.011) + (i === 0 ? 1 : 0);
  const y = x.map((v) => v * 0.5);
  const a = measureProfile(x, x, TARGET_RATE), b = measureProfile(x, y, TARGET_RATE);
  assert.deepEqual(distinctAxes(a, a), []);
  assert.deepEqual(distinctAxes(a, b), ['attenuationDb']);
  const base = { cutoffHz: 1000, attenuationDb: -10, couplingRatio: 0, delayMs: 1 };
  assert.deepEqual(distinctAxes(base, { ...base, delayMs: 9 }), [], '지연은 세지 않는다');
  assert.deepEqual(distinctAxes(base, { ...base, couplingRatio: 0.0024 }), [], '하한 아래 결합 차는 세지 않는다');
  assert.deepEqual(distinctAxes(base, { ...base, couplingRatio: 0.05 }), ['couplingRatio']);
});

/* ---- AudioSystem 배선 — 가짜 Web Audio 로 그래프 모양만 본다 ---- */
function fakeCtx() {
  const nodes = [];
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = (type, extra = {}) => {
    const n = { type, outs: [], connect(t) { this.outs.push(t); return t; }, ...extra };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: TARGET_RATE, currentTime: 0, destination: node('dest'), nodes,
    listener: { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() },
    createGain: () => node('gain', { gain: param(1) }),
    createDelay: () => node('delay', { delayTime: param() }),
    createBiquadFilter: () => node('biquad', { frequency: param(), Q: param(), gain: param() }),
    createConvolver: () => node('conv'),
    createPanner: () => node('panner', { positionX: param(), positionY: param(), positionZ: param() }),
    createBufferSource: () => node('src', { start() {}, stop() {} }),
    createBuffer: (ch, len) => ({ length: len, copyToChannel() {} }),
    decodeAudioData: async () => ({ sampleRate: TARGET_RATE }),
    resume: async () => {},
  };
  return ctx;
}

test('AudioSystem: 이벤트 → 소리, audio:occlusion 발행, 우회 음성, 중복 억제, reset', async () => {
  resetAllStreams();
  const clock = { frame: 0 };
  const occl = [];
  const off = bus.on('audio:occlusion', (e) => occl.push(e));
  const ctx = fakeCtx();
  const graph = { findDetours: () => [{ apparentPos: [1, 1.6, -2], pathLength: 9, turns: 1 }] };
  const audio = new AudioSystem({
    bus, clock, contextFactory: () => ctx,
    traceChain: () => [{ surface: 'EARTH_WALL', thicknessCm: 15 }],
    getListener: () => ({ pos: [0, 1.6, 0], forward: [0, 0, -1], up: [0, 1, 0] }),
  });
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  try {
    bus.emit('weapon:fire', { weaponId: 'DMR', muzzleWorldPos: [0, 1.6, -10], dir: [0, 0, -1], energy: 3400 }); // 시작 전 — 무시
    assert.equal(occl.length, 0);
    await audio.start();
    audio.setPropagationGraph(graph);
    bus.emit('weapon:fire', { weaponId: 'DMR', muzzleWorldPos: [0, 1.6, -10], dir: [0, 0, -1], energy: 3400 });
    assert.equal(occl.length, 1);
    assert.deepEqual(occl[0].surfaceChain, ['EARTH_WALL']);
    assert.equal(ctx.nodes.filter((n) => n.type === 'panner').length, 2, '직선 + 우회');
    bus.emit('weapon:fire', { weaponId: 'DMR', muzzleWorldPos: [0, 1.6, -10], dir: [0, 0, -1], energy: 3400 });
    assert.equal(audio.counters.deduped, 1, '같은 프레임 · 같은 자리 중복 억제');
    bus.emit('audio:impact', { surfaceType: 'DANCHEONG', worldPos: [0, 2, -5], energy: 100 }); // audio:null → 소리 없음
    assert.equal(audio.counters.played, 1);
    bus.emit('weapon:reload:begin', { weaponId: 'DMR', durationMs: 2000 }); // 청자 몸 — 오클루전 없음
    assert.equal(audio.counters.played, 2);
    assert.equal(occl.length, 1);
    audio.reset();
    assert.equal(audio.voices.size, 0);
    assert.equal(audio.counters.played, 0);
  } finally {
    off();
    delete globalThis.fetch;
  }
});
