#!/usr/bin/env node
/**
 * tools/harnesstest.mjs — 하네스가 하네스를 검증한다 (P1.5-BRIEF §3).
 *
 * 배경: `--tolerance` 무값 → 1 게이트 약화 결함이 같은 자리에서 두 번 발생했다.
 * 같은 클래스의 세 번째를 막는 회귀 테스트. **모든 패스 종료 조건에 영구 포함.**
 *
 * 케이스 11종:
 *  1. imagediff — 1픽셀 변경 쌍 → 반드시 exit 1
 *  2. imagediff — 값 없는 --tolerance → 0 처리 또는 에러 (1로 새면 실패)
 *  3. profile — 무인자 실행 시 duration 30 / runs 3 / dpr 2
 *  4. profile — 축소 인자 시 NON-CONTRACT MEASUREMENT 배너
 *  5. baseline — 동일 커밋 2회 실행 바이트 동일 (1샷·DPR1·settle20 축소판)
 *  6. surfaceaudit — 미매핑 메시 주입 시 exit 1
 *  7. coveraudit — 임계 초과 조작 입력(max-dist 2) 시 exit 1
 *  8. p95 산출 — 알려진 분포 정답 일치 (프레임별 합 분위수·다중 run 집계 포함)
 *  9. chainaudit — 음성 훅 (레이어 제거·순서 뒤집기) → exit 1 (P2A §0-1)
 * 10. viewmodelaudit — 음성 훅 (조도 2배 부스트) → exit 1 (P2A §3)
 * 11. fxaudit — 음성 훅 (프로파일 복제 동일화) → exit 1 (P2B §2 / PATCH-003-B)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { percentile, sortedAsc, pairSum, maxAcross } from './lib/stats.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = resolve(ROOT, 'tmp/harnesstest');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.error(`[${pass ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, args, timeoutMs = 600000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function makePng(path, px) {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 100; png.data[i + 1] = 100; png.data[i + 2] = 100; png.data[i + 3] = 255;
  }
  if (px) {
    const p = (px.y * 8 + px.x) * 4;
    png.data[p] = px.r; png.data[p + 1] = px.g; png.data[p + 2] = px.b;
  }
  writeFileSync(path, PNG.sync.write(png));
}

/* ---- 1. imagediff: 1픽셀 변경 → exit 1 ---- */
{
  mkdirSync(`${TMP}/a`, { recursive: true });
  mkdirSync(`${TMP}/b`, { recursive: true });
  makePng(`${TMP}/a/shot.png`, null);
  makePng(`${TMP}/b/shot.png`, { x: 3, y: 5, r: 101, g: 100, b: 100 }); // 채널 delta 1
  const r = run('node', ['tools/imagediff.mjs', `${TMP}/a`, `${TMP}/b`, '--partial']);
  record(1, 'imagediff 1픽셀 변경 검출', r.code === 1, `exit=${r.code}`);
}

/* ---- 2. imagediff: 값 없는 --tolerance → 0 처리 또는 에러 ---- */
{
  const r = run('node', ['tools/imagediff.mjs', `${TMP}/a`, `${TMP}/b`, '--partial', '--tolerance']);
  // 허용: (a) 에러 종료(exit 2), (b) tolerance 0으로 실행되어 차이 검출(exit 1).
  // 실패: tolerance 1로 새서 exit 0.
  let leaked = false;
  try { leaked = JSON.parse(r.out).tolerance === 1; } catch { /* 에러 출력이면 leak 아님 */ }
  const pass = (r.code === 2) || (r.code === 1 && !leaked);
  record(2, 'imagediff 무값 --tolerance 차단', pass && !leaked, `exit=${r.code}${leaked ? ' TOLERANCE=1 누출' : ''}`);
}

/* ---- 3. profile: 무인자 기본값 = 계약 조건 ---- */
{
  const r = run('node', ['tools/profile.mjs', '--print-config']);
  let ok = false, got = '';
  try {
    const d = JSON.parse(r.out);
    got = JSON.stringify(d.contract);
    ok = d.contract.duration === 30 && d.contract.runs === 3 && d.contract.dpr === 2 &&
         d.contract.nonContract === false && d.banners.length === 0;
  } catch { /* parse 실패 = fail */ }
  record(3, 'profile 기본값 = 계약(30s/3runs/DPR2)', ok, got);
}

