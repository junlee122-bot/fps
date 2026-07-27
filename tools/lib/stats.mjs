/**
 * tools/lib/stats.mjs — 하네스 통계 프리미티브.
 *
 * profile.mjs가 사용하고 harnesstest.mjs가 정답 분포로 검증한다
 * (P1.5-BRIEF §3 케이스 8). 분위수 관례: 정렬 배열에서 floor(N·p) 인덱스
 * (상한 클램프) — 과소평가하지 않는 보수적 관례.
 */

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function sortedAsc(arr) {
  return arr.slice().sort((a, b) => a - b);
}

/**
 * 프레임별 (sim+submit) 합 배열 — 미계측(-1) 프레임은 제외.
 * p95(sim)+p95(submit) ≠ p95(sim+submit) 이므로 (감사 B3) 게이트는
 * 반드시 이 합 배열의 분위수를 쓴다.
 */
export function pairSum(simArr, submitArr) {
  const out = [];
  const n = Math.min(simArr.length, submitArr.length);
  for (let i = 0; i < n; i++) {
    if (simArr[i] >= 0 && submitArr[i] >= 0) out.push(simArr[i] + submitArr[i]);
  }
  return out;
}

/** 런 간 집계: 게이트 지표는 최악(max) — 보수적 */
export function maxAcross(runs, pick) {
  return Math.max(...runs.map(pick));
}
