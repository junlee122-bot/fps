# 외부 에셋 라이선스 대장 (PATCH-010-C, PATCH-011-C 로 범위 확대)

**허용 범위(PATCH-010-A/B + PATCH-011-C)**: **캐릭터**의 기하와 애니메이션(스킨드 메시·스켈레톤/리그·클립: 이동·사격·재장전·가젯·피격·사망)과
**무기의 기하**에 한해 외부 에셋을 허용한다. 머티리얼·텍스처는 가져오지 않는다(우리 `src/materials` 프로파일로 셰이딩; 임포트 텍스처를 쓰려면
팔레트 대역으로 재매핑한 뒤 절차 텍스처와 동일 취급). 건축·머티리얼·하늘은 절차 생성 유지. FX 는 굽기형 에셋 허용(P4-BRIEF §4-10), 오디오는 합성 + 녹음 소재(P4-BRIEF §2-1, 아래 「오디오 소재」). 런타임 의존성은 `three` 단독
(`GLTFLoader` 는 three 예제 모듈이라 허용).

**011-C 개정 사유(2026-09-19)**: 발주자가 R3 캡처를 직접 열람한 결과 절차적 무기 기하가 "직육면체 몇 개"로 확인됐고, 뷰모델은 노출 등급 **A**
(플레이 시간 거의 전부 보이는 물체 — 캐릭터보다 노출이 높다). 원 규정의 "무기는 절차적 생성 유지"를 개정한다. **기하만 가져오고 재질은 우리 것**
(010-B 규칙 그대로).

**30칸 관통 표는 불변**: k 값은 무기의 **관통 계수**이며 메시와 무관하다(PATCH-002-A). 무기 메시를 바꿔도 §2-1 표 · PATCH-002-E 여유 요건 ·
5.6 / 0.425 / 9.332 전부 불변이다.

**규칙**: 에셋마다 한 줄. 출처 불명 에셋은 쓰지 않는다. 상업적 사용 가부를 반드시 적는다.

| 대상 | 삼각형 상한 | 근거 |
|---|---|---|
| 캐릭터 1종 | ≤ 25,000 | PATCH-010-C (4종 → 100 k) |
| 뷰모델 무기 1종 | ≤ 15,000 | PATCH-011-C — 카메라에 붙어 한 화면에 하나뿐이므로 캐릭터보다 낮게 |
| 3인칭 무기(캐릭터가 드는 것) | ≤ 3,000 | PATCH-011-C — 뷰모델의 LOD 로 생성 가능 |

초과 시 감면하고 **예산 상향은 금지**. 씬 합계 `tris_scene` ≤ 600 k · `tris_frame_p95` ≤ 250 k 는 그대로다.

**게이트(무기 에셋 포함 상태에서도 불변)**: `viewmodelaudit` 조도 비율 1.0 ± 0.10 · 검정 카드(에셋으로 바뀌어도 조명 리그는 월드와 동일해야 한다),
`paletteaudit` 한도 1.5 %, `chainaudit`(관통 표), 픽셀 게이트.

**시점**: 에셋 조달은 발주자 몫이다. **R4 는 머티리얼만**(011-A 1번: 건메탈·폴리머 분리·에지 마모 — 직육면체는 여전히 직육면체다),
**기하 교체는 P4B** 에 캐릭터와 함께. 설화 외형 변형(P4-BRIEF §4-7)도 이 경로로 푼다.

| 에셋 | 용도 | 출처(URL) | 저작자 | 라이선스 | 상업적 사용 | 삼각형 | 비고 |
|---|---|---|---|---|---|---|---|
| (아직 없음 — P4B 착수 전 등재) | | | | | | | |

## 오디오 소재 (P4A, P4-BRIEF §2-1 — 합성과 녹음의 혼합, 발주자 승인)

(P4A 병합 시 `src/audio/assets/LICENSES.md` 에서 이관, 2026-09-25. 원본 파일은 이 절을 가리키는 한 줄만 남긴다.)

**저장소 공개 여부:** 공개(public) — 2026-09-22 GitHub API로 확인.
**2단계 규칙(확정):** 유료 소재(Sonniss 등)는 원본을 커밋하지 않는다.

## 1단계 — The Free Firearm Sound Library (Still North Media)

| 항목 | 내용 |
|---|---|
| 라이선스 | **CC0 1.0 Universal** (퍼블릭 도메인 헌정) |
| 상업적 사용 | 가능. 출처 표기 · 재배포 제한 없음 |
| 원문 확인 1 | `github.com/PanderMusubi/sound-effects-library-weapons` `LICENSE` — CC0 1.0 Universal 법률 전문. README: "created by Still North Media and released into the public domain with a CC0 license" |
| 원문 확인 2 | `opengameart.org/content/the-free-firearm-sound-library` — 라이선스 표기 CC0, 본문 "CC0 NO RIGHTS RESERVED for this library. It may be used without royalty or credit (though we would love to hear how you've used our sounds) for any application, personal or professional." |
| 원문 확인 3 | `stillnorthmedia.com/firearm-sound-library.html` — 정적 HTML 에서 라이선스 문구를 찾지 못함(스크립트 렌더 페이지로 추정). 위 두 원문으로 갈음 |
| 받은 경로 | PanderMusubi `build.sh` 가 가리키는 MediaFire 공식 링크 `Prepared_SFX_Library.zip` (228,382,887 B, 205 항목) + `Prepared_Master_Sheet.csv` |
| 원본 형식 | 96 kHz / 24-bit / 스테레오 WAV, 파일당 테이크 2–5발, 근거리 · 중거리 마이크 발사음만 |
| 없는 것 | 기계음 · 탄창 장전 · 공격발 · 뒤/먼 마이크 — 원본 「Firearm Sound Library」 쪽 층. MediaFire 폴더(`p3uh49jhsrm8e`) 조회 1회 → Prepared 두 파일만 있음. 판정 2 대로 합성으로 전환(`synth.js` MECH_SYNTH) |

### 커밋된 파일 (가공본 — `_prepare.mjs` 로 재생성 가능)

| 파일 | 원본 | 총 · 탄 | 계열 |
|---|---|---|---|
| `gun/shotgun_0.wav`, `gun/shotgun_1.wav` | `CD/H_21P.wav` 테이크 0·1 | Charles Daly 펌프 12ga | SHOTGUN |
| `gun/carbine_0.wav`, `gun/carbine_1.wav` | `AR-15/D_32P.wav` 테이크 0·1 | AR-15 5.56×45 | CARBINE |
| `gun/dmr_0.wav` … `gun/dmr_3.wav` | `Mosin Nagant/M_21P.wav` 테이크 0–3 | Mosin-Nagant 7.62×54R | DMR (**7.62×51 부재 → 대체**) |

가공: 모노 합산 → 테이크 분할 → 꼬리 절단(피크 대비 -40 dB, 20 ms 페이드) → 96→48 kHz(윈도우드 싱크 FIR 127탭) →
피크 -1 dBFS → 16-bit PCM(디더 없음). 전부 48 kHz / 16-bit / 모노. 합계 약 96 KB.

## 합성 소리

`synth.js` — 임팩트 13종(surfaces.js `audio` 키 전수, `bronze_resonate` 포함), 발소리, 기계음, 벽체 재방사 울림,
시험 음원. 외부 소재 없음 — 라이선스 대상 아님.
