/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '원시 25 > PRIMS_PER_ACTOR_MAX 24 — 차폐 텍스처 행 수 초과',
  base: 'jara',
  id: 'neg_prims_25',
  ops: [
    [
      'push',
      'shape.primitives',
      { id: 'extra_0', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_1', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_2', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_3', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_4', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_5', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_6', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
    [
      'push',
      'shape.primitives',
      { id: 'extra_7', bone: 'chest', kind: 'rc', a: [0, 0, 0], b: [0, 0.1, 0], ra: 0.03, rb: 0.03, slot: 'cloth', surface: 'FABRIC', zone: 'torso' },
    ],
  ],
  expect: ['prims.count'],
});
