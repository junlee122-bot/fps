/**
 * src/core/prewarm.js — 셰이더 프리웜 (HARNESS.md §7, v0부터).
 *
 * 부팅 시 존재하는 모든 프로그램 순열을 강제 컴파일해 플레이 중
 * 지연 컴파일 스톨을 0으로 만든다.
 *
 * 참조 레포에서 실측된 두 가지 함정을 반영한다:
 *  1. compileAsync만으로는 그림자 깊이 패스 변형이 컴파일되지 않는다 →
 *     실제 프레임을 그려야 한다. P0은 모든 샷 구성(태양각·등롱 온오프)을
 *     1프레임씩 실제 렌더해 샷 공간 전체의 순열을 커버한다.
 *  2. 프로그램 캐시 키는 바인딩된 렌더타깃의 컬러스페이스·톤매핑을 포함한다.
 *     P0은 캔버스에 직접 그리므로 캔버스 바인딩 상태의 컴파일이 곧 정답이다.
 *     (P3에서 HDR 타깃이 생기면 타깃 바인딩 컴파일을 추가해야 한다.)
 *
 * 프리웜은 시뮬레이션을 건드리지 않는다 — 렌더만 한다. 잔여물(카메라·조명)은
 * 호출자가 복원하고, 하네스 캡처는 어차피 resetState → setShot으로 시작한다.
 */

import { clock } from './clock.js';

export async function prewarmShaders({ renderer, scene, camera, shots, applyShot, restoreDefault, renderFrame = null }) {
  // P3: HDR 파이프라인이 있으면 renderFrame(파이프라인 전체 체인)으로 렌더한다 —
  // HDR 타깃 바인딩 순열 + GTAO/TAA/MB/Output 패스 프로그램까지 커버 (머리주석 2항)
  const draw = renderFrame ?? (() => renderer.render(scene, camera));
  const t0 = clock.wallNowMs();
  const before = renderer.info.programs?.length ?? 0;

  // 1) 현재 씬 그래프의 포워드 패스 순열
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    try { renderer.compile(scene, camera); } catch { /* 프리웜 실패가 부팅을 막으면 안 된다 */ }
  }

  // 2) 샷 구성별 실제 1프레임 렌더 — 그림자 깊이(CSM 캐스케이드별)·라이트 순열 커버
  for (const shot of shots) {
    applyShot(shot);
    draw();
    // 프로토콜/메인스레드 양보 (렌더 결과에는 영향 없음)
    await new Promise((r) => setTimeout(r, 0));
  }

  restoreDefault();
  draw();

  const after = renderer.info.programs?.length ?? 0;
  return {
    ok: true,
    ms: Math.round(clock.wallNowMs() - t0),
    programsBefore: before,
    programsAfter: after,
    compiled: after - before,
  };
}
