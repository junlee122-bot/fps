/**
 * src/audio/propagation.js — 두 번째 경로(우회) 인터페이스 (P4-BRIEF §2-2, TAB-B §3).
 *
 * P4A 는 **인터페이스만** 만든다. 그래프는 P4B 공간 그래프(방·마당 = 노드, 문·열린 곳 = 간선)가
 * 구현하고, 이동·사격·소리가 그 하나를 공유한다 — 오디오는 그래프를 새로 만들지 않는다.
 * 그래프가 없으면(기본) 직선 경로만으로 완전히 동작한다.
 *
 * P4B 가 AudioSystem.setPropagationGraph(graph) 로 넘길 객체의 계약:
 *
 *   graph.findDetours(sourcePos, listenerPos) → Array<{
 *     apparentPos: [x,y,z],   // 청자 쪽 **마지막 열린 곳**의 위치 — 소리가 여기서 들린다
 *     pathLength:  number,    // 음원 → 열린 곳들 → 청자 경로 길이 (m)
 *     turns:       number,    // 꺾임 횟수 (열린 곳을 돌아 나간 수)
 *   }>
 *
 * 구멍이 뚫리면(§4-3 장독, editHoles) 그래프 간선이 바뀌고, 오디오는 다음 findDetours 에서
 * 그 결과를 그대로 받는다 — 오디오 쪽 코드는 바뀌지 않는다.
 */

/** 꺾임 1회당 회절 손실(dB) · 고역 차단 — 1단계 잠정값 */
export const DETOUR = Object.freeze({
  turnCostDb: 4,
  cutoffHz: 7000,       // 꺾임 0 기준. 꺾일 때마다 반으로
  maxDetours: 2,        // 음원당 우회 음성 상한
});

/** 그래프 없음 — 직선 경로만 */
export const NO_GRAPH = Object.freeze({ findDetours: () => [] });

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

/**
 * 우회 경로 하나의 응답.
 * 패너는 apparentPos 에 놓이므로 청자-열린 곳 거리의 거리 감쇠는 패너가 한다.
 * 여기서는 나머지(음원 → 열린 곳 구간의 여분 거리 + 꺾임 비용)만 더한다.
 */
export function detourResponse(d, listenerPos) {
  if (!Array.isArray(d.apparentPos) || !(d.pathLength > 0)) throw new Error('audio detour: malformed detour');
  const near = Math.max(1, dist(d.apparentPos, listenerPos));
  const extraDb = -20 * Math.log10(Math.max(1, d.pathLength / near));
  const turns = Math.max(0, d.turns | 0);
  return {
    pos: d.apparentPos.slice(),
    gainDb: extraDb - DETOUR.turnCostDb * turns,
    cutoffHz: DETOUR.cutoffHz / 2 ** turns,
  };
}

/** 그래프 호출 + 상한 · 정렬(큰 소리 우선, 결정적 동순위: 원래 순서) */
export function collectDetours(graph, sourcePos, listenerPos) {
  const list = (graph ?? NO_GRAPH).findDetours(sourcePos, listenerPos) ?? [];
  return list
    .map((d, i) => ({ r: detourResponse(d, listenerPos), i }))
    .sort((a, b) => (b.r.gainDb - a.r.gainDb) || (a.i - b.i))
    .slice(0, DETOUR.maxDetours)
    .map((x) => x.r);
}
