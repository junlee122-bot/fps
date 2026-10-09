/**
 * src/actors/data/freeze.js — 데이터 묶음 공용 깊은 동결.
 *
 * 캐릭터 정의 파일은 최상위만 `Object.freeze` 한다(설계서 §2-1 형식). 중첩 객체까지 막아야
 * 레지스트리 밖 코드가 원시 수치를 고쳐 메시·차폐·히트가 서로 다른 값을 보는 일이 구조로
 * 사라진다(§4-3 일치 보장 1). 형식 배열(typed array)은 동결할 수 없으므로 데이터에 두지 않는다.
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) {
    throw new TypeError('deepFreeze: 형식 배열은 동결할 수 없다 — 데이터에는 일반 배열만 둔다');
  }
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

/** 깊은 동결 여부(테스트·부팅 단언용) */
export function isDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value)) if (!isDeepFrozen(value[key])) return false;
  return true;
}
