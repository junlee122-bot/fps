/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 팀 표시가 \'self\'|\'opponent\' 밖',
  base: 'jara',
  id: 'neg_appearance_team_enum',
  ops: [
    ['set', 'appearance.states.default.team', 'ally'],
  ],
  expect: ['appearance.team'],
});
