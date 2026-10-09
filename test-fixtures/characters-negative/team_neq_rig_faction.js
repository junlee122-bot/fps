/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({
  why: '외견 팀(self = 인간계) ≠ rigOf 대상(도깨비) 진영 — 풀 재질 {team} 은 부팅 고정',
  base: 'heungbu',
  id: 'neg_team_neq_rig_faction',
  ops: [['set', 'appearance.states.disguise.team', 'self']],
  expect: ['appearance.teamFaction'],
});
