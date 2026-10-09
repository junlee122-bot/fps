/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: 'family 와 familyChoices 를 함께 — 정확히 하나여야 한다',
  base: 'jara',
  id: 'neg_weapon_both',
  ops: [
    ['set', 'weapon.familyChoices', ['CARBINE', 'DMR']],
  ],
  expect: ['weapon.family'],
});
