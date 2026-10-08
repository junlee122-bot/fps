/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '무기 계열 3종 밖 — 고유 무기 금지(P4-BRIEF §4-6)', base: 'jara', id: 'neg_weapon_family', ops: [['set', 'weapon.family', 'BOW']], expect: ['weapon.family'] });
