/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '닫힌 원시 효과 6종 밖(P4-BRIEF §4-1-B)', base: 'jara', id: 'neg_skill_primitive', ops: [['set', 'skills.0.primitive', 'fireball']], expect: ['skill.primitive'] });
