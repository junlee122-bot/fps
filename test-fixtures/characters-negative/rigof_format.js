/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: "외견 참조(lookOf)가 'self' 도 캐릭터 id 형식도 아니다",
  base: 'jara',
  id: 'neg_rigof_format',
  ops: [
    ['set', 'appearance.states.default.lookOf', 'Jara!'],
  ],
  expect: ['appearance.ref'],
});
