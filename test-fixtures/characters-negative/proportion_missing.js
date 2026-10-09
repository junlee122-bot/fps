/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '골격 비례 키가 빠졌다(shin)',
  base: 'jara',
  id: 'neg_proportion_missing',
  ops: [
    ['set', 'skeleton.proportions', { hip: 0.55, spine: 0.12, chest: 0.18, neck: 0.12, upperArm: 0.24, foreArm: 0.22, thigh: 0.26 }],
  ],
  expect: ['field.missing'],
});
