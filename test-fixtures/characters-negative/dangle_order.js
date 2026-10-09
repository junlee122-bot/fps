/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'dangle 사슬이 부모 → 자식 순서가 아니다',
  base: 'simcheong',
  id: 'neg_dangle_order',
  ops: [
    ['set', 'pose.dangle.0.chain', ['dangle_1', 'dangle_0']],
  ],
  expect: ['pose.dangle'],
});
