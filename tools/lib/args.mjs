/**
 * tools/lib/args.mjs — CLI 인자 파서.
 *
 * HARNESS.md §4의 계약 형식은 공백 구분('--tolerance 0')이다. '--key=value'도
 * 함께 지원한다. 값이 없는 플래그는 true.
 *
 * 감사에서 잡힌 결함의 재발 방지: 이전 파서는 '--tolerance 0'을
 * {tolerance:true, '0':true}로 흩어 Number(true)=1 → 픽셀 게이트가 조용히
 * tolerance 1로 약화됐다. 위치 인자는 `_` 배열로 보존한다.
 */

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) {
      out._.push(a);
      continue;
    }
    if (m[2] !== undefined) {
      out[m[1]] = m[2];
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[m[1]] = next;
      i++;
    } else {
      out[m[1]] = true;
    }
  }
  return out;
}
