/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '무기 뼈(pose.aim.propBone)가 손목이 아니다',
  base: 'jara',
  id: 'neg_prop_bone_aim',
  ops: [
    ['set', 'pose.aim.propBone', 'head'],
  ],
  expect: ['pose.propBone'],
});
