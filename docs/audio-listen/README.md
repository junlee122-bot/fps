# docs/audio-listen — P4A 청감 확인용 렌더 (CC0 소재)

`src/audio` 그래프(오클루전 경로만, 잔향·패너 없음)로 렌더한 48 kHz / 16-bit / 모노 WAV.
재생성: `node src/audio/assets/_listen.mjs docs/audio-listen` — 소리 하나를 각 차폐 표면 한 겹(refCm) 너머로 렌더.

- `step_WOOD_PLANK__<표면>.wav` — 판벽 마루 발소리(합성)
- `gun_CARBINE__<표면>.wav` — 카빈 총성(1단계 소재 D_32P, CC0)
- `__OPEN` — 차폐 없음(기준)

## audioaudit 개정 기준에서 떨어진 쌍 (들리는 축 1개) — 이 파일끼리 비교

| 쌍 | 들리는 축 | 비교할 파일 |
|---|---|---|
| WOOD_LATTICE(light) vs FABRIC(free) | 차단만 (감쇠 차 2.7 dB) | `*__WOOD_LATTICE.wav` ↔ `*__FABRIC.wav` |
| WOOD_COLUMN(medium) vs THATCH(light) | 감쇠만 (차단 차 0.28 옥타브) | `*__WOOD_COLUMN.wav` ↔ `*__THATCH.wav` |
| WOOD_COLUMN(medium) vs ROOF_SOIL(light) | 감쇠만 (차단 차 0.26 옥타브) | `*__WOOD_COLUMN.wav` ↔ `*__ROOF_SOIL.wav` |

## 정확히 2축으로 통과한 핵심 쌍

| 쌍 | 들리는 축 | 비교할 파일 |
|---|---|---|
| ROOF_SOIL vs EARTH_WALL | 차단 · 감쇠 | `*__ROOF_SOIL.wav` ↔ `*__EARTH_WALL.wav` |
