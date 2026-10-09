/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'identicalTo 근거 문자열이 비었다',
  base: 'heungbu',
  id: 'neg_identical_reason',
  ops: [
    ['set', 'silhouette.identicalTo.0.reason', ''],
  ],
  expect: ['identicalTo.reason'],
});
