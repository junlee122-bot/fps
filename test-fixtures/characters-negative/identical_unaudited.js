/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: '선언 예외 쌍의 한쪽이 감사 대상이 아니다', base: 'heungbu', id: 'neg_identical_unaudited', ops: [['set', 'silhouette.audit', false]], expect: ['identicalTo.audit'] });
