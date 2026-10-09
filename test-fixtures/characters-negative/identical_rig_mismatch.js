/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'identicalTo 쌍의 해석된 rigOf 불일치(도깨비 리그 ≠ 토끼 리그) — 선언이 사실이 아니다',
  base: 'heungbu',
  id: 'neg_identical_rig_mismatch',
  ops: [['set', 'silhouette.identicalTo.0.character', 'tokki']],
  expect: ['identicalTo.rigOf'],
});