/* ---- 4. profile: 축소 인자 → NON-CONTRACT 배너 ---- */
{
  const cases = [
    ['--duration', '3'],
    ['--dpr', '1'],
    ['--w', '756'],
    ['--warmup', '0'],
  ];
  let all = true;
  const detail = [];
  for (const c of cases) {
    const r = run('node', ['tools/profile.mjs', ...c, '--print-config']);
    let banner = false;
    try { banner = JSON.parse(r.out).banners.some((b) => b.includes('NON-CONTRACT')); } catch { /* fail */ }
    if (!banner) all = false;
    detail.push(`${c.join(' ')}:${banner ? 'ok' : 'MISSING'}`);
  }
  record(4, 'profile 축소 인자 NON-CONTRACT 배너', all, detail.join(', '));
}

/* ---- 5. baseline: 2회 실행 바이트 동일 (축소판) ---- */
{
  const shot = 'courtyard_noon';
  const r1 = run('node', ['tools/baseline.mjs', '--out', `${TMP}/base1`, '--dpr', '1', '--settle', '20', '--shots', shot]);
  const r2 = run('node', ['tools/baseline.mjs', '--out', `${TMP}/base2`, '--dpr', '1', '--settle', '20', '--shots', shot]);
  let pass = r1.code === 0 && r2.code === 0;
  let detail = `exits=${r1.code},${r2.code}`;
  if (pass) {
    const h1 = createHash('sha256').update(readFileSync(`${TMP}/base1/${shot}.png`)).digest('hex');
    const h2 = createHash('sha256').update(readFileSync(`${TMP}/base2/${shot}.png`)).digest('hex');
    pass = h1 === h2;
    detail = pass ? `sha256 동일 ${h1.slice(0, 12)}…` : 'BYTE MISMATCH';
    // 축소판임이 report에 표식되어야 한다 (감사 B5 회귀 확인)
    try {
      const rep = JSON.parse(readFileSync(`${TMP}/base1/report.json`, 'utf8'));
      if (rep.nonContract !== true) { pass = false; detail += ' + NON-CONTRACT 표식 누락'; }
    } catch { pass = false; detail += ' + report.json 없음'; }
  }
  record(5, 'baseline 2회 바이트 동일(축소판) + 비계약 표식', pass, detail);
}

/* ---- 6. surfaceaudit: 미매핑 주입 → exit 1 ---- */
{
  const clean = run('node', ['tools/surfaceaudit.mjs']);
  const injected = run('node', ['tools/surfaceaudit.mjs', '--inject-unmapped']);
  let names = '';
  try { names = JSON.parse(injected.out).unmapped.map((u) => u.name).join(','); } catch { /* fail */ }
  const pass = clean.code === 0 && injected.code === 1 && names.includes('harnesstest_rogue_untagged');
  record(6, 'surfaceaudit 미매핑 주입 검출', pass, `clean=${clean.code} injected=${injected.code} [${names}]`);
}

/* ---- 7. coveraudit: 임계 초과 조작 → exit 1 ---- */
{
  const r = run('node', ['tools/coveraudit.mjs', '--max-dist', '2', '--out', `${TMP}/cover_fail.png`]);
  let marked = false;
  try { marked = String(JSON.parse(r.out).testOverride ?? '').includes('max-dist'); } catch { /* fail */ }
  record(7, 'coveraudit 임계 초과 실패 경로', r.code === 1 && marked, `exit=${r.code} override표식=${marked}`);
}

