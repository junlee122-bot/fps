/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 순환 a → b → a',
  base: 'jara',
  id: 'neg_appearance_cycle',
  ops: [['set', 'appearance.states.default', { rigOf: 'neg_cycle_b', lookOf: 'neg_cycle_b', team: 'self' }]],
  expect: ['appearance.cycle'],
  extra: [{ base: 'jara', id: 'neg_cycle_b', ops: [['set', 'appearance.states.default', { rigOf: 'neg_appearance_cycle', lookOf: 'neg_appearance_cycle', team: 'self' }]] }],
});
