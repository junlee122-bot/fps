/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'crouchHeight > height', base: 'jara', id: 'neg_crouch_over_height', ops: [['set', 'body.capsule.crouchHeight', 1.3]], expect: ['capsule.crouchHeight'] });
