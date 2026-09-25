/**
 * src/audio/measure.js — 렌더 신호에서 오클루전 4축을 잰다 (P4-BRIEF §2-5, 판정 1-2).
 *
 * 표 값이 아니라 **렌더한 신호**가 입력이다 — 기준(차폐 없음) 렌더와 차폐 렌더를 비교한다.
 *
 *   attenuationDb : 전대역 에너지 비 10·log10(E_occ / E_ref)
 *   cutoffHz      : 전달함수 |H(f)|(1/3옥타브 평활)가 저역 통과대(25–55 Hz 평균)보다 12 dB 아래로
 *                   처음 떨어지는 주파수(100 Hz 부터 탐색). 통과대를 벽체 재방사 모드(최저 70 Hz, 흙벽)보다
 *                   아래에 둔다 — 모드가 기준을 끌어올리면 차단이 낮게 잡힌다(실측: 50–90 Hz 기준에서 흙벽 오측).
 *                   -12 dB 로 잡는 이유: 목재의 중역 딥(-7~-8 dB)을 차단으로 오인하지 않게. 24 dB/oct 단이면 설정 차단 주파수의 약 1.4배에서 걸린다
 *   delayMs       : 통과대(25–55 Hz) 군지연 — 교차 스펙트럼 위상 기울기. 벽체 모드(≥ 70 Hz) 아래라
 *                   공진 부근 위상 급변에 흔들리지 않는다
 *   couplingRatio : 음원이 끝난 뒤(시험 음원 250 ms + 지연 + 5 ms)에 남는 에너지 / 전체 에너지
 *                   — 벽체 재방사 울림의 양
 *
 * "상이" 기준 (P4-BRIEF §2-5 개정 — 들리는 축만 센다):
 *   - 차단 1/3옥타브 이상 · 감쇠 3 dB 이상 — 청감 근거
 *   - 잔향 결합: 둘 중 하나라도 판정 하한(0.01 = 1 % 잔류 에너지) 위이고, **절대차**가 하한 이상일 때만
 *   - 지연: 측정 · 보고만. 수 ms 저역 군지연 차는 들리지 않는다 → 세지 않는다
 */

export const AXES = Object.freeze(['cutoffHz', 'attenuationDb', 'couplingRatio', 'delayMs']);
/** 판정에 세는 축 — 지연은 보고 전용 */
export const AUDIBLE_AXES = Object.freeze(['cutoffHz', 'attenuationDb', 'couplingRatio']);
export const DISTINCT = Object.freeze({
  cutoffOct: 1 / 3,
  attenuationDb: 3,
  couplingFloor: 0.01,
  minAxes: 2,
});

const PROBE_S = 0.25;

export function fft(x, n) {
  // radix-2 복소 FFT (실수 입력) → { re, im } (0..n-1)
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  return { re, im };
}

export function mag2(X) {
  const out = new Float64Array(X.re.length / 2 + 1);
  for (let i = 0; i < out.length; i++) out[i] = X.re[i] * X.re[i] + X.im[i] * X.im[i];
  return out;
}

/** 교차 스펙트럼 위상의 기울기 → 군지연(초). [f0, f1] 대역, 위상 펼침 후 최소제곱 */
function groupDelay(R, O, rate, n, f0, f1) {
  const i0 = Math.ceil((f0 * n) / rate), i1 = Math.floor((f1 * n) / rate);
  let prev = null, unwrap = 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
  for (let i = i0; i <= i1; i++) {
    // G = O · conj(R)
    const gr = O.re[i] * R.re[i] + O.im[i] * R.im[i], gi = O.im[i] * R.re[i] - O.re[i] * R.im[i];
    let ph = Math.atan2(gi, gr);
    if (prev !== null) {
      while (ph + unwrap - prev > Math.PI) unwrap -= 2 * Math.PI;
      while (ph + unwrap - prev < -Math.PI) unwrap += 2 * Math.PI;
    }
    ph += unwrap; prev = ph;
    const w = (2 * Math.PI * i * rate) / n;
    sx += w; sy += ph; sxx += w * w; sxy += w * ph; k++;
  }
  const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
  return -slope;
}

function energy(x, from = 0, to = x.length) {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) e += x[i] * x[i];
  return e;
}

function bandPower(P, rate, n, f) {
  // 1/3옥타브 평활
  const lo = f / 2 ** (1 / 6), hi = f * 2 ** (1 / 6);
  const i0 = Math.max(1, Math.floor((lo * n) / rate)), i1 = Math.min(P.length - 1, Math.ceil((hi * n) / rate));
  let s = 0;
  for (let i = i0; i <= i1; i++) s += P[i];
  return s / (i1 - i0 + 1);
}

export function measureProfile(ref, occ, rate) {
  const n = 1 << Math.ceil(Math.log2(Math.max(ref.length, occ.length)));
  const R = fft(ref, n), O = fft(occ, n);
  const Pr = mag2(R), Po = mag2(O);
  const H = (f) => 10 * Math.log10((bandPower(Po, rate, n, f) + 1e-30) / (bandPower(Pr, rate, n, f) + 1e-30));
  let pass = 0, cnt = 0;
  for (let f = 25; f <= 55; f *= 2 ** (1 / 12)) { pass += H(f); cnt++; }
  pass /= cnt;
  let cutoffHz = 20000;
  // 1/24옥타브 격자로 훑고, 넘는 칸에서 log f – dB 선형 보간으로 교차점을 잡는다
  const STEP = 2 ** (1 / 24);
  let fPrev = 100, hPrev = H(100);
  for (let f = 100 * STEP; f <= 20000; f *= STEP) {
    const h = H(f);
    if (h < pass - 12) {
      const t = hPrev === h ? 0 : (hPrev - (pass - 12)) / (hPrev - h);
      cutoffHz = fPrev * (f / fPrev) ** Math.min(1, Math.max(0, t));
      break;
    }
    fPrev = f; hPrev = h;
  }
  if (H(100) < pass - 12) cutoffHz = 100;

  const attenuationDb = 10 * Math.log10((energy(occ) + 1e-30) / (energy(ref) + 1e-30));

  // 지연: 통과대(25–55 Hz) 군지연 — 투과 지연 + 저역통과 단의 저주파 군지연.
  // (교차상관 최대값은 강한 저역통과에서 봉우리가 넓어 불안정 — 실측으로 기각)
  const delayMs = Math.max(0, groupDelay(R, O, rate, n, 25, 55) * 1000);

  const lateFrom = Math.round((PROBE_S + delayMs / 1000 + 0.005) * rate);
  const couplingRatio = energy(occ, lateFrom) / (energy(occ) || 1);

  return { cutoffHz, attenuationDb, couplingRatio, delayMs };
}

/** 두 프로파일이 **들리게** 다른 축 목록 (지연 제외) */
export function distinctAxes(a, b) {
  const out = [];
  if (Math.abs(Math.log2(a.cutoffHz / b.cutoffHz)) >= DISTINCT.cutoffOct) out.push('cutoffHz');
  if (Math.abs(a.attenuationDb - b.attenuationDb) >= DISTINCT.attenuationDb) out.push('attenuationDb');
  const f = DISTINCT.couplingFloor;
  if (Math.max(a.couplingRatio, b.couplingRatio) >= f && Math.abs(a.couplingRatio - b.couplingRatio) >= f) out.push('couplingRatio');
  return out;
}
