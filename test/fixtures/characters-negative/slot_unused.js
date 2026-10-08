/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '어느 원시도 쓰지 않는 slot — 그룹 ↔ slot 완전(§3-9)',
  base: 'jara',
  id: 'neg_slot_unused',
  ops: [['set', 'look.slots.spare', { material: 'ACTOR_FABRIC', tileMeters: 0.3 }]],
  expect: ['look.unused'],
});
