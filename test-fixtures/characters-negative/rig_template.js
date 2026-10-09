/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'rigOf 대상 골격 템플릿이 다르다 — 슬롯 Skeleton 공유 불가(§3-4)',
  base: 'tokki',
  id: 'neg_rig_template',
  ops: [
    ['set', 'skeleton.template', 'biped_alt'],
    ['set', 'ragdoll.template', 'biped_alt'],
    ['set', 'appearance.states.mimic', { rigOf: 'jara', lookOf: 'jara', team: 'opponent' }],
  ],
  expect: ['appearance.template'],
  skeletons: ['biped_alt'],
});
