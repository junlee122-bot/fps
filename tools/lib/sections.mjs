/**
 * tools/lib/sections.mjs — 도구 절(section) 부분 실행 규칙 (P4B 설계서 §10-5 playtest 행, 재검토 #3).
 *
 * 왜: 음성 훅을 전체 도구로 돌리면 harnesstest 가 CI 생존 창을 넘는다(§10-7 시간 예산). 그래서 음성 실행은 훅이 겨냥하는 절만 돈다.
 * 그런데 부분 실행이 훅 없이 가능하면 "그 절만 통과"가 게이트 통과처럼 보인다 — PATCH-001-C(축소 조건은 명시 플래그 + 표식)와 같은 결함이다.
 * 규칙:
 *  - `--section` 은 `--inject-*` 와 함께일 때만 허용한다. 아니면 인자 오류(exit 2).
 *  - 켠 훅이 겨냥하는 절이 지정 절과 다르면 인자 오류 — 훅이 건너뛴 절에 걸려 음성이 공허해진다.
 *  - 부분 실행은 testOverride 표식에 `section=<이름>` 이 박힌다.
 * 순수 함수(입출력 없음) — 도구가 결과를 보고 exit 한다. test/sections.test.mjs 가 양성·음성을 검사한다.
 */

/** 인자 오류 종료 코드 (도구 공통: 0 통과 · 1 판정 실패 · 2 인자 오류) */
export const EXIT_ARG_ERROR = 2;

/**
 * @param {object} args parseArgs 결과
 * @param {string[]} order 절 실행 순서(전체 실행 = 이 순서 전부)
 * @param {Record<string, {section: string, marker: string}>} injects 음성 훅 플래그 → 겨냥 절·표식
 * @param {string} suffix 표식 꼬리(계약 판정 무효 문구)
 * @returns {{ok: true, sections: string[], section?: string, activeInjects: string[], testOverride?: string}
 *         | {ok: false, exitCode: number, error: string}}
 */
export function resolveSections(args, order, injects, suffix) {
  for (const [k, v] of Object.entries(injects)) {
    if (!order.includes(v.section)) throw new Error(`sections: 훅 ${k} 의 겨냥 절 ${v.section} 이 절 순서에 없다`);
  }
  const activeInjects = Object.keys(injects).filter((k) => args[k] === true);
  const section = args.section;
  if (section !== undefined) {
    if (typeof section !== 'string' || !order.includes(section)) {
      return { ok: false, exitCode: EXIT_ARG_ERROR, error: `--section 은 ${order.join(' | ')} 중 하나여야 한다 (got ${section})` };
    }
    if (activeInjects.length === 0) {
      return {
        ok: false, exitCode: EXIT_ARG_ERROR,
        error: '--section 은 --inject-* 와 함께만 쓴다 — 음성 훅 없는 부분 실행은 게이트 통과처럼 보인다 (PATCH-001-C)',
      };
    }
    const off = activeInjects.filter((k) => injects[k].section !== section);
    if (off.length) {
      return {
        ok: false, exitCode: EXIT_ARG_ERROR,
        error: `--section ${section}: ${off.map((k) => `--${k}(겨냥 절 ${injects[k].section})`).join(', ')} 의 대상 절을 건너뛴다`,
      };
    }
  }
  const parts = [...activeInjects.map((k) => injects[k].marker), ...(section !== undefined ? [`section=${section}(부분 실행)`] : [])];
  return {
    ok: true,
    sections: section === undefined ? [...order] : [section],
    ...(section !== undefined ? { section } : {}),
    activeInjects,
    ...(parts.length ? { testOverride: `${parts.join(' · ')} — ${suffix}` } : {}),
  };
}
