#!/usr/bin/env node
/**
 * tools/harnesstest.mjs — 하네스가 하네스를 검증한다 (P1.5-BRIEF §3).
 *
 * 배경: `--tolerance` 무값 → 1 게이트 약화 결함이 같은 자리에서 두 번 발생했다.
 * 같은 클래스의 세 번째를 막는 회귀 테스트. **모든 패스 종료 조건에 영구 포함.**
 *
 * 케이스 13종:
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
 * 12. paletteaudit — 음성 훅 (자색 300° 패치 주입) → exit 1 (P3 §4)
 * 13. albedoaudit — 음성 훅 (알베도 1/3 위조) → exit 1 (P3 §5)
 * 14. determinismaudit — 음성 훅 (Math.random 가상 주입) → exit 1 (PATCH-004-B)
 * 15. profile — 음성 훅 (--inject-noroof: 사격 앙각 지면) → SCENARIO-INVALID + exit 1 (C2 검토)
 * 16. profile — 양성: 실제 동선이 ROOF_TILE 피격·기와 낙하를 실측 (축소 조건, 시나리오 유효성만)
 * 19. geometryaudit — 음성 훅 (--inject-flip-roof: 팔작 셸 y 반전) → exit 1 + testOverride (PATCH-005-C)
 * 20. paletteaudit — 자발광 밴드: 비태그 주황 주입 exit 1 / 태그 주황 exit 0(대조) / 마스크 12% 강제 exit 1 (PATCH-007-C)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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

/**
 * 계약 조건(DPR2 1512×982·settle 90) 브라우저 감사의 소요는 환경 의존이다 — SwiftShader
 * 유휴 기계에서 albedo/viewmodel 각 ≈12분(C2 실측). 종전 10분 상한은 두 케이스를
 * SIGTERM으로 끊었고, Playwright의 종료 핸들러가 exit 1로 마감해 "도구가 exit 1을
 * 냈다"처럼 보였다(stdout·stderr 공백, 표식 없음 → 음성 판정 실패로 오인). 상한을
 * 30분으로 두고, 타임아웃은 exit 코드와 별도로 명시 기록한다(무기록 금지).
 */
