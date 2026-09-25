#!/usr/bin/env node
/**
 * tools/wallaccess.mjs — 벽 접근권 표 (P4-BRIEF §4-6, 발주자 결정 2026-09-25: "기계적으로 뽑은 표를 권위로 삼는다").
 * 손으로 쓰지 않는다. 동결 §2-1 표(surfaces.js) + 무기 상수(params.js) + k 스케일(ballistics.js)에서만 나온다.
 * 두께: 월드 킷 상수(kit.js T)가 있으면 그 값, 없으면 오디오 기준 두께(occlusion.js refCm). 칸에 출처를 적는다.
 * 정지 = 동결 함수의 임계(초기 에너지 2 % 미만). 출력: markdown(stdout). --json 이면 JSON.
 */
import { SURFACES } from '../src/core/surfaces.js';
import { WEAPONS } from '../src/weapons/params.js';
import { penetrate } from '../src/weapons/ballistics.js';
import { OCCLUSION_PROFILES } from '../src/audio/occlusion.js';

const KIT_CM = { HANJI: [0.03, 'HANJI_T'], WOOD_LATTICE: [2.4, 'LATTICE_T'], EARTH_WALL: [10, 'SIMBYEOK_T'], WOOD_COLUMN: [30, 'COL_D'], ROOF_TILE: [3, 'TILE_T'], THATCH: [20, 'THATCH_T'] };
const ORDER = ['HANJI', 'FABRIC', 'WOOD_LATTICE', 'WOOD_PLANK', 'ROOF_TILE', 'THATCH', 'ROOF_SOIL', 'WOOD_COLUMN', 'EARTH_WALL', 'GRANITE', 'BRONZE'];
const ws = ['SHOTGUN', 'CARBINE', 'DMR'];
const rows = ORDER.map((s) => {
  const [t, src] = KIT_CM[s] ?? [OCCLUSION_PROFILES[s]?.refCm ?? 0, 'audio refCm'];
  const cells = ws.map((w) => {
    const p = WEAPONS[w];
    const r = penetrate(p, p.energy, [{ surface: s, thicknessCm: t }]);
    const pct = Math.round((100 * r.residual) / p.energy);
    return { weapon: w, pass: r.stoppedAt === null, residualPct: r.stoppedAt === null ? pct : 0 };
  });
  return { surface: s, penClass: SURFACES[s].penClass, thicknessCm: t, thicknessSource: src, cells };
});
if (process.argv.includes('--json')) { console.log(JSON.stringify({ weapons: ws.map((w) => WEAPONS[w]), rows }, null, 2)); }
else {
  console.log(`| 표면 (등급 · 두께 · 출처) | ${ws.map((w) => `${w} (k ${WEAPONS[w].k}, ${WEAPONS[w].energy} J${WEAPONS[w].pellets > 1 ? '/펠릿' : ''})`).join(' | ')} |`);
  console.log(`|---|${ws.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.surface} (${r.penClass}, ${r.thicknessCm} cm — ${r.thicknessSource}) | ${r.cells.map((c) => (c.pass ? `○ ${c.residualPct} %` : '✕ 정지')).join(' | ')} |`);
  console.log('\n○ = 통과(잔여 %), ✕ = 정지(초기 2 % 미만). 출처: surfaces.js computePenetration · params.js WEAPONS · ballistics.js penetrate.');
}
