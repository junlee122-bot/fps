# P4 작업 기록 — 오디오 · 액터 · 스킬

## P4A — 오디오 (병합·종료 체인)

### 병합 (2026-09-25, 93a5639)
탭 B `claude/p4a-audio-m4g6de`(분기점 797cefd, 8 커밋)를 `r4-wip` 에 병합. 충돌은 `docs/contracts/briefs/P4-BRIEF.md` add/add 하나 — 이 판(발주자 전달본) 채택.
탭 B 는 `src/audio/*` · `tools/audioaudit.mjs` · 청감 파일 · 가공 소재 8개 · 단위 테스트만 만들었고 main.js/baseline/harnesstest 는 손대지 않았다(계약대로).
−1-B 8항 처리와 착수 전 스캔 16항은 `docs/CONTRACT-NOTES.md` 에 있다. 신설: `tools/distaudit.mjs`(케이스 29) · `tools/gates.sh`(게이트 목록 원본) · `tools/wallaccess.mjs`.

### audioaudit 재현 (병합 트리, 2026-09-25)
차폐 표면 11종(제외: DANCHEONG·LACQUER = DECAL, WATER·PACKED_DIRT = 지면) · 55쌍. **exit 1 — 3쌍**이 들리는 축 1개:
`WOOD_LATTICE(light)–FABRIC(free)` [cutoffHz], `WOOD_COLUMN(medium)–THATCH(light)` [attenuationDb], `WOOD_COLUMN(medium)–ROOF_SOIL(light)` [attenuationDb].
`ROOF_SOIL–EARTH_WALL` 2축 통과, BRONZE T60·공간 잔향·결정성(독립 페이지 2회 해시 동일) 통과. 발주자 청감 판정 대기 — 청감 파일 `docs/audio-listen/`.

### 종료 체인 1차 (2026-09-25 15:47 → 컨테이너 재부팅으로 소실)
`tools/_p4gates.sh /tmp/p4agates`, 스냅샷 `93a5639`, audioaudit 제외. harnesstest **28/28**(케이스 21·29 첫 통과), determinismaudit · geometryaudit · chainaudit · surfaceaudit · coveraudit · fxaudit · npm test 36/36 · **distaudit 첫 통과**(빌드 4 s, dist 부팅 12 s, WAV 8/8 200, 콘솔 오류 0).
17:38 playtest 진행 중 **컨테이너가 재부팅**됐다(`uptime 0 min`, nohup 드라이버까지 소멸, playtest 출력 0 바이트, 잠금 파일에 죽은 PID). 코드 원인 아님. 드라이버는 재개 기능이 없으므로 처음부터 다시 돈다.

### 종료 체인 2차 (2026-09-26 01:5x → )
`tools/gates.sh /tmp/p4agates2`, 스냅샷 = HEAD(59b7bbc — 93a5639 이후 변경은 문서·드라이버 이름·wallaccess 도구뿐, 게이트가 보는 src·index.html 은 동일).
