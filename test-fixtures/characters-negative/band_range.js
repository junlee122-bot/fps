/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '밴드 구간이 0 ≤ v0 < v1 ≤ 1 이 아니다',
  base: 'jara',
  id: 'neg_band_range',
  ops: [
    ['set', 'shape.primitives.0.bands.0.v1', 1.5],
  ],
  expect: ['band.range'],
});
