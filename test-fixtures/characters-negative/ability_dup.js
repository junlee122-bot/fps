/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '이동 능력 중복',
  base: 'jara',
  id: 'neg_ability_dup',
  ops: [
    ['push', 'movement.abilities', 'walk'],
  ],
  expect: ['movement.abilities'],
});
