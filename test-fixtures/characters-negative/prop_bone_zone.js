/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'prop 뼈 원시의 zone 이 \'prop\' 이 아니다',
  base: 'jara',
  id: 'neg_prop_bone_zone',
  ops: [
    ['set', 'shape.primitives.16.zone', 'limb'],
  ],
  expect: ['prim.propZone'],
});
