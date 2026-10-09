/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '래그돌 질량 묶음 키가 템플릿에 없다',
  base: 'jara',
  id: 'neg_mass_scale_key',
  ops: [
    ['set', 'ragdoll.massScale', { tail: 1.2 }],
  ],
  expect: ['ragdoll.massScale'],
});
