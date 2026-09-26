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

### 종료 체인 2차 (2026-09-26 01:52 → 컨테이너 재부팅으로 소실)
`tools/gates.sh /tmp/p4agates2`, 스냅샷 = HEAD **62853f1**(driver.log 의 pinned 줄; 앞서 59b7bbc 로 적은 것은 착오 — 93a5639 이후 변경은 문서·드라이버 이름·wallaccess 도구뿐, 게이트가 보는 src·index.html 은 동일).
01:52 harnesstest **28/28**(1 h 52 m) → 03:44 determinismaudit · geometryaudit · chainaudit · surfaceaudit · coveraudit · fxaudit · npm test · distaudit 전부 exit 0 → 03:45 playtest exit 0(35 m) → **04:20 baseline1 시작**.
07:56 확인 시 `uptime 0 min` — **두 번째 컨테이너 재부팅**. baseline1(R4 실측 4 h 42 m)이 약 3.5 h 진행된 채 잘렸고(`base1/` 비어 있음, 잠금 파일에 죽은 PID 6727), 드라이버·감시 프로세스 전부 소멸. 코드 원인 아님. 1차(09-25 17:38)와 2차(09-26 ≈07:56) 간격 ≈14 h — 체인(17 h 30 m, R4 3차 실측)보다 짧다. **재개 없이는 이 환경에서 체인이 끝을 볼 수 없다.**

### 구조 조치 — 드라이버 재개 (`RESUME=1 bash tools/gates.sh <같은 출력디렉토리>`)
게이트 **목록은 그대로**(발주자 결정: 목록 원본 = `tools/gates.sh`). 바뀐 것은 실행 방식뿐:
1. 출력디렉토리 `SUMMARY.txt` 첫 줄(pinned sha·dirty)이 지금 계산한 줄과 글자까지 같을 때만 재개, 다르면 exit 2. 더러운 트리는 `git stash create` 가 부를 때마다 다른 SHA 를 내므로 **재개는 깨끗한 트리(커밋된 상태)에서만 성립**한다 — 건식 시험에서 확인.
2. `<단계> exit=0` 줄이 있는 단계만 건너뛰고 `RESUME <시각>` 줄을 SUMMARY 에 남긴다(여러 번에 나눠 돈 체인임이 기록에 보인다). 실패는 체인을 멈추므로 SUMMARY 에 exit≠0 이 남는 일이 없다.
3. 잘린 단계는 부분 산출물(`base1/`·`base2/`)을 지우고 처음부터. 단계는 각각 독립 프로세스이고 스냅샷은 불변 워크트리라 나눠 돈 체인과 한 번에 돈 체인은 같은 것을 잰다. baseline1·2 가 재부팅 양쪽에 걸리면 "다른 컨테이너 인스턴스에서 2회" 가 되어 비트 동일 시험이 오히려 강해진다.
건식 시험: 같은 스냅샷 → 완료 단계 건너뜀·부분 산출물 제거 확인, 다른 스냅샷 → 거부(exit 2), RESUME 없음 → SUMMARY 초기화. 발주자에게 보고하고 진행(HARNESS.md 규칙 추가).

### 종료 체인 3차 (2026-09-26 → )
`bash tools/gates.sh /tmp/p4agates3` (재개 기능 커밋 뒤 HEAD 스냅샷). 재부팅 시 `RESUME=1` 로 같은 디렉토리에 이어 돈다.
