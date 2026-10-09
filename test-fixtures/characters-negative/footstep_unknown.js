/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '발소리 프로파일이 주입 목록에 없다',
  base: 'jara',
  id: 'neg_footstep_unknown',
  ops: [
    ['set', 'audio.footstep', 'wooden_clog'],
  ],
  expect: ['audio.footstep'],
});
