/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '건축 재질 키를 액터에 그대로 — \'ACTOR_*\' 가 아니다', base: 'jara', id: 'neg_material_prefix', ops: [['set', 'look.slots.wood.material', 'WOOD_COLUMN']], expect: ['look.material'] });
