/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '밴드 slot 이 look.slots 에 없다',
  base: 'jara',
  id: 'neg_band_slot',
  ops: [
    ['set', 'shape.primitives.0.bands.0.slot', 'gold'],
  ],
  expect: ['band.slot'],
});
