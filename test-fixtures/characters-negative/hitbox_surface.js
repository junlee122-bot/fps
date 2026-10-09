/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'hitbox 원시의 표면이 FABRIC 이 아니다(결정 #9 후보 HITBOX_SURFACE)',
  base: 'jara',
  id: 'neg_hitbox_surface',
  ops: [
    ['set', 'shape.primitives.1.surface', 'BRONZE'],
  ],
  expect: ['prim.hitboxSurface'],
});
