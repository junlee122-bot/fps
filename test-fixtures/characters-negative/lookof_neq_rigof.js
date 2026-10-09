/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'lookOf ≠ rigOf — 풀 메시는 캐릭터당 그 look 1개(§3-8, 재검토 #10)',
  base: 'heungbu',
  id: 'neg_lookof_neq_rigof',
  ops: [['set', 'appearance.states.disguise.lookOf', 'self']],
  expect: ['appearance.lookOf'],
});
