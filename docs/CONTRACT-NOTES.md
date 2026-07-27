# CONTRACT-NOTES.md — 계약 모호·충돌 지점 열거 (P0 착수 전)

마스터 프롬프트 §9의 지시에 따라, 코드 작성 전에 `ARCHITECTURE.md` / `HARNESS.md` /
`src/core/surfaces.js` 3개 계약 문서에서 발견한 모호하거나 서로 충돌하는 지점을 열거하고,
각각에 대해 채택한 해석을 기록한다. **여기 기록된 해석과 다른 구현이 발견되면 구현이 틀린 것이다.**

---

## A. 실질 충돌 (계약 문서끼리 서로 다른 말을 하는 지점)

### A1. "GRANITE 유일 완전 차단재" vs `PenClass.BLOCK` 3종
- 프롬프트 §1·ARCHITECTURE §2는 "화강암 기단만이 유일한 완전 차단재"라고 서술한다.
- 그러나 동결 파일 `surfaces.js`의 BLOCK 등급은 **GRANITE, BRONZE, PACKED_DIRT 3종**이고,
  `COVER_SURFACES` 파생 상수도 3종을 모두 포함한다.
- P4 종료 조건 "AI가 화강암**만** 엄폐로 선택"은 `COVER_SURFACES` 기반 구현과 문자 그대로는 충돌한다.
- **채택한 해석:** 코드 계약(`surfaces.js`)이 우선한다. "유일"은 *건축 벽체 재질 중 유일*이라는
  서술적 표현이다. PACKED_DIRT는 지면(마당 바닥), BRONZE는 소품(범종)이므로 게임플레이 명제
  "벽은 엄폐물이 아니다"와 모순되지 않는다. P4의 AI 엄폐 판정은 `COVER_SURFACES`(= BLOCK 등급)
  기준으로 구현하며, 종료 조건 문구는 "BLOCK 등급 표면만 엄폐로 선택"으로 읽는다.

### A2. ARCHITECTURE §2 "잔여속도 %" vs `computePenetration`의 지수 감쇠
- §2 표의 잔여속도(예: WOOD_PLANK ~70%)는 `energyRetain` 필드 값을 그대로 옮긴 것이다.
- 그러나 `computePenetration`은 `energyRetain`을 **두께 1cm당 지수 적용 + 밀도 가중**하므로
  실제 잔여 에너지는 표의 %보다 훨씬 낮다. 예: WOOD_PLANK 3cm →
  `0.70^(3×1.5) ≈ 20%` (표의 ~70%가 아님).
- **채택한 해석:** 표의 %는 필드 값의 서술이지 관통 결과 스펙이 아니다. P2 관통 유닛 테스트는
  ARCHITECTURE 표의 %가 아니라 **`computePenetration` 출력**을 기준으로 작성한다.

### A3. "아트 에셋 0개(이미지 파일 금지)" vs baseline PNG 레퍼런스
- 픽셀 게이트는 baseline PNG를 요구하지만, §2 절대 제약은 이미지 파일의 리포 추가를 금지한다.
  또한 baseline은 GPU/드라이버 종속이라 머신 간 이식도 안 된다.
- **채택한 해석:** `baseline/`, `current/`, `tmp/`는 gitignore 처리한 로컬 생성물이다.
  픽셀 게이트는 "같은 머신에서 재생성 → 비교"로 운용한다. 커밋되는 것은 도구와 샷 정의뿐이다.

## B. 모호 지점 (해석을 골라야 했던 지점)

### B1. `computePenetration`의 경계 동작 3가지 (동결 파일이므로 그대로 수용)
1. DECAL 레이어는 `continue`로 스킵되어 `path`에 기록되지 않는다 → DANCHEONG/LACQUER의
   "fx·audio는 하부재를 따름" 매핑은 호출자(physics)가 레이어 목록에서 별도로 처리해야 한다.
2. 정지 임계(2%)로 멈춘 레이어의 `path` 항목은 `exited:true, residual>0`인 채로 남고
   함수 반환은 `residual:0, stoppedAt:i`다 → **`stoppedAt`이 정본**이고 path의 마지막 항목
   residual은 참고값으로 취급한다.
3. 정지 임계가 절대값이 아니라 `energy0 × 0.02`(초기 에너지 비례)다 → 고에너지탄일수록
   절대 정지 문턱이 높다. 의도로 간주하고 P2 테스트에 반영한다.

### B2. `window.__harness` 인터페이스 확장
- HARNESS §2의 5개 멤버(ready/setShot/stepFrames/getStats/resetState)만으로는
  `playtest.mjs`(스크립트 이동)와 `profile.mjs`(실플레이 재생)를 구동할 수 없다.
- **채택한 해석:** 계약 5개의 시그니처는 그대로 두고, 다음을 **추가**한다:
  `setInput(state)`, `runScript(script)`, `getPlayerState()`, `getBootMs()`,
  `getInvariants()`, `getErrors()`. 추가는 계약 위반이 아니라 보완으로 간주한다.

