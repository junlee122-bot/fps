# src/audio/assets — 오디오 소재 라이선스 기록

판정 1-1(P4A 스캔): 이 파일에 두고, 병합 시 A 탭이 `docs/ASSET-LICENSES.md`로 옮긴다.
`ARCHITECTURE.md`의 "사운드 파일 0개" 잔재 정정은 계약 작성자가 병합 전에 처리한다.

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
