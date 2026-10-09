/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '캐릭터 id 형식 [a-z][a-z0-9_]* 위반',
  base: 'jara',
  id: 'neg_id_format',
  ops: [
    ['set', 'id', 'Neg_Id_Format'],
  ],
  expect: ['id.format'],
});
