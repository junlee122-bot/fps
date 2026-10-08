/** 음성 fixture — 순수 데이터(base 정의에 ops 를 적용, test/actor-data.test.mjs). why 가 잡아야 할 규칙이다. */
export default Object.freeze({ why: 'identicalTo 상대 캐릭터가 없다', base: 'heungbu', id: 'neg_identical_ref', ops: [['set', 'silhouette.identicalTo.0.character', 'nobody']], expect: ['identicalTo.ref'] });
