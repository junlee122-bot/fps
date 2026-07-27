/**
 * src/fx/placeholder.js — P2A 허용 유일 FX: 피격 지점 단색 회색 마커.
 *
 * 규칙 (P2A-BRIEF §6): 파티클·데칼·예광·총구화염·트랜지언트 라이트 금지.
 * 피격 지점에 회색 마커 1개, **프레임 종료 시 즉시 제거**. ballistic:hit을
 * 구독만 하고 상태를 남기지 않으므로 다음 프레임 픽셀에 영향이 없다
 * (마커가 렌더된 프레임 자체는 발사가 결정적이므로 역시 결정적이다).
 *
 * 머티리얼은 기존 회색 프로그램과 동일 파라미터의 MeshStandardMaterial —
 * 새 셰이더 순열을 만들지 않아 프리웜 커버리지를 깨지 않는다.
 */

import * as THREE from 'three';
import { bus } from '../core/events.js';

const MARKER_SIZE = 0.06; // m
const POOL_SIZE = 16;     // 산탄 9펠릿 + 다층 히트 여유

export class FxPlaceholder {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = 0;
    const geo = new THREE.BoxGeometry(MARKER_SIZE, MARKER_SIZE, MARKER_SIZE);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.92, metalness: 0 });
    mat.name = 'FX_MARKER';
    for (let i = 0; i < POOL_SIZE; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.name = `fx_marker_${i}`;
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      scene.add(m); // 부팅 시 씬 상주(비가시) — 프리웜이 머티리얼을 커버
      this.pool.push(m);
    }
    this._unsub = bus.on('ballistic:hit', (e) => this.onHit(e));
  }

  onHit(e) {
    if (this.active >= POOL_SIZE) return; // 마커는 시각 힌트일 뿐 — 초과분 무시
    const m = this.pool[this.active++];
    m.position.set(e.worldPos[0], e.worldPos[1], e.worldPos[2]);
    m.visible = true;
  }

  /** 프레임 종료 훅 — 렌더 직후 호출 (harness renderFrame 경로) */
  endFrame() {
    for (let i = 0; i < this.active; i++) this.pool[i].visible = false;
    this.active = 0;
  }

  /** resetState 경로 — 이월 마커 방지 */
  reset() {
    this.endFrame();
  }
}
