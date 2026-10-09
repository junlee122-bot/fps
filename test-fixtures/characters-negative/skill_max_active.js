/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '동시 지속 스킬은 1(P4-BRIEF §4-1-D)', base: 'jara', id: 'neg_skill_max_active', ops: [['set', 'skills.0.maxActive', 2]], expect: ['skill.maxActive'] });
