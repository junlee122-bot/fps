/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '스킬 시간이 양수도 null 도 아니다',
  base: 'jara',
  id: 'neg_skill_timing',
  ops: [
    ['set', 'skills.0.cooldownS', -3],
  ],
  expect: ['skill.timing'],
});
