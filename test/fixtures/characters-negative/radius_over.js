/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '반경 0.40 > 0.34 — 내아 동문 0.7425 m 를 못 지난다(심사 A-3)', base: 'jara', id: 'neg_radius_over', ops: [['set', 'body.capsule.radius', 0.4]], expect: ['capsule.radius'] });
