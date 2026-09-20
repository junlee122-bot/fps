/**
 * src/materials/hanji.js — HANJI 구멍 목록 상태 (P2A-BRIEF §5 → CONTRACT-PATCH-013-B).
 *
 * materials 서브시스템의 첫 파일. 상태(판별 구멍 목록·찢어짐)는 여기가 소유하고,
 * 변화는 `surface:opacity` 이벤트로만 발행한다 — render가 구독해 머티리얼
 * 유니폼에 반영한다 (ARCHITECTURE §3).
 *
 * [PATCH-013-B] 모델 교체 — 이것은 시각 결함이 아니라 **게임 규칙 결함**이었다.
 *   종전: 피격마다 판 전체 불투명도 −.09, 하한 .08. 판 전체가 균일하게 비쳐서
 *         "맞은 자리에 구멍이 난다"는 규칙이 코드에 없었다. 엄폐 뒤 관측이라는
 *         메커닉이 성립하지 않는다.
 *   현재: 판마다 **구멍 목록** `[{u,v,r}]`이 상태이고 불투명도는 파생값이다.
 *         구멍은 탄착 UV에 그 자리에만 뚫린다. 셰이더는 해석적 유니폼 배열로
 *         구멍을 파므로 프로그램 수는 불변이다(텍스처·순열 증가 없음).
 *
 * [PATCH-014-B] 찢어져도 **콜라이더는 유지**한다 — 찢어짐은 시각·시야 메커닉이지
 *   통행 메커닉이 아니다. 탄도는 P2A 관통표 그대로다.
 * [PATCH-014-C] 반지름은 무기별 상수이고 값은 **판독 동작**으로 실측한다.
 *
 * 크로스 서브시스템 import 금지: core만 import한다. 판 목록은 main.js가 씬
 * 순회로 찾아 register()로 주입한다.
 *
 * 결정성: 난수를 쓰지 않는다 — 구멍 위치는 탄도 실측 히트에서 온다(그 쪽 산포가
 * 시드 PRNG). resetState 경로에서 reset()이 전 판을 부팅 상태로 되돌린다.
 */

import { bus } from '../core/events.js';

/**
 * 기본 불투명도 — P1.5-BRIEF §2: 동결 대상은 surfaces.js의 translucent/dynamicOpacity **플래그**이고 값은 P3가 조정한다
 * (CONTRACT-PATCH-005-D). .62(P0 잠정값)는 착색 유리로 읽혔다 → .95: 종이는 거의 불투명한 확산 투과체이고 배면광은 발광으로 넣는다
 * (materials/index.js applyHanjiTransmit). kit makeMaterials HANJI 호환값과 동일하게 유지한다.
 */
export const HANJI_BASE_OPACITY = 0.95;

/**
 * 무기별 구멍 반지름 (m) — PATCH-014-C. 탄자 구경이 아니라 **판독 동작**으로 정한 값이다:
 *   카빈 구멍 1개는 2.5 m에서 판독 불가(대비 < .15), 여러 개가 모이면 쓸 만한 시야.
 * 실측 절차와 값은 docs/CONTRACT-NOTES.md "구멍 반지름 실측"에 기록한다.
 */
export const HANJI_HOLE_RADIUS = Object.freeze({ CARBINE: 0.026, SHOTGUN: 0.017, DMR: 0.030 });
export const HANJI_HOLE_RADIUS_DEFAULT = 0.024;

/**
 * 찢어짐 임계 T — 한 판에 이만큼 구멍이 나면 종이가 찢어진다(불투명도 파생값 0).
 * 제약: n < T ≤ 9 (n = 2.5 m에서 쓸 만한 시야가 되는 구멍 수, 9 = 산탄 펠릿 수).
 * 산탄 한 발이 기준 거리 3 m에서 판을 찢어야 하므로 T는 3 m 명중 펠릿 수 이하여야 한다.
 */
export const HANJI_TEAR_THRESHOLD = 7;