### B3. `ready`의 정의 (P0 시점)
- 계약: "프리웜·PMREM 완료". P0에는 sky/PMREM이 없다.
- **채택한 해석:** P0의 `ready` = 월드 빌드 + BVH 빌드 + 셰이더 프리웜 완료.
  P3에서 PMREM 완료 조건을 추가한다.

### B4. `profile.mjs`의 "AI 활성·사격 중" (P0 시점)
- P0에는 AI도 무기도 없다. P0 종료 조건은 "p50/p95/p99 + 프레임당 프로그램 카운트 출력"이다.
- **채택한 해석:** P0 프로파일 스크립트는 이동·시점 전환·점프만 재생한다.
  사격·AI는 P2/P4에서 스크립트에 추가한다.

### B5. 성능 목표의 기준 하드웨어 vs 본 실행 환경
- 목표는 Apple Silicon + DPR2 + 실 GPU 기준. 본 환경은 컨테이너 + SwiftShader(소프트웨어 GPU)다.
- **채택한 해석:** 이 환경의 절대 fps는 참고치다. 게이트로 강제하는 것은
  (1) 비트 동일 재현성, (2) 플레이 중 셰이더 컴파일 0, (3) 회귀(픽셀·히치 귀속) 탐지다.
  fps 절대값 판정은 목표 하드웨어에서 재실행해야 유효하다. 보고서에 양쪽을 명시한다.

### B6. 고정 프레임 예산 `FIXED_N` 미지정
- **채택:** 샷당 90프레임(1.5s @ 60Hz 고정 스텝, 물리 서브스텝 1/120s ×2)을
  `tools/shots.js`에 명명 상수로 정의한다.

### B7. 샷 정의의 이중 소비자
- `tools/shots.js`가 샷을 정의하지만 페이지의 `setShot(name)`도 같은 데이터가 필요하다.
- **채택:** `tools/shots.js`를 의존성 없는 순수 데이터 ESM으로 작성하여
  Node 도구와 브라우저 페이지가 **같은 파일을 import**한다. 진실은 한 곳에만 둔다.

### B8. `opaque` + `translucent` 동시 true (FABRIC)
- FABRIC은 `opaque:true`(시야 차단)이면서 `translucent:true`(광투과)다.
- **채택한 해석:** `opaque` = AI 지각/시야 차단 플래그, `translucent` = 렌더 광투과 플래그.
  서로 독립 축이다. 전 서브시스템이 이 의미로 통일한다.

### B9. `world:tod` 발행 주체 (P0 시점)
- 계약상 `world:tod`는 sky가 발행한다. P0에는 sky가 없다.
- **채택:** P0에서는 harness의 `setShot`이 태양각을 라이트에 직접 설정하고 이벤트를 발행하지
  않는다(발행 주체 침범 금지). P3에서 sky 소유로 이관한다.

### B10. HANJI와 플레이어 이동 충돌
- 탄환에는 FREE(무저항)지만, 플레이어 이동에 대해 벽인지 여부는 계약에 없다.
- **채택:** P0에서는 모든 정적 표면이 이동 차단체다(창호지 포함 — 사람은 문으로 다닌다).
  "몸으로 창호지 돌파" 기획이 필요해지면 계약 변경 제안으로 올린다.

### B11. 이벤트 어휘에 플레이어 이동 이벤트가 없음
- 발소리/착지음(P4 오디오)에 필요한 `player:footstep` 류가 어휘에 없다.
- **채택:** P0~P3에서는 발행하지 않는다. P4 착수 시 계약 변경 제안으로 올린다.
  임의 발행은 §3 금지 조항 위반이다.

### B12. 런타임 의존성·서빙 방식
- vite는 허용되지만 필수가 아니다. **채택:** 빌드 도구 없이 import map으로
  `three@0.180.0`(정확 고정)을 직접 서빙한다. 움직이는 부품이 줄어 부팅이 빠르고
  결정성 검증이 단순해진다. 개발 의존성은 `playwright`(전역 브라우저 재사용), `pngjs`뿐이다.

### B13. 캡처 화면 구성
- HUD는 P5까지 없으므로 페이지에는 캔버스만 존재한다. 캡처는 뷰포트 전체 스크린샷으로 하며,
  DOM 텍스트(폰트 렌더링 변동 요인)는 P5까지 캔버스 위에 올리지 않는다.

---

## C. 표류 방지 메모 (충돌은 아니지만 오해 소지)

- `WATER`의 "거리 기반 감쇠"는 별도 코드 경로가 아니라 `computePenetration`의
  두께(=수중 이동 거리) 지수 감쇠로 표현된다.
- `energyRetain=0.99`(HANJI)에 `density=0.02` → 두께 0.02cm 창호지 한 장의 잔여율은
  99.98%로 표의 "~99%"와 부합한다. 표가 맞는 유일한 케이스는 두께가 1cm 근처인 경우뿐이다(A2 참조).
- `programCountPerFrame`은 **누적 프로그램 수**를 기록한다. "해당 프레임의 신규 컴파일 수"는
  도구(`profile.mjs`)가 인접 프레임 차분으로 계산한다.
- 도탄(`ricochet`)은 P0~P1에서 미사용. P2 탄도에서 소비한다.
