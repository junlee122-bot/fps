# HARNESS.md — 계측 및 회귀 게이트 계약

> 이 리포지토리에서 가장 가치 있는 부분은 게임이 아니라 하네스다.
> P0에서 전부 구축한다. 게임 코드보다 먼저다.

---

## 0. 왜 먼저인가

선행 사례에서 **두 가지 발견이 그 이전의 모든 측정을 무효화**시켰다.

**(1) 중앙값 프레임타임이 실제 문제를 가린다.**
정적 카메라 벤치마크가 94fps를 보고하는 동안 게임은 플레이 불가능했다.
Retina DPR 실제 게임플레이(내부 해상도 3.34MP, 2.07MP 아님)에서 12~17fps,
**728~1236ms 스톨**이 발생했고, 원인은 WebGL 프로그램 34개 이상이
프레임 중간에 지연 컴파일된 것이었다. 평균이나 중앙값으로는 절대 보이지 않는다.

**(2) 캡처가 재현되지 않았다.**
샷 11개를 한 페이지에서 연속 캡처하면 파티클 수명, 데칼 버퍼, 노출 적응 상태가
앞 샷에서 뒤 샷으로 샌다. 동일 조건 2회 실행이 11샷 중 **10샷에서 달랐다.**
재현되지 않는 캡처는 회귀 게이트로 쓸 수 없다.

이 두 가지를 해결하지 못한 상태의 모든 품질·성능 판단은 무효다.

---

## 1. 툴 목록

| 툴 | 재현성 | 용도 | 게이트 |
|---|---|---|---|
| `tools/capture.mjs` | 없음 | 지정 샷 1장 빠르게 | ✗ |
| `tools/shotset.mjs` | **없음** | 11샷 빠른 리뷰 | **✗ 절대 금지** |
| `tools/baseline.mjs` | **비트 동일** | 레퍼런스 생성 | ✓ |
| `tools/imagediff.mjs` | — | 픽셀 비교 | ✓ |
| `tools/profile.mjs` | 통계적 | 프레임타임 분포·히치 귀속 | ✓ |
| `tools/playtest.mjs` | — | 이동·사격 스모크 | ✓ |

> **`shotset.mjs`를 게이트로 쓰지 마라.** 빠르지만 재현되지 않는다.
> 사람이 눈으로 훑을 때만 쓴다.

---

## 2. 결정성 요구사항

`baseline.mjs`가 비트 동일하려면 게임 코드가 아래를 만족해야 한다.
**하나라도 어기면 하네스가 무의미해진다.**

1. **단일 시간 소스.** `src/core/clock.js`만이 시간을 소유한다.
   어떤 서브시스템도 `performance.now()`, `Date.now()`, `requestAnimationFrame`
   타임스탬프를 직접 읽지 않는다.
   *(선행 사례: 이걸 어긴 서브시스템들 때문에 부팅 시간이 바뀔 때마다 출력이 흔들려
   최적화의 픽셀 중립성을 증명할 수 없었다. 프리웜을 넣기 전에 이것부터 고쳐야 했다.)*
2. **시드 고정 RNG.** `Math.random()` 직접 호출 금지. `core/rng.js`의
   시드 가능한 PRNG만 사용. 절차적 생성 전부가 여기에 의존한다.
3. **고정 프레임 예산.** 캡처 시 실시간이 아니라 고정 스텝으로 N프레임 진행 후 촬영.
4. **자원 로드 완료 대기.** 프리웜 완료 + PMREM 생성 완료 신호 후 촬영.

게임은 `window.__harness` 인터페이스를 노출한다:

```js
window.__harness = {
  ready: Promise<void>,            // 프리웜·PMREM 완료
  setShot(name): Promise<void>,    // 카메라·시간대·상태 세팅
  stepFrames(n): Promise<void>,    // 고정 스텝 n프레임 진행
  getStats(): {                    // 프레임 통계
    frameTimes: number[],
    programCountPerFrame: number[],
    triangles: number,
    drawCalls: number
  },
  resetState(): void               // 파티클·데칼·노출 초기화
}
```

---

## 3. 샷 정의

`tools/shots.js`에 정의. **각 샷은 특정 서브시스템의 실패를 드러내도록 선정됐다.**

| # | 이름 | 감시 대상 |
|---|---|---|
| 1 | `courtyard_noon` | 마당 정오 직사광 — 노출, 그림자 캐스케이드 |
| 2 | `daecheong_backlit` | 대청 역광, 실내→마당 — EV100 적응 |
| 3 | `hanji_silhouette` | 창호지 너머 인물 — 반투과 산란 |
| 4 | `dancheong_closeup` | 처마 단청 근접 — 머티리얼 최악 케이스 |
| 5 | `roofline_distant` | 기와지붕 원경 — LOD, 대기원근 |
| 6 | `lantern_night` | 야간 등롱 — 자발광, 블룸 |
| 7 | `fog_wall` | 안개 담장 — 볼류메트릭 |
| 8 | `muzzle_interior` | 실내 총구화염 — 트랜지언트 라이트 |
| 9 | `hanji_pierced` | 피격 누적 창호지 — 동적 투과율 |
| 10 | `corridor_columns` | 회랑 기둥 리듬 — 그림자 이음매 |
| 11 | `viewmodel_ads` | 뷰모델 ADS — **뷰모델 조명 리그** |

