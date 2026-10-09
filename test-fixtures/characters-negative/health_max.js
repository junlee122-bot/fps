/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '체력 상한이 양수가 아니다',
  base: 'jara',
  id: 'neg_health_max',
  ops: [
    ['set', 'body.health.max', 0],
  ],
  expect: ['body.health'],
});
