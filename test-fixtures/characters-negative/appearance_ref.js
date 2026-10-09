/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 rigOf 가 없는 캐릭터',
  base: 'heungbu',
  id: 'neg_appearance_ref',
  ops: [['set', 'appearance.states.disguise', { rigOf: 'nobody', lookOf: 'nobody', team: 'opponent' }]],
  expect: ['appearance.ref'],
});