> **11번은 특별 감시 대상이다.** 선행 사례에서 뷰모델 광원 리그가 월드 대비
> 알베도당 약 20배 조도를 전달했고, 순수 검정 재질이 배경 L=91 위에서 L=110으로
> 렌더됐다(F0=0.04만으로). 이를 보정하려 모든 무기 알베도를 물리값의 1/3로 속였고,
> 그 결과 게임에서 가장 오래 보는 물체의 재질 분리가 영구히 제한됐다.
> **뷰모델과 월드는 같은 조도 단위를 써야 한다.** P3 내내 이 샷을 본다.

---

## 4. 툴 계약

### `capture.mjs`
```
node tools/capture.mjs --shot courtyard_noon --out tmp/shot.png [--dpr 2]
```
GPU 백엔드 헤드리스 Chromium. 빠른 확인용. 재현성 보장 안 함.

### `shotset.mjs`
```
node tools/shotset.mjs --out tmp/set/
```
한 페이지에서 11샷 연속. **빠르지만 상태가 샌다.** 리뷰 전용.

### `baseline.mjs`
```
node tools/baseline.mjs --out baseline/ [--dpr 2]
```
**샷마다 새 페이지를 연다.** 각 페이지에서:
`ready` 대기 → `resetState()` → `setShot(name)` → `stepFrames(FIXED_N)` → 촬영 → 페이지 폐기.

동일 커밋에서 2회 실행 시 11개 PNG 전부 **바이트 단위로 동일**해야 한다.
동일하지 않으면 게임 코드의 결정성(§2) 위반이다. 하네스를 고치지 말고 게임을 고쳐라.

### `imagediff.mjs`
```
node tools/imagediff.mjs baseline/ current/ [--tolerance 0]
```
픽셀 하나라도 다르면 **exit code 1**. 차분 이미지를 `tmp/diff/`에 출력.
기본 tolerance는 0이다. 올리지 마라.

최적화 패스의 "시각적 변화 없음"은 주장이 아니라 **이 툴의 exit code 0으로 증명한다.**

### `profile.mjs`
```
node tools/profile.mjs --duration 30 --dpr 2 --runs 3
```
정적 카메라 금지. **실제 게임플레이**를 스크립트로 재생한다 — 이동 중, AI 활성,
사격 중. 실제 device pixel ratio 사용.

출력 필수 항목:
```
fps      p50 / p95 / p99 / min
frame    p50 / p95 / p99 / worst (ms)
hitch    프레임 > 50ms 목록, 각각에 대해:
           - 해당 프레임의 신규 WebGL 프로그램 컴파일 수
           - 드로우콜, 삼각형 수
           - 직전 이벤트 (첫 발사, 폭발, 방 진입 등)
boot     ready 도달까지 ms
```

**히치 귀속이 이 툴의 존재 이유다.** 프레임당 신규 프로그램 카운트가
지연 컴파일 스톨을 찾아내는 유일한 수단이다.

### `playtest.mjs`
```
node tools/playtest.mjs
```
스크립트 이동·사격 스모크. 콘솔 에러, NaN 위치, 지오메트리 관통, 무한 낙하 검출.
비정상 시 exit 1.

---

## 5. 패스 종료 게이트

각 패스는 아래 3개를 **전부** 통과해야 다음으로 넘어간다.

```bash
node tools/baseline.mjs --out current/
node tools/imagediff.mjs baseline/ current/     # 의도된 변경이면 baseline 갱신 후 재실행
node tools/profile.mjs --runs 3                  # p50/p99가 목표 이상
node tools/playtest.mjs                          # exit 0
```

의도된 시각 변경이 있는 패스에서는 `imagediff` 실패가 정상이다. 단,
**변경된 픽셀이 의도한 영역인지 차분 이미지로 확인한 뒤** baseline을 갱신한다.
확인 없는 baseline 갱신은 회귀를 영구히 묻어버린다.

---

## 6. 성능 목표

Apple Silicon 노트북, 1512×982, DPR 2 (내부 3.34MP), `ultra` 프리셋,
AI·사격 활성 게임플레이, 3회 실행 기준.

| 지표 | 목표 |
|---|---|
| fps p50 | ≥ 45 |
| fps p99 | ≥ 25 |
| 최악 프레임 | ≤ 50 ms |
| 플레이 중 셰이더 컴파일 | **0** |
| 부팅 | ≤ 4 s |
| 삼각형 | ≤ 6 M |

선행 사례(p50 28~30, p99 14~17)보다 목표가 높은 이유:
스타일라이즈드 룩이므로 지오메트리·셰이딩 비용이 근본적으로 낮아야 정상이다.
삼각형 6M을 초과하면 아트 패스를 되돌린다.
*(선행 사례는 아트 패스가 지오메트리를 5.9M → 11.3M로 3배 늘렸고,
최적화가 그 절반만 회수했다.)*

---

## 7. 프리웜

`src/core/prewarm.js`가 셰이더 스톨을 제거한다. **P0부터 넣는다.**

부팅 시 모든 머티리얼 변형을 오프스크린으로 1회 렌더해 프로그램을 강제 컴파일한다.
`profile.mjs`의 "플레이 중 셰이더 컴파일" 항목이 **0**이 될 때까지 변형 목록을 채운다.

선행 사례 실측: 프리웜 도입으로 p50 12~17 → 28~30fps,
최악 프레임 728~1236ms → 66~82ms, 부팅 9~12s → 3.7~4.6s.

프리웜을 **픽셀 중립적으로** 만들려면 §2의 단일 시간 소스가 선행되어야 한다.
부팅 길이가 바뀌면 시간 기반 애니메이션의 위상이 전부 밀리기 때문이다.

---

*제작·이승준*
