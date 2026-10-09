/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '자기 자신과의 동일 선언',
  base: 'heungbu',
  id: 'neg_identical_self',
  ops: [
    ['set', 'silhouette.identicalTo.0', { state: 'default', character: 'neg_identical_self', characterState: 'default', reason: 'P4-BRIEF §4-1-C' }],
  ],
  expect: ['identicalTo.self'],
});
