/**
 * src/render/opacity.js — surface:opacity 구독자 (P2A-BRIEF §5).
 *
 * materials(hanji.js)가 상태를 소유하고 이벤트를 발행하면, render는 여기서
 * THREE 머티리얼에 반영만 한다 (ARCHITECTURE §3 소유 경계).
 *
 * 판마다 머티리얼을 부팅 시 1회 클론한다 — 공유 머티리얼을 그대로 쓰면
 * 판 하나의 피격이 모든 창호지의 불투명도를 바꾼다. 클론은 파라미터가
 * 동일하므로 셰이더 프로그램이 갈라지지 않고(동일 순열), 부팅 시점 값도
 * 동일해 픽셀 중립이다.
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
    }
    bus.on('surface:opacity', (e) => this.apply(e.surfaceId, e.opacity));
  }

  apply(paneId, opacity) {
    const mesh = this.panes.get(paneId);
    if (!mesh) throw new Error(`surface:opacity for unknown pane: ${paneId}`); // PATCH-001-D
    mesh.material.opacity = opacity;
  }

  /** resetState 방어선 — materials.reset()이 이벤트로 복원하지만, 이중 안전 */
  restoreAll() {
    for (const [id, mesh] of this.panes) mesh.material.opacity = this.base.get(id);
  }
}
