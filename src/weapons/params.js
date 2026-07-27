/**
 * src/weapons/params.js — 무기 파라미터 계약 (P2A / CONTRACT-PATCH-002·003).
 *
 * k      : 관통 계수 (PATCH-002-A). 물리 래퍼가 지오메트리 실측 두께를 t/k로
 *          스케일해 동결 computePenetration()에 전달한다. 물리적 해석은
 *          탄자의 단면 밀도·AP 성능. surfaces.js는 무수정.
 * energy : 초구 운동에너지(J). 분류에는 무관하고(에너지 불변 —
 *          docs/P2A-BLOCKER-001 §1 증명) 피해 계산 전용이다 (PATCH-002-F).
 * pellets: 발당 독립 탄자 수. 각 펠릿이 독립 레이로 관통 계산된다.
 *
 * 값 도출: docs/P2A-BLOCKER-002 §2의 해를 PATCH-003-A(ROOF_SOIL 밀도<0.8)
 * 제약으로 재도출한 것. §2-1 정정표 30칸 전부가 PATCH-002-E 여유 밴드 안에
 * 들어가며, npm test(test/margins.test.mjs)가 이 성질을 영구 게이트로 고정한다.
 */

export const WEAPONS = Object.freeze({
  /** 카빈 5.56 — 기준 무기. 판벽·기와·초가를 뚫지만 기둥·심벽에 정지 */
  CARBINE: Object.freeze({
    id: 'CARBINE',
    k: 5.6,
    energy: 1800,
    pellets: 1,
  }),

  /** 산탄 12ga — 펠릿당. 종이·천·창살만 뚫는 실내 제압 무기 */
  SHOTGUN: Object.freeze({
    id: 'SHOTGUN',
    k: 0.425,
    energy: 200,
    pellets: 9,
  }),

  /** DMR 7.62 — 지붕(기와+보토)을 완전 관통하는 유일 무기 */
  DMR: Object.freeze({
    id: 'DMR',
    k: 9.332,
    energy: 3400,
    pellets: 1,
  }),
});

/**
 * §2-1 분류 임계 (P2A-BRIEF): 관통 = 잔여 ≥ 초기의 15%.
 * 정지는 동결 함수의 stoppedAt 출력이 유일 규범이다 (PATCH-001-B).
 */
export const PENETRATE_RATIO = 0.15;
