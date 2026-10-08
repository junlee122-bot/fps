/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'dangle 사슬에 예약 뼈가 아닌 뼈',
  base: 'jara',
  id: 'neg_dangle_nonreserved',
  ops: [['set', 'pose.dangle', [{ chain: ['head'], stiffness: 0.5, damping: 0.1 }]]],
  expect: ['pose.dangle'],
});
