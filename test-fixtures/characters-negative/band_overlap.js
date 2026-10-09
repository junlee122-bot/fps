/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '같은 원시의 밴드 구간이 겹친다',
  base: 'jara',
  id: 'neg_band_overlap',
  ops: [['push', 'shape.primitives.2.bands', { slot: 'accent', v0: 0.5, v1: 0.7, mode: 'stripe' }]],
  expect: ['band.overlap'],
});
