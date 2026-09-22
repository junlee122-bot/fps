/**
 * src/audio/assets/_listen.mjs — 청감 확인용 렌더 (런타임 미사용). 소리 하나를 각 차폐 표면 한 겹 너머로.
 *   node src/audio/assets/_listen.mjs docs/audio-listen
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer } from '../../../tools/lib/server.mjs';
import { launchBrowser } from '../../../tools/lib/browser.mjs';
import { writeWav16 } from './_prepare.mjs';
const OUT = process.argv[2] ?? 'docs/audio-listen';
mkdirSync(OUT, { recursive: true });
const SURF = ['HANJI','WOOD_LATTICE','WOOD_PLANK','THATCH','ROOF_TILE','FABRIC','EARTH_WALL','ROOF_SOIL','GRANITE','WOOD_COLUMN','BRONZE'];
const server = await startServer(); const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
await page.goto(`${server.url}/__listen`);
const res = await page.evaluate(async (SURF) => {
  const g = await import('/src/audio/graph.js'); const B = await import('/src/audio/buffers.js');
  const S = await import('/src/audio/sounds.js'); const O = await import('/src/audio/occlusion.js');
  const rng = await import('/src/core/rng.js');
  const out = {};
  for (const key of ['step:WOOD_PLANK', 'gun:CARBINE']) {
    for (const s of [null, ...SURF]) {
      rng.resetAllStreams();
      const ctx = new OfflineAudioContext(1, 48000 * 1.2, 48000);
      const bank = new B.BufferBank(ctx); await bank.loadGuns();
      const src = ctx.createBufferSource(); src.buffer = bank.get(key, rng.rngStream('audio:take'));
      const resp = O.chainResponse(s ? [{ surface: s, thicknessCm: O.OCCLUSION_PROFILES[s].refCm }] : []);
      const gain = ctx.createGain(); gain.gain.value = 0.5; src.connect(gain);
      g.connectOcclusion(ctx, gain, resp).connect(ctx.destination); src.start(0.05);
      const r = await ctx.startRendering();
      out[`${key.replace(':', '_')}__${s ?? 'OPEN'}`] = Array.from(r.getChannelData(0));
    }
  }
  return out;
}, SURF);
for (const [k, v] of Object.entries(res)) writeFileSync(`${OUT}/${k}.wav`, writeWav16(Float64Array.from(v), 48000));
await browser.close(); await server.close();
console.log(Object.keys(res).length, 'files');
