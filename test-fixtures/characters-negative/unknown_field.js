/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '원시에 모르는 필드 — 오타가 조용히 무시되지 않아야 한다', base: 'jara', id: 'neg_unknown_field', ops: [['set', 'shape.primitives.0.colour', 'red']], expect: ['field.unknown'] });
