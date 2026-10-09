/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '예약 dangle 뼈에 원시를 달았는데 pose.dangle 사슬이 없다 — 휴지 자리에 고정된 죽은 뼈',
  base: 'jara',
  id: 'neg_reserved_bone',
  ops: [['set', 'shape.primitives.4.bone', 'dangle_0']],
  expect: ['prim.reservedBone'],
});