/* ---- 8. p95 산출 정답 일치 ---- */
{
  const checks = [];
  // 8a. floor 관례: 1..100 정렬에서 p95 = index 95 = 96
  checks.push(['p95(1..100)=96', percentile(sortedAsc(Array.from({ length: 100 }, (_, i) => i + 1)), 0.95) === 96]);
  // 8b. 단일 원소
  checks.push(['p95([42])=42', percentile([42], 0.95) === 42]);
  // 8c. p50 홀수 길이
  checks.push(['p50(1..5)=3', percentile([1, 2, 3, 4, 5], 0.5) === 3]);
  // 8d. 프레임별 합 분위수 ≠ 분위수 합 (감사 B3의 회귀)
  const sim = [1, 1, 1, 1, 1, 1, 1, 1, 1, 10];
  const sub = [10, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const totalP95 = percentile(sortedAsc(pairSum(sim, sub)), 0.95);
  const naive = percentile(sortedAsc(sim.slice()), 0.95) + percentile(sortedAsc(sub.slice()), 0.95);
  checks.push([`합의 p95=11 (분위수 합 ${naive}≠)`, totalP95 === 11 && naive === 20]);
  // 8e. 미계측(-1) 프레임 제외
  checks.push(['pairSum -1 제외', pairSum([1, -1, 2], [1, 1, -1]).length === 1]);
  // 8f. 다중 run 집계 = max (보수적)
  checks.push(['maxAcross', maxAcross([{ v: 3 }, { v: 7 }, { v: 5 }], (r) => r.v) === 7]);
  const bad = checks.filter(([, ok]) => !ok);
  record(8, 'p95/집계 산출 정답 일치', bad.length === 0, bad.length ? bad.map(([n]) => n).join('; ') : `${checks.length}건 전부 일치`);
}

/* ---- 9. chainaudit 음성 테스트 (P2A-BRIEF §0-1) ----
 * 게이트 툴의 통과 케이스만으로는 툴이 작동한다는 증거가 되지 않는다.
 * (a) 레이어 제거 입력, (b) 순서 뒤집기 입력 — 둘 다 반드시 exit 1. */
{
  const dropped = run('node', ['tools/chainaudit.mjs', '--test-drop', 'ROOF_SOIL']); // 보토 재태깅 [PATCH-003-D]
  const reversed = run('node', ['tools/chainaudit.mjs', '--test-reverse']);
  let dropMarked = false, revMarked = false;
  try { dropMarked = String(JSON.parse(dropped.out).testOverride ?? '').includes('drop'); } catch { /* fail */ }
  try { revMarked = String(JSON.parse(reversed.out).testOverride ?? '').includes('reverse'); } catch { /* fail */ }
  const pass = dropped.code === 1 && reversed.code === 1 && dropMarked && revMarked;
  record(9, 'chainaudit 음성 테스트 (레이어 제거·순서 뒤집기)', pass,
    `drop=${dropped.code}(표식=${dropMarked}) reverse=${reversed.code}(표식=${revMarked})`);
}

/* ---- 10. viewmodelaudit 음성 테스트 (P2A-BRIEF §3) ----
 * 뷰모델 조도를 인위로 2배 부스트한 입력(리그 불일치 등가)에서 반드시 exit 1.
 * 통과 케이스만으로는 휘도 측정·비율 판정이 작동한다는 증거가 되지 않는다. */
{
  const boosted = run('node', ['tools/viewmodelaudit.mjs', '--test-boost', '2']);
  let marked = false, ratio = null;
  try {
    const j = JSON.parse(boosted.out);
    marked = String(j.testOverride ?? '').includes('boost');
    ratio = j.ratio;
  } catch { /* fail */ }
  const pass = boosted.code === 1 && marked;
  record(10, 'viewmodelaudit 음성 테스트 (뷰모델 2배 부스트)', pass,
    `exit=${boosted.code} 표식=${marked} ratio=${ratio}`);
}

/* ---- 11. fxaudit 음성 테스트 (P2B §2) ----
 * 인위로 두 프로파일을 동일하게 만든 입력(ROOF_SOIL←EARTH_WALL 복제)에서
 * 반드시 exit 1 — PATCH-003-B "관측 불가능한 표면은 자유변수" 조항의 게이트가
 * 실제로 작동하는지 검증한다. */
{
  const cloned = run('node', ['tools/fxaudit.mjs', '--test-clone', 'soil_puff=dust_burst']);
  let marked = false, pairOk = null;
  try {
    const j = JSON.parse(cloned.out);
    marked = String(j.testOverride ?? '').includes('clone');
    pairOk = j.roofSoilVsEarthWall?.ok;
  } catch { /* fail */ }
  const pass = cloned.code === 1 && marked && pairOk === false;
  record(11, 'fxaudit 음성 테스트 (soil_puff←dust_burst 복제)', pass,
    `exit=${cloned.code} 표식=${marked} 핵심쌍ok=${pairOk}`);
}

const ok = results.every((r) => r.pass);
console.log(JSON.stringify({ ok, cases: results }, null, 2));
process.exit(ok ? 0 : 1);
