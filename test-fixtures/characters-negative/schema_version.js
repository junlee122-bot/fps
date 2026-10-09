/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'schema ≠ 1', base: 'jara', id: 'neg_schema_version', ops: [['set', 'schema', 2]], expect: ['schema.version'] });