const AUDIT_TIMEOUT_MS = 1800000;
const LIMIT_FOR_20 = 1.5; // paletteaudit LIMIT_PCT — 케이스 20(a)의 패치(3%)가 단독으로 넘어야 하는 값
function run(cmd, args, timeoutMs = AUDIT_TIMEOUT_MS) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { code: r.status, signal: r.signal ?? null, timedOut, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/**
 * 브라우저 감사 도구 실행 + JSON 미출력(브라우저 사망) 시 1회 재시도.
 * 소프트웨어 GL의 산발적 브라우저 크래시(baseline.mjs와 동일 클래스)가 도구
 * 판정과 무관하게 케이스를 죽이는 것을 막는다 — 동일 검증의 재실행이므로
 * 음성 테스트 원칙(PATCH-003-B)은 불변. 재시도 여부는 detail에 남긴다.
 */
const retries = []; // 재시도 전수 기록 — 최상위 보고에 실린다 (무기록 재시도 금지)
function runAudit(cmd, args, timeoutMs = AUDIT_TIMEOUT_MS) {
  let r = run(cmd, args, timeoutMs);
  const parseable = (x) => { try { JSON.parse(x.out); return true; } catch { return false; } };
  if (!parseable(r)) {
    // 브라우저 사망 서명일 때만 재시도 — 도구 로직의 exit/JSON 출력은 그대로 판정한다
    const sig = /Target (page, context or browser has been|closed)|Protocol error|browser has been closed|SIGSEGV|GPU process/i;
    const first = { args: args.join(' '), exit: r.code, signal: r.signal, timedOut: r.timedOut, stdoutTail: r.out.slice(-200), stderrTail: r.err.slice(-300) };
    if (sig.test(r.err) || sig.test(r.out) || r.code === null) {
      r = run(cmd, args, timeoutMs);
      r.retried = true;
      retries.push({ ...first, retryExit: r.code });
    } else {
      retries.push({ ...first, retryExit: null, note: '브라우저 사망 서명 아님 — 재시도 안 함' });
    }
  }
  return r;
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
  const clean = runAudit('node', ['tools/surfaceaudit.mjs']);
  const injected = runAudit('node', ['tools/surfaceaudit.mjs', '--inject-unmapped']);
  let names = '';
  try { names = JSON.parse(injected.out).unmapped.map((u) => u.name).join(','); } catch { /* fail */ }
  const pass = clean.code === 0 && injected.code === 1 && names.includes('harnesstest_rogue_untagged');
  record(6, 'surfaceaudit 미매핑 주입 검출', pass, `clean=${clean.code} injected=${injected.code} [${names}]`);
}

/* ---- 7. coveraudit: 임계 초과 조작 → exit 1 ---- */
{
  const r = runAudit('node', ['tools/coveraudit.mjs', '--max-dist', '2', '--out', `${TMP}/cover_fail.png`]);
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
  const dropped = runAudit('node', ['tools/chainaudit.mjs', '--test-drop', 'ROOF_SOIL']); // 보토 재태깅 [PATCH-003-D]
  const reversed = runAudit('node', ['tools/chainaudit.mjs', '--test-reverse']);
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
  const boosted = runAudit('node', ['tools/viewmodelaudit.mjs', '--test-boost', '2']);
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
  const cloned = runAudit('node', ['tools/fxaudit.mjs', '--test-clone', 'soil_puff=dust_burst']);
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

/* ---- 12. paletteaudit 음성 테스트 (P3 §4) ----
 * 자색(300°) 패치를 합성 주입한 입력에서 반드시 exit 1. */
{
  // 입력은 케이스 5가 방금 캡처한 자급자족 디렉토리 — 기계-로컬 baseline/ 루트의
  // 존재에 의존하지 않는다 (컨테이너 재생성으로 사라져 환경 실패를 낸 실측 후 교정)
  const r = run('node', ['tools/paletteaudit.mjs', `${TMP}/base1`, '--inject-patch']);
  let marked = false;
  try { marked = String(JSON.parse(r.out).testOverride ?? '').includes('inject-patch'); } catch { /* fail */ }
  record(12, 'paletteaudit 음성 테스트 (자색 300° 주입)', r.code === 1 && marked,
    `exit=${r.code} 표식=${marked}`);
}

/* ---- 13. albedoaudit 음성 테스트 (P3 §5) ----
 * 알베도를 1/3로 깎은 입력(참조 레포의 위조 재현) — 매니페스트 대조가 잡아야 한다. */
{
  const r = runAudit('node', ['tools/albedoaudit.mjs', '--test-scale-albedo', '0.333']);
  let marked = false, devs = 0;
  try {
    const j = JSON.parse(r.out);
    marked = String(j.testOverride ?? '').includes('scaleAlbedo');
    devs = (j.manifestDeviations ?? []).length;
  } catch { /* fail */ }
  record(13, 'albedoaudit 음성 테스트 (알베도 1/3 위조)', r.code === 1 && marked && devs > 0,
    `exit=${r.code} 표식=${marked} 편차=${devs}건`);
}

/* ---- 14. determinismaudit 음성 테스트 (PATCH-004-B) ----
 * Math.random 호출을 가상 주입한 입력 — 정적 게이트가 반드시 잡아야 한다. */
{
  const clean = run('node', ['tools/determinismaudit.mjs']);
  const r = run('node', ['tools/determinismaudit.mjs', '--inject-test']);
  let marked = false, viol = 0;
  try {
    const j = JSON.parse(r.out);
    marked = String(j.testOverride ?? '').includes('inject-test');
    viol = (j.srcViolations ?? []).length;
  } catch { /* fail */ }
  record(14, 'determinismaudit 음성 테스트 (Math.random 가상 주입)',
    clean.code === 0 && r.code === 1 && marked && viol > 0,
    `clean=${clean.code} inject=${r.code} 표식=${marked} 위반=${viol}건`);
}

/* ---- 15. profile 시나리오 유효성 게이트 음성 테스트 (C2 검토) ----
 * 사격 앙각을 지면으로 바꾼 입력(--inject-noroof) — ROOF_TILE 피격 0 → 반드시
 * SCENARIO-INVALID 배너 + testOverride + exit 1. 축소 조건(14s/1run/DPR1 640×400)이라
 * NON-CONTRACT 배너도 함께 나와야 한다. 사격 세그먼트가 시뮬 10.8s에 시작하므로 16s.
 * duration은 시뮬 시간이라 fps가 낮으면 벽시계로 더 오래 걸릴 뿐 동선은 같다(서브스텝
 * 상한이 프레임 dt 상한을 온전히 소화 — 종전 상한 5는 저 fps에서 이동을 42%만 소화해
 * 캡처 병행 0.7fps 실측에서 히트 0이 났다). */
const SHORT = ['--duration', '16', '--runs', '1', '--dpr', '1', '--w', '640', '--h', '400', '--phase', 'p3'];
{
  const r = runAudit('node', ['tools/profile.mjs', ...SHORT, '--inject-noroof']);
  let marked = false, banner = false, valid = null, roof = null;
  try {
    const j = JSON.parse(r.out);
    marked = String(j.testOverride ?? '').includes('inject-noroof');
    banner = (j.banners ?? []).some((b) => b.startsWith('SCENARIO-INVALID')) && (j.banners ?? []).some((b) => b.startsWith('NON-CONTRACT'));
    valid = j.scenario?.valid; roof = j.scenario?.roofTileHits_min;
  } catch { /* fail */ }
  record(15, 'profile 시나리오 유효성 음성 테스트 (--inject-noroof)', r.code === 1 && marked && banner && valid === false,
    `exit=${r.code} 표식=${marked} 배너=${banner} valid=${valid} roofHits=${roof}`);
}

/* ---- 16. profile 시나리오 유효성 양성 — 실제 동선이 ROOF_TILE을 맞히고 기와가 떨어진다 ----
 * 축소 조건이라 성능 판정은 무효(NON-CONTRACT)지만 시나리오 유효성은 동선의 함수다. */
{
  const r = runAudit('node', ['tools/profile.mjs', ...SHORT]);
  let valid = null, roof = null, debris = null, banner = false;
  try {
    const j = JSON.parse(r.out);
    valid = j.scenario?.valid; roof = j.scenario?.roofTileHits_min; debris = j.scenario?.debrisSpawned_min;
    banner = (j.banners ?? []).some((b) => b.startsWith('SCENARIO-INVALID'));
  } catch { /* fail */ }
  record(16, 'profile 시나리오 유효성 양성 (동선 실측: ROOF_TILE 피격·기와 낙하)', valid === true && !banner && (roof ?? 0) > 0 && (debris ?? 0) > 0,
    `exit=${r.code} valid=${valid} roofHits=${roof} debris=${debris}`);
}

/* ---- 17/18. rendervariance: 같은 입력의 반복 렌더 HDR 해시가 전부 동일해야 한다 (C3 결정성 교정) ----
 * 8비트 픽셀 게이트(baseline ×2)는 서브LSB 변동을 90프레임에 1픽셀꼴로만 드러낸다 — HDR 버퍼 해시는
 * 매 렌더 변동을 잡는다(POM 암시 미분 결함: 교정 전 12회 중 10종 해시). 음성: --inject-drift(지터 드리프트 주입)
 * → 반드시 exit 1 + testOverride. 축소 해상도(640×416)라도 변동 검출은 해상도와 무관하다. */
{
  const r = runAudit('node', ['tools/rendervariance.mjs', '--repeats', '4']);
  let bad = null, shots = 0;
  try { const j = JSON.parse(r.out); bad = j.varying; shots = Object.keys(j.shots ?? {}).length; } catch { /* fail */ }
  record(17, 'rendervariance 양성 (12샷 × 4회 HDR 해시 단일)', r.code === 0 && Array.isArray(bad) && bad.length === 0 && shots === 12, `exit=${r.code} shots=${shots} varying=${JSON.stringify(bad)}`);
}
{
  const r = runAudit('node', ['tools/rendervariance.mjs', '--repeats', '4', '--shots', 'courtyard_noon,lantern_night', '--inject-drift']);
  let bad = null, marked = false;
  try { const j = JSON.parse(r.out); bad = j.varying; marked = String(j.testOverride ?? '').includes('debugDrift'); } catch { /* fail */ }
  record(18, 'rendervariance 음성 (--inject-drift → 변동 검출 exit 1 + 표식)', r.code === 1 && Array.isArray(bad) && bad.length === 2 && marked, `exit=${r.code} varying=${JSON.stringify(bad)} 표식=${marked}`);
}

/* ---- 19. geometryaudit 음성 (PATCH-005-C): 팔작 셸 정점을 인위로 뒤집은 입력에서 반드시 exit 1 + testOverride ----
 * 팔작지붕 프로파일 반전(처마 > 용마루)이 P1.5·C3·픽셀 게이트를 전부 통과한 사례 — 정적 불변식 감사가 이를 잡는지 검증한다.
 * 뒤집힌 셸에서 불변식 [1](용마루>처마)·[2](외피 법선 위·바깥)가 팔작 2동(dh·gs) 모두에서 실패해야 한다. */
{
  const r = runAudit('node', ['tools/geometryaudit.mjs', '--inject-flip-roof']);
  let marked = false, flipFails = 0;
  try {
    const j = JSON.parse(r.out); marked = String(j.testOverride ?? '').includes('inject-flip-roof');
    flipFails = (j.checks ?? []).filter((c) => !c.ok && /^\[[12]\] (dh|gs):/.test(c.name)).length;
  } catch { /* fail */ }
  record(19, 'geometryaudit 음성 (--inject-flip-roof → 팔작 [1]·[2] 실패 exit 1 + 표식)', r.code === 1 && marked && flipFails >= 2, `exit=${r.code} 표식=${marked} 팔작 [1]/[2] 실패=${flipFails}`);
}

/* ---- 20. paletteaudit 자발광 밴드 (PATCH-007-C) ----
 * (a) 비태그 픽셀에 주황(30°, s .8) 패치 3% 주입 → 밴드가 태그 밖으로 새면 통과해 버린다 — 반드시 exit 1 + 표식.
 * (b) 같은 패치를 태그 픽셀로 주입 → 밴드가 살아 있으면 패치는 면제(exemptedByEmissiveBand ≥ 패치 픽셀)이고 exit 0 (대조).
 * (c) 마스크 12%를 강제 → 발광 비율 상한 8% 초과 → exit 1 + 표식.
 * 입력은 케이스 5의 자급 디렉토리(courtyard_noon — baseline.mjs 가 .emask.png 를 동반 저장한다).
 * 재질 수준 주입을 쓰지 않는 이유: 비발광 재질에 건 주황은 출력 셰이더의 목재 대역 채도 상한(12–46°)이 먼저 눌러
 * 게이트 통과 여부가 '밴드 누수'가 아니라 '상한'을 시험하게 된다 — 픽셀·마스크 수준 주입이 밴드 게이팅을 직접 시험한다. */
{
  const dir = `${TMP}/base1`;
  const maskPresent = existsSync(`${dir}/courtyard_noon.emask.png`);
  const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
  const a = run('node', ['tools/paletteaudit.mjs', dir, '--inject-orange']);
  const b = run('node', ['tools/paletteaudit.mjs', dir, '--inject-orange-tagged']);
  const c = run('node', ['tools/paletteaudit.mjs', dir, '--inject-mask-ratio', '0.12']);
  const ja = parse(a), jb = parse(b), jc = parse(c);
  const markedA = String(ja?.testOverride ?? '').includes('inject-orange(');
  const markedB = String(jb?.testOverride ?? '').includes('inject-orange-tagged');
  const markedC = String(jc?.testOverride ?? '').includes('inject-mask-ratio');
  const patchB = jb?.shots?.[0]?.injectedPatchPixels ?? 0;
  const exemptB = jb?.shots?.[0]?.exemptedByEmissiveBand ?? 0;
  const passA = a.code === 1 && markedA && (ja?.shots?.[0]?.violationPct ?? 0) > LIMIT_FOR_20;
  const passB = b.code === 0 && markedB && patchB > 0 && exemptB >= patchB;
  const passC = c.code === 1 && markedC && jc?.shots?.[0]?.emissiveOk === false;
  record(20, 'paletteaudit 자발광 밴드 (비태그 주황 → exit 1 / 태그 주황 → exit 0 / 마스크 12% → exit 1)', maskPresent && passA && passB && passC,
    `mask=${maskPresent} a=${a.code}/${markedA}/${ja?.shots?.[0]?.violationPct}% b=${b.code}/${markedB}/exempt=${exemptB}/${patchB} c=${c.code}/${markedC}/emissive=${jc?.shots?.[0]?.emissivePct}%`);
}

const ok = results.every((r) => r.pass);
console.log(JSON.stringify({ ok, retries, cases: results }, null, 2));
process.exit(ok ? 0 : 1);
