/**
 * src/actors/data/roster.js — 로스터 순서(= 캐릭터 인덱스, 설계서 §1-2).
 * import 줄과 배열만 둔다(actor-data 테스트의 roster 린트). 검증·해석은 index.js 가 한다.
 * 순서를 바꾸면 캐릭터 인덱스·풀 메시 순서·해시가 바뀐다 — 추가는 끝에만.
 */
import jara from './characters/jara.js';
import dokkaebi from './characters/dokkaebi.js';
import tokki from './characters/tokki.js';
import kongjwi from './characters/kongjwi.js';

export const ROSTER_DEFS = Object.freeze([jara, dokkaebi, tokki, kongjwi]);
