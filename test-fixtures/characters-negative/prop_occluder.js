/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '무기 원시(zone \'prop\')가 occluder:false — 판 위 윤곽과 메시가 어긋난다(§2-3)',
  base: 'jara',
  id: 'neg_prop_occluder',
  ops: [
    ['set', 'shape.primitives.15.occluder', false],
  ],
  expect: ['prim.propOccluder'],
});
