/**
 * src/materials/hanji.js — HANJI 동적 투과율 상태 (P2A-BRIEF §5).
 *
 * materials 서브시스템의 첫 파일. 상태(판별 피격 누적·구멍 목록·불투명도)는
 * 여기가 소유하고, 변화는 `surface:opacity` 이벤트로만 발행한다 —
 * render가 구독해 머티리얼에 반영한다 (ARCHITECTURE §3).
 *
 * 크로스 서브시스템 import 금지: core만 import한다. 판(pane) 목록은
 * main.js가 씬 순회로 찾아 register()로 주입한다.
 *
 * 결정성: 이 모듈은 난수를 쓰지 않는다 — 구멍 위치는 탄도 실측 히트에서
 * 온다(그 쪽 산포가 시드 PRNG). resetState 경로에서 reset()이 전 판을
 * 부팅 상태로 되돌리고 복원 이벤트를 재발행한다.
 */

import { bus } from '../core/events.js';

/** P0 동결 기본 불투명도 (kit makeMaterials HANJI와 동일 값 — 조정 금지 계약) */
export const HANJI_BASE_OPACITY = 0.62;
/** 완파 직전 하한 — 완전 투명은 P2B 국소 붕괴(breach) 소관 */
export const HANJI_MIN_OPACITY = 0.08;
/** 피격 1회당 불투명도 감소 (창호 한 짝 ~9발에 하한 도달) */
export const HANJI_OPACITY_PER_HIT = 0.06;

export class HanjiState {
  constructor() {
    /** paneId(가시 메시 이름) → { hits, opacity, holes: [{u,v}] } */
    this.panes = new Map();
  }

  /** 부팅 시 main.js가 가시 창호지 판마다 호출 */
  register(paneId) {
    if (this.panes.has(paneId)) throw new Error(`hanji pane already registered: ${paneId}`);
    this.panes.set(paneId, { hits: 0, opacity: HANJI_BASE_OPACITY, holes: [] });
  }

  /**
   * 피격 기록. 탄도 배선이 HANJI 히트마다 호출한다.
   * localUV: 판 로컬 0..1 (구멍 위치 — P3 시각 산란의 입력, P2A는 저장만).
   */
  registerHit(paneId, localUV) {
    const p = this.panes.get(paneId);
    if (!p) throw new Error(`unknown hanji pane: ${paneId}`); // PATCH-001-D: 조용한 무시 금지
    p.hits++;
    p.holes.push({ u: localUV[0], v: localUV[1] });
    const next = Math.max(HANJI_MIN_OPACITY, HANJI_BASE_OPACITY - p.hits * HANJI_OPACITY_PER_HIT);
    if (next !== p.opacity) {
      p.opacity = next;
      bus.emit('surface:opacity', { surfaceId: paneId, opacity: next });
    }
    return p;
  }

  /** resetState 경로 — 전 판 부팅 상태 복원 + 복원 이벤트 재발행 */
  reset() {
    for (const [paneId, p] of this.panes) {
      const wasDirty = p.hits > 0;
      p.hits = 0;
      p.holes.length = 0;
      p.opacity = HANJI_BASE_OPACITY;
      if (wasDirty) bus.emit('surface:opacity', { surfaceId: paneId, opacity: HANJI_BASE_OPACITY });
    }
  }

  snapshot() {
    const out = {};
    for (const [id, p] of this.panes) {
      if (p.hits > 0) out[id] = { hits: p.hits, opacity: +p.opacity.toFixed(4) };
    }
    return out;
  }
}
