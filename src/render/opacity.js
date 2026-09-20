/**
 * src/render/opacity.js — surface:opacity 구독자 (P2A-BRIEF §5 → CONTRACT-PATCH-013-B).
 *
 * materials(hanji.js)가 상태(구멍 목록·찢어짐)를 소유하고 이벤트를 발행하면,
 * render는 여기서 THREE 머티리얼에 반영만 한다 (ARCHITECTURE §3 소유 경계).
 *
 * 판마다 머티리얼을 부팅 시 1회 클론한다 — 공유 머티리얼을 그대로 쓰면
 * 판 하나의 피격이 모든 창호지에 구멍을 낸다. 클론은 파라미터가 동일하므로
 * 셰이더 프로그램이 갈라지지 않고(동일 순열), 부팅 시점 값도 동일해 픽셀 중립이다.
 *
 * [PATCH-013-B] 구멍은 유니폼 배열로 전달한다 — 길이가 고정이라 프로그램 수 불변.
 *   material.opacity 는 이제 **파생값**이다(찢어지면 0). 구멍이 뚫린 자리의 알파는
 *   셰이더가 판 로컬 UV로 직접 깎는다.
 */

import { bus } from '../core/events.js';

export class OpacityApplier {
  /** @param {Map<string, THREE.Mesh>} panes paneId → 가시 창호지 메시 */
  constructor(panes) {
    this.panes = panes;
    this.base = new Map(); // paneId → 부팅 불투명도
    for (const [id, mesh] of panes) {
      mesh.material = mesh.material.clone();
      mesh.material.name = `HANJI@${id}`;
      this.base.set(id, mesh.material.opacity);
      // 판 실제 크기(m) — 구멍 반지름이 m 단위라 UV 이방성을 여기서 보정한다
      const u = mesh.material.userData.hanjiUniforms;
      const g = mesh.geometry.parameters;
      if (u && g) u.uHanjiPaneSize.value.set(g.width, g.height);
    }
    bus.on('surface:opacity', (e) => this.apply(e));
  }

  apply(e) {
    const { surfaceId: paneId, opacity, holes = [], torn = false } = e;
    const mesh = this.panes.get(paneId);
    if (!mesh) throw new Error(`surface:opacity for unknown pane: ${paneId}`); // PATCH-001-D
    mesh.material.opacity = opacity;
    const u = mesh.material.userData.hanjiUniforms;
    if (!u) return;
    // PATCH-005-D: 피격 누적은 투과율과 산란 반경에 함께 반영 — 찢긴 종이일수록 실루엣 흐림이 줄어든다
    const k = Math.max(0, Math.min(1, opacity / this.base.get(paneId)));
    u.uHanjiScatter.value = k * k;
    // PATCH-013-B: 구멍 목록 → 유니폼 배열 (배열 길이는 고정, 유효 개수만 바뀐다)
    const arr = u.uHanjiHoles.value;
    const n = Math.min(holes.length, arr.length);
    for (let i = 0; i < n; i++) arr[i].set(holes[i].u, holes[i].v, holes[i].r);
    u.uHanjiHoleCount.value = torn ? 0 : n; // 찢어지면 판 전체가 사라진다 — 구멍을 따로 팔 필요가 없다
  }

  /** resetState 방어선 — materials.reset()이 이벤트로 복원하지만, 이중 안전 */
  restoreAll() {
    for (const [id, mesh] of this.panes) {
      mesh.material.opacity = this.base.get(id);
      const u = mesh.material.userData.hanjiUniforms;
      if (u) { u.uHanjiScatter.value = 1; u.uHanjiHoleCount.value = 0; }
    }
  }
}
