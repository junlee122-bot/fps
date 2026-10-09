/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '진영 열거 밖', base: 'jara', id: 'neg_faction_enum', ops: [['set', 'faction', 'neutral']], expect: ['faction.enum'] });
