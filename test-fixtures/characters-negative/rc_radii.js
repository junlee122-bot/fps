/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'rc |ra − rb| ≥ |b − a| — 한쪽 구가 다른 쪽을 삼켜 원뿔대가 없다', base: 'jara', id: 'neg_rc_radii', ops: [['set', 'shape.primitives.3.ra', 0.3]], expect: ['prim.rc'] });
