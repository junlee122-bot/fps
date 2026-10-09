/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '래그돌 질량 배율이 양수가 아니다',
  base: 'jara',
  id: 'neg_mass_scale_value',
  ops: [
    ['set', 'ragdoll.massScale.chest', 0],
  ],
  expect: ['ragdoll.massScale'],
});
