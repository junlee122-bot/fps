/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 상태 이름 형식 위반',
  base: 'jara',
  id: 'neg_state_name',
  ops: [
    ['set', 'appearance.states.Bad_State', { rigOf: 'self', lookOf: 'self', team: 'self' }],
  ],
  expect: ['appearance.stateName'],
});