/** 셰이더 유니폼 배열 상한 — 초과 시 가장 오래된 구멍부터 버린다(결정적) */
export const HANJI_MAX_HOLES = 24;

export class HanjiState {
  constructor() {
    /** paneId(가시 메시 이름) → { hits, holes: [{u,v,r}], torn, size:[w,h], opacity } */
    this.panes = new Map();
  }

  /**
   * 부팅 시 main.js가 가시 창호지 판마다 호출.
   * @param {number} width  판 가로 (m) — 구멍 면적 → 파생 불투명도 산출에 쓴다
   * @param {number} height 판 세로 (m)
   */
  register(paneId, width, height) {
    if (this.panes.has(paneId)) throw new Error(`hanji pane already registered: ${paneId}`);
    if (!(width > 0) || !(height > 0)) throw new Error(`hanji pane size 필요: ${paneId} (${width}×${height})`);
    this.panes.set(paneId, {
      hits: 0, holes: [], torn: false, size: [width, height], opacity: HANJI_BASE_OPACITY,
    });
  }

  /** 구멍이 덮는 판 면적 비율 (0..1) — 겹침은 무시(상한 1로 포화) */
  static coverageOf(p) {
    const area = p.size[0] * p.size[1];
    let s = 0;
    for (const h of p.holes) s += Math.PI * h.r * h.r;
    return Math.min(1, s / area);
  }

  /**
   * 피격 기록. 탄도 배선이 HANJI 히트마다 호출한다.
   * @param localUV 판 로컬 0..1 — 구멍이 뚫리는 자리
   * @param weapon  무기 id (반지름 표 조회). 미등록이면 기본값.
   */
  registerHit(paneId, localUV, weapon) {
    const p = this.panes.get(paneId);
    if (!p) throw new Error(`unknown hanji pane: ${paneId}`); // PATCH-001-D: 조용한 무시 금지
    p.hits++;
    const r = HANJI_HOLE_RADIUS[weapon] ?? HANJI_HOLE_RADIUS_DEFAULT;
    p.holes.push({ u: localUV[0], v: localUV[1], r });
    if (p.holes.length > HANJI_MAX_HOLES) p.holes.shift(); // 최고령 폐기 — 규칙 고정 = 결정적
    if (p.hits >= HANJI_TEAR_THRESHOLD) p.torn = true;
    // 불투명도는 **파생값**이다: 찢어지면 0, 아니면 구멍이 덮은 만큼 준다(하한 0).
    const next = p.torn ? 0 : HANJI_BASE_OPACITY * (1 - HanjiState.coverageOf(p));
    p.opacity = next;
    bus.emit('surface:opacity', {
      surfaceId: paneId, opacity: next, holes: p.holes, torn: p.torn, size: p.size,
    });
    return p;
  }

  /** resetState 경로 — 전 판 부팅 상태 복원 + 복원 이벤트 재발행 */
  reset() {
    for (const [paneId, p] of this.panes) {
      const wasDirty = p.hits > 0;
      p.hits = 0;
      p.holes.length = 0;
      p.torn = false;
      p.opacity = HANJI_BASE_OPACITY;
      if (wasDirty) {
        bus.emit('surface:opacity', {
          surfaceId: paneId, opacity: HANJI_BASE_OPACITY, holes: p.holes, torn: false, size: p.size,
        });
      }
    }
  }

  snapshot() {
    const out = {};
    for (const [id, p] of this.panes) {
      if (p.hits > 0) {
        out[id] = {
          hits: p.hits, opacity: +p.opacity.toFixed(4), torn: p.torn,
          // 구멍 목록도 결정성 창에 들어간다 (PATCH-014-D 3항: 같은 사격 → 목록 동일)
          holes: p.holes.map((h) => [+h.u.toFixed(5), +h.v.toFixed(5), +h.r.toFixed(4)]),
        };
      }
    }
    return out;
  }
}
