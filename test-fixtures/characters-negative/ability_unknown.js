/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '닫힌 능력 목록 밖', base: 'jara', id: 'neg_ability_unknown', ops: [['push', 'movement.abilities', 'fly']], expect: ['ability.unknown'] });
