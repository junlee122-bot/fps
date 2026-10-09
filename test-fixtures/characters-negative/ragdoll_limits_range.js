/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '래그돌 거리 한계가 [min, max] 0 ≤ min < max ≤ 180 이 아니다',
  base: 'jara',
  id: 'neg_ragdoll_limits_range',
  ops: [
    ['set', 'ragdoll.limits', { knee: [50, 10] }],
  ],
  expect: ['ragdoll.limits'],
});
