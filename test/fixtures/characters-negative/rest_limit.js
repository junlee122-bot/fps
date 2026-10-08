/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '휴지 목 굽힘 24° 가 덮어쓴 한계 [30, 70] 밖 — 활성화 순간 구속이 자세를 튕긴다',
  base: 'jara',
  id: 'neg_rest_limit',
  ops: [['set', 'ragdoll.limits', { neck: [30, 70] }]],
  expect: ['ragdoll.restLimit'],
});
