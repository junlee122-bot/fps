/**
 * src/render/exposure-contract.js — C4 노출 적응 계약 (P4-BRIEF §5-1 ⓐ, P4B 설계서 §9).
 *
 * ============================ 동결 계약 파일 ============================
 * 노출 적응의 범위·속도·계량을 한 객체로 묶은 단일 진실이다(core/surfaces.js 머리주석 규약).
 * 어떤 에이전트도 이 파일을 단독으로 수정할 수 없다.
 * 변경이 필요하면 작업을 멈추고 사유와 함께 제안을 보고할 것.
 * 값이 바뀌면 version 을 올리고 CONTRACT-NOTES 해시 기록 · baseline 재기준 · silhouetteaudit 재실행이 따른다(§9-7).
 * =====================================================================
 *
 * 왜 계량까지 묶는가(결정 11): 미터 격자·탭 수·목표식 계수가 바뀌면 범위·속도가 같아도 같은 장면의 EV 판독이 달라진다.
 * 창호지 실루엣 판독 자체가 노출에 달려 있으므로(P4-BRIEF §5-1 ⓐ) 판독에 닿는 값은 전부 한 계약이다.
 *
 * 소비 규칙:
 *  - 유니폼 값(evMin·evMax·kneeSlope·rateUp·rateDown·ec·centerWeight)은 `ExposureMeter._applyContract()` 가 매 프레임 쓴다.
 *  - 셰이더 상수(floorOffset·k·meterN·reduceN·tapsPerAxis)는 `exposure.js` 템플릿으로 주입한다 — 리터럴로 다시 쓰지 않는다
 *    (test/exposure-contract.test.mjs 의 떠도는 리터럴 검출기가 잡는다).
 *  - 런타임 일치 검사는 그리기 시점 값과 컴파일 대상 셰이더 문자열을 이 객체와 대조한다(`exposure.contractCheck()`).
 *
 * 값의 뜻 (실측 근거: CONTRACT-NOTES C4 「노출」, 707-712):
 *  range.evMin/evMax: 적응 EV100 클램프 — 야간이 중회색으로 끌려 올라가지 않게 하한을 둔다.
 *  range.kneeSlope: evMin 아래는 이 기울기로만 적응(무릎 하한). 하드 하한은 주간 실내를 야간처럼 만들었다(스윕4).
 *  range.floorOffset: 무릎 아래 하드 하한 = evMin − floorOffset.
 *  speed.rateUp/rateDown: 적응 속도(1/s) — 밝아질 때 빠르고 어두워질 때 느리다(시각 적응 비대칭).
 *  metering.ec: 노출 보정 EV(+가 밝게) — 미터가 아니라 블룸·출력 패스가 읽는다.
 *  metering.centerWeight: 축소 패스 중앙 1.0 → 모서리 가중(FPS 시선 중심 우선).
 *  metering.k: 목표식 EV100 = log2(k · L_avg) 의 계수(S/K = 100/12.5).
 *  metering.meterN/reduceN/tapsPerAxis: 미터 격자 64² · 축소 8² · 셀당 탭 4×4.
 *
 * status: 'provisional' = 착수 시 현재값 구조 동결(§9-7 ①). 'contract' 는 E1–E4 근거를 본 **발주자 확정 후**에만 쓴다.
 * 이 파일은 three 를 import 하지 않는다 — 노드 도구(playtest 의 노드 해시 대조, 테스트)가 같은 파일을 직접 읽는다.
 */

/** 객체 트리 전체를 얼린다 — 중첩 대입도 엄격 문맥에서 TypeError, 비엄격 문맥에서 조용히 무시된다(값 불변) */
function deepFreeze(o) {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

export const EXPOSURE_CONTRACT = deepFreeze({
  version: 1,
  status: 'provisional', // 'contract' = 발주자 확정 후 (§9-7 ③)
  range: { evMin: 1.0, evMax: 14.0, kneeSlope: 0.2, floorOffset: 3.0 },
  speed: { rateUp: 3.0, rateDown: 1.5 },
  metering: { ec: 1.0, centerWeight: 0.35, k: 8, meterN: 64, reduceN: 8, tapsPerAxis: 4 },
  provenance: {
    values: 'pipeline.js:51 + exposure.js:25-26,36,83,85 (현재값)',
    evidence: ['CONTRACT-NOTES:707-712'],
    decided: null, // 발주자 확정 시 날짜·근거(exposureprobe E1–E4)
  },
});

/** 키 정렬 JSON — 키 순서·공백과 무관하게 같은 계약이면 같은 문자열 (해시 입력) */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/* FNV-1a 32비트 (harness getProgramList 와 같은 상수) — UTF-8 바이트 기준이라 노드·브라우저가 같은 값을 낸다 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_WIDTH = 8;

/** 계약 해시 — 페이지(contractCheck)·노드(playtest 대조)·CONTRACT-NOTES 기록이 같은 함수로 같은 값을 낸다 */
export function exposureContractHash(contract = EXPOSURE_CONTRACT) {
  const bytes = new TextEncoder().encode(canonicalJson(contract));
  let h = FNV_OFFSET;
  for (const b of bytes) h = Math.imul(h ^ b, FNV_PRIME) >>> 0;
  return h.toString(16).padStart(HEX_WIDTH, '0');
}
