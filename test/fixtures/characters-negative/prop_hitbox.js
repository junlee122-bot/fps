/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'zone \'prop\' 원시가 hitbox:true — 무기는 판정에 쓰지 않는다(§2-3)',
  base: 'jara',
  id: 'neg_prop_hitbox',
  ops: [['set', 'shape.primitives.15.hitbox', true]],
  expect: ['prim.propHitbox'],
});
