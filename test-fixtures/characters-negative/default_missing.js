/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 \'default\' 상태 필수',
  base: 'jara',
  id: 'neg_default_missing',
  ops: [['set', 'appearance.states', { other: { rigOf: 'self', lookOf: 'self', team: 'self' } }]],
  expect: ['appearance.default'],
});
