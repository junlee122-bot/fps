/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '래그돌 템플릿이 골격 템플릿과 다르다',
  base: 'jara',
  id: 'neg_ragdoll_template',
  ops: [
    ['set', 'ragdoll.template', 'biped_alt'],
  ],
  expect: ['ragdoll.template'],
  skeletons: ['biped_alt'],
});
