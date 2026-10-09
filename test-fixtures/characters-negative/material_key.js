/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '재질 키가 주입 목록에 없다(VM_GUNMETAL 계열 금속은 검토 #8 로 제외)',
  base: 'jara',
  id: 'neg_material_key',
  ops: [['set', 'look.slots.metal.material', 'ACTOR_GUNMETAL']],
  expect: ['look.materialKey'],
});
