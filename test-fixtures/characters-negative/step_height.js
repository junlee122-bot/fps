/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'stepHeight ≠ 0.42 — 디딤 높이가 캐릭터별이면 내비 굽기 1회가 깨진다', base: 'jara', id: 'neg_step_height', ops: [['set', 'body.capsule.stepHeight', 0.5]], expect: ['capsule.stepHeight'] });
