/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '캡슐 height < 2r + 0.05 — 줄기 없는 캡슐은 천장 검사가 공허(character.js:119-130)',
  base: 'jara',
  id: 'neg_height_short',
  ops: [['set', 'body.capsule.height', 0.72], ['set', 'body.capsule.crouchHeight', 0.72]],
  expect: ['capsule.height', 'capsule.crouchHeight'],
});
