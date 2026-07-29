/**
 * src/fx/debris.js — 기와 파편 낙하 물리 (P2B §8 / ARCHITECTURE §2 "낙하물이 물리 객체").
 *
 * ROOF_TILE 피격 → 기와장 강체 분리·낙하. fx는 physics를 import하지 않는다 —
 * main.js가 spawn/despawn 콜백을 주입한다 (world의 파사드 주입과 동일 패턴).
 *
 * 결정성: 동시 개수 상한 + 삽입 카운터 기반 FIFO 제거 (§3-3과 동일 규칙).
 * 초기 속도·회전 지터는 시드 스트림. 낙하 강체는 resetState의
 * pruneRuntimeBodies가 걷어낸다 (P2A 감사 A1 인프라 재사용).
 */

import * as THREE from 'three';
import { rngStream } from '../core/rng.js';

export const DEBRIS_CAP = 24;
const TILE_HALF = [0.09, 0.012, 0.065]; // 기와장 절반 치수 (m)

export class TileDebris {
  /**
   * @param {(opts)=>body} spawnBody  main 주입 — physics.addRigidBody + 씬 메시 부착
   * @param {(body)=>void} despawnBody main 주입 — 강체 제거 + 메시 분리
   */
  constructor(spawnBody, despawnBody) {
    this.spawnBody = spawnBody;
    this.despawnBody = despawnBody;
    this.live = []; // 삽입 순서 유지 — FIFO 제거
    this.spawnedTotal = 0;
  }

  _rand() {
    return rngStream('fx:debris')();
  }

  /** ROOF_TILE 피격점에서 기와장 1장 분리 */
  spawnAt(x, y, z, nx, ny, nz, incidentEnergy) {
    if (this.live.length >= DEBRIS_CAP) {
      const oldest = this.live.shift(); // 삽입 순 — 결정적
      this.despawnBody(oldest);
    }
    // 피격 노멀 + 수평 지터 방향으로 튕겨나가 낙하
    const jx = (this._rand() * 2 - 1) * 0.6;
    const jz = (this._rand() * 2 - 1) * 0.6;
    const e = Math.min(1, incidentEnergy / 1800); // 에너지 비례 (카빈 초구 기준 정규화)
    const body = this.spawnBody({
      halfExtents: TILE_HALF,
      position: { x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05 },
      velocity: {
        x: nx * (1.2 + 2.4 * e) + jx,
        y: Math.max(0.8, ny * (1.2 + 2.4 * e)) ,
        z: nz * (1.2 + 2.4 * e) + jz,
      },
      angularVelocity: {
        x: (this._rand() * 2 - 1) * 7,
        y: (this._rand() * 2 - 1) * 4,
        z: (this._rand() * 2 - 1) * 7,
      },
      mass: 1.6,
      surface: 'ROOF_TILE',
    });
    this.live.push(body);
    this.spawnedTotal++;
    return body;
  }

  /** resetState — 전량 제거 (pruneRuntimeBodies와 이중 안전) */
  reset() {
    for (const b of this.live) this.despawnBody(b);
    this.live.length = 0;
    this.spawnedTotal = 0;
  }

  snapshot() {
    return { live: this.live.length, spawnedTotal: this.spawnedTotal };
  }
}
