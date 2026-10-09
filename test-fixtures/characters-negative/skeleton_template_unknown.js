/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '등록되지 않은 골격 템플릿',
  base: 'jara',
  id: 'neg_skeleton_template_unknown',
  ops: [
    ['set', 'skeleton.template', 'quadruped'],
    ['set', 'ragdoll.template', 'quadruped'],
  ],
  expect: ['skeleton.template'],
});
