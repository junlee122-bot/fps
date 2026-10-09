/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'look slot tileMeters 가 양수가 아니다',
  base: 'jara',
  id: 'neg_tile_meters',
  ops: [
    ['set', 'look.slots.cloth.tileMeters', 0],
  ],
  expect: ['look.tile'],
});
