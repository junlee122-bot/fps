/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '예약 능력 climb — 이동·내비 구현 전 사용 불가', base: 'jara', id: 'neg_ability_reserved', ops: [['push', 'movement.abilities', 'climb']], expect: ['ability.reserved'] });
