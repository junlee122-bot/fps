/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'DECAL 등급 LACQUER 는 탄도 표면이 될 수 없다(결정 9)', base: 'jara', id: 'neg_decal_surface', ops: [['set', 'shape.primitives.1.surface', 'LACQUER']], expect: ['surface.decal'] });
