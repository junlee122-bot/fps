/**
 * src/audio/assets/manifest.js — 녹음 소재 매니페스트 (P4-BRIEF §2-1 1단계 규칙).
 *
 * **계열 → 소재 파일 대응은 이 파일 하나다.** 2단계(「The Indoor Gun Acoustics 2」)로
 * 바꿀 때는 이 표의 files · source · gainDb 만 바뀌고 코드는 바뀌지 않는다.
 *
 * 키는 무기 **계열** id(src/weapons/params.js — SHOTGUN · CARBINE · DMR)다.
 * 개체(P4-BRIEF §4-6)가 생기면 INSTANCE_OVERRIDES 에 개체 id → 파일을 추가한다(데이터만).
 *
 * 형식 규칙(판정 1-10·1-11): 48 kHz / 16-bit / 모노 PCM WAV. 렌더 컨텍스트도 48 kHz 고정이라
 * 브라우저 리샘플러를 거치지 않는다. 압축 포맷(MP3·OGG) 금지 — 디코더가 브라우저마다 다르다.
 *
 * 라이선스 원문 확인 기록: ./LICENSES.md
 */

/** 렌더 · 소재 공통 샘플레이트 (Hz) */
export const TARGET_RATE = 48000;

/** 출처 묶음 — 파일마다 어느 라이브러리에서 왔는지 */
export const SOURCES = Object.freeze({
  SNM_FREE_FIREARM: Object.freeze({
    title: 'The Free Firearm Sound Library — Prepared SFX Library (Still North Media)',
    stage: 1,
    license: 'CC0-1.0',
    urls: [
      'https://github.com/PanderMusubi/sound-effects-library-weapons',
      'https://opengameart.org/content/the-free-firearm-sound-library',
      'http://www.mediafire.com/download/gh6e02cvj8x75fr/Prepared_SFX_Library.zip',
    ],
  }),
});

/**
 * 계열 → 발사음 테이크.
 * files 는 이 파일 기준 상대 경로. 재생 시 테이크는 rngStream('audio:take') 로 고른다.
 * gainDb 는 계열 간 균형(데이터) — 파일은 전부 피크 -1 dBFS 로 정규화돼 있다.
 */
export const GUN_FAMILIES = Object.freeze({
  SHOTGUN: Object.freeze({
    source: 'SNM_FREE_FIREARM',
    recording: 'Charles Daly 펌프 12ga — H_21P (근거리, 사수 앞 좌우 스테레오 → 모노 합산)',
    files: ['gun/shotgun_0.wav', 'gun/shotgun_1.wav'],
    gainDb: 0,
  }),
  CARBINE: Object.freeze({
    source: 'SNM_FREE_FIREARM',
    recording: 'AR-15 5.56×45 — D_32P (근거리). 라이브러리 유일의 5.56',
    files: ['gun/carbine_0.wav', 'gun/carbine_1.wav'],
    gainDb: -2,
  }),
  DMR: Object.freeze({
    source: 'SNM_FREE_FIREARM',
    recording: 'Mosin-Nagant 7.62×54R — M_21P (근거리)',
    // 7.62×51 총은 1단계 라이브러리에 없다. 가장 가까운 풀파워 소총으로 Mosin 7.62×54R 를 쓴다.
    // .30-06 계열(Tikka·Springfield·Arisaka)은 근거리 녹음도 -40 dB 까지 450–600 ms 로 방 울림이 남아 탈락,
    // SKS 7.62×39 는 건조하지만 중간 약실이라 카빈과 음색이 겹쳐 탈락. 볼트액션 소리이며 반자동 DMR 과 기계음이 다르다.
    substitute: '7.62×51 부재 → 7.62×54R 대체',
    files: ['gun/dmr_0.wav', 'gun/dmr_1.wav', 'gun/dmr_2.wav', 'gun/dmr_3.wav'],
    gainDb: 1,
  }),
});

/** 개체(§4-6) → 계열과 다른 소재를 쓸 때만. 비어 있으면 계열 소재 */
export const INSTANCE_OVERRIDES = Object.freeze({});

/**
 * 전처리 입력 (_prepare.mjs 전용). 원본은 커밋하지 않는다 — 결과 WAV 만 커밋한다.
 * takes 는 원본 파일 안의 테이크 순번(온셋 검출 순).
 */
export const PREPARE = Object.freeze([
  { sourceDir: 'CD', sourceFile: 'H_21P.wav', out: 'shotgun', takes: [0, 1] },
  { sourceDir: 'AR-15', sourceFile: 'D_32P.wav', out: 'carbine', takes: [0, 1] },
  { sourceDir: 'Mosin Nagant', sourceFile: 'M_21P.wav', out: 'dmr', takes: [0, 1, 2, 3] },
]);
