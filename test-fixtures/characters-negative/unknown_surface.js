/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '원시 표면이 SURFACES 에 없다(§2-5 규칙 4)', base: 'jara', id: 'neg_unknown_surface', ops: [['set', 'shape.primitives.0.surface', 'MARBLE']], expect: ['surface.unknown'] });
