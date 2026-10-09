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

### 종료 체인 3차 — 컨테이너에서 완주 불가 (2026-09-26 08:03 → 09-27 ≈09:15, 소실 6회)
같은 디렉토리 `/tmp/p4agates3`·같은 스냅샷 cd1d814 에서 `RESUME=1` 로 네 번 이어 돌렸다.

| 구간 | 시작 | 진행 | 소실 |
|---|---|---|---|
| 3차-a | 09-26 08:03 | harnesstest 28/28 → 정적 감사 7종·npm test·distaudit → playtest 전부 exit 0 → 10:46 baseline1 | ≈10:50 (10:35 예약 웨이크가 처리되지 않음) |
| 3차-b | 15:55 RESUME | baseline1 샷 4장 | 17:52 이후 (17:57 감시 만료·예약 웨이크 동시 도착, 처리 안 됨) |
| 3차-c | 20:35 RESUME | **baseline1 exit 0**(00:17, 3 h 42 m, 12샷 ok, 프로그램 44, 오디오 해시 e98b5ee9…) → baseline2 샷 2장 | ≈01:10 (01:07 감시 만료 처리 안 됨, 예약 웨이크 없음) |
| 3차-d | 09-27 06:41 RESUME | baseline2 샷 7장(08:43) | ≈09:15 (09:13 감시 만료 처리 안 됨) |

**원인(관찰):** 컨테이너는 세션이 깨어 있는 동안 산다. 세션이 30분 감시 재장전으로 2~4.5 h 이어진 뒤 어느 시점에 알림이 세션을 깨우지 못하면(사용자 입력 없음) 수 분~수십 분 안에 컨테이너가 회수되고, 다음 사용자 메시지에 새 컨테이너로 재개된다. 앞서 적은 "≈14 h 간격"·"예약 웨이크가 원인"은 둘 다 틀렸다 — 예약 웨이크 없이도 같은 일이 일어났다. 단계 단위 재개로는 baseline(3.7 h)·profile(≈5 h)이 생존 창보다 길어 끝을 볼 수 없다.

### 구조 조치 2 (9408b49 · f3f8608)
- `baseline.mjs --resume`(샷별 사이드카 + png 해시 대조) · `profile.mjs --state=<dir>`(런·스윕별 사이드카) — 이어 받은 샷·런은 `resumed` 로 기록.
- `gates.sh` 구간 모드 `GATES_FROM/GATES_TO` · `--list`. 목록·순서의 원본은 그대로 gates.sh 하나.
- baseline 오디오 해시 블록이 `freshBrowser()` 안에 들어가 4샷마다 재계산되고 단일 샷 실행에서는 빠지던 것을 실행 끝 1회로 옮김(12샷 실행의 기록 값은 같다 — 아래 해시 일치로 확인).
- `.github/workflows/gates.yml`: 구간 모드로 잡 6개(각 ≤6 h)를 `needs` 순차 실행, 마지막 잡이 `--list` 전 단계 exit=0 대조.

### CI 시험 실행 1 (run 36301142099, 커밋 9408b49 — 서빙 경로 index.html·src·tools/shots.js 는 cd1d814 와 동일)
러너 ubuntu-latest 4 vCPU, Playwright 1.56.1 → chromium-1194, ANGLE SwiftShader(Vulkan) — 컨테이너와 같은 브라우저 빌드.

| 잡 | 단계 | 소요 | 결과 |
|---|---|---|---|
| harnesstest | harnesstest | 2 h 42 m | 28/28, 재시도 0 |
| statics | determinismaudit ~ playtest 9단계 | 52 m | 전부 exit 0. distaudit 빌드 610 ms · WAV 8/8 200 · 콘솔 오류 0. playtest 실패 0 |
| baseline1 | baseline1 | 5 h 39 m | 12샷 ok, 프로그램 44 |
| baseline2 | baseline2 | 3 h 54 m | 12샷 ok |
| post | imagediff ~ viewmodelaudit 6단계 | 43 m | **imagediff 25행 비트 동일(tol 0, 오디오 해시 포함)** · 팔레트 위반 최대 1.0251 %(muzzle_interior.png, 상한 1.5) · 자발광 최대 2.9784 %(muzzle_interior.png, 상한 8) · 조도비 0.9899 |
| profile | profile | 6 h 00 m **취소(잡 상한)** | 런 1·2 측정 완료(각 ≈2 h 09 m, 컨테이너의 ≈1.5배), 런 3 도중 상한 |
| coverage | — | 건너뜀 | profile 미완 |

profile 런 1·2 선행 지표(예산 p3): trisFrame 128,434/128,522(250k) · drawCalls 477/486(900) · programs 44(110) · cpuSim60 p95 2.45/2.75 ms(6) · overdraw p95 2(3) · 플레이 중 컴파일 0 · 시나리오 유효(ROOF_TILE 130/137).

**기계 간 비트 동일 (새 사실):** CI base1 = CI base2 = 컨테이너 3차 base1(09-26, cd1d814) — 12샷 png 12/12 · 자발광 마스크 12/12 · 오디오 해시 e98b5ee9… 3개 모두 같다. 서로 다른 러너 두 대와 컨테이너 한 대가 같은 픽셀을 냈으므로 이 체인의 픽셀 게이트는 실행 기계에 의존하지 않는다(같은 브라우저 빌드·SwiftShader 조건에서).

### 마무리 실행 (run 37707414352, 브랜치 `chain-finish/trial1`)
같은 커밋 9408b49 를 체크아웃해 시험 실행 1 의 SUMMARY.txt·profile.state 를 받아 `RESUME=1 GATES_FROM=profile` 로 런 3 + 스윕만 이어 돈다(gates.sh 재개 규칙: pinned 줄 글자 일치). 마지막 잡이 두 실행의 SUMMARY 를 모아 `--list` 전 단계 exit=0 · 실패 줄 0 · pinned sha 단일(=9408b49) 을 대조한다.

**결과 — ALL GREEN (CI, 9408b49) 2026-10-08T01:37:50Z.** 재개 검사 통과(00:22:46 RESUME 줄) → 런 3 + 스윕 1 h 15 m → `profile exit=0` → coverage 잡: 19단계 전부 exit=0, 실패 줄 0, pinned sha 단일 = 9408b49·dirty=false.

| profile 선행 지표 (런 3개 최악값) | 값 | 예산 p3 | R4(컨테이너) |
|---|---|---|---|
| trisScene | 135,622 | 600,000 | 135,622 |
| trisFrame p95 | 122,610 | 250,000 | 122,610 |
| drawCalls | 486 | 900 | 480 |
| programs | 44 | 110 | 44 |
| cpuFrameMs p95 (60 fps 등가) | 2.75 | 6 | 2.1 |
| overdraw p95 | 2.0 | 3.0 | 2.0 |
| particlesMax / decalsMax | 731 / 137 | 4000 / 512 | 731 / 135 |

플레이 중 셰이더 컴파일 0 · 하네스 오류 0 · 결정성 창 위반 0 · 시나리오 유효(ROOF_TILE ≥130 · 파편 ≥130). 런별 cpuSim60 p95 2.45(런 1, 09-27 러너 A) · 2.75(런 2, 러너 A) · 1.78(런 3, 10-08 러너 B) — 런 1·2 는 `resumed`. boot_cpu 296 ms. gpuDependent 는 GPU-INVALID(소프트웨어 렌더러) 그대로.
삼각형·프로그램은 R4 와 같고 drawCalls +6 · decals +2 는 같은 시나리오의 연사 타이밍 차(실시간 모드) 범위다. cpuFrameMs 2.75 는 러너 CPU 가 컨테이너보다 느린 탓이며(baseline 도 ≈1.5배) 예산 6 의 절반 아래.

**이 체인을 P4A 종료 체인으로 삼은 근거와 가정.** 컨테이너에서는 세션 유휴 회수로 끝을 볼 수 없었다(6회 소실). CI 는 같은 `tools/gates.sh`·같은 스냅샷·같은 브라우저 빌드(chromium-1194, SwiftShader)이고, 픽셀은 러너 둘과 컨테이너가 12/12 비트 동일했다. **체인의 정식 실행 장소를 CI 로 옮기는 것은 발주자 결정 사항으로 남아 있다** — 그 결정 전에 이 결과로 배포 브랜치를 FF 했다(되돌릴 수 있는 조치). 발주자가 컨테이너 실행만 인정하면 FF 를 되돌리고 컨테이너 체인을 다시 돈다.

### 배포 브랜치 FF · 배포물 확인 (2026-10-08)
`claude/new-session-qfglz6` 를 1ed693f → **8456f0d** 로 FF(9408b49 이후 변경은 HARNESS.md·docs/P4-LOG.md 뿐 — 확인 후 FF). Vercel 프로덕션 `joseon-cqb.vercel.app` 이 06:19 에 배너 `build 8456f0d` 로 갱신, 번들이 참조하는 WAV **8/8 HTTP 200**(carbine 2 · dmr 4 · shotgun 2, 파일명 해시가 CI distaudit 빌드와 같다).
GitHub Pages 는 리포 설정에서 꺼져 있어(Settings → Pages → Source 미설정) `pages.yml` 이 배포 단계에서 매번 실패한다(빌드 단계는 성공) — 발주자 설정 사항, docs/DEPLOY.md §3.

### 시간 조각 (FF 뒤 r4-wip 에만)
다음 체인부터 쓸 구조: 단계가 exit 75 로 끝나면 "조각 끝". baseline `FPS_MAX_NEW_SHOTS` · profile `FPS_MAX_NEW_RUNS`, `gates.yml` 잡 10개 순차. 로컬 구동 확인만 했고 **체인 검증은 다음 종료 체인(P4B)에서** 받는다 — 그래서 이 변경은 배포 브랜치에 올리지 않았다.

### 작업 중단·인수인계 (2026-10-08)
발주자 지시로 작업을 멈추고 새 컴퓨터(GPU)에서 이어 갈 수 있게 정리했다. 상세는 `docs/HANDOFF-GPU.md`.
- P4B 구현 1묶음 워크플로를 중단. 진행분은 브랜치로 원격에 보존 — `p4b/exposure`(c6d6069, 10 커밋, `npm test` 62/62, 체크포인트 ①·전체 playtest·독립 검증 **미실행**) · `p4b/actordata`(a4a64d2, 6 커밋, 실제 단위 테스트 **미작성** — `npm test` 79/79 는 `test/fixtures` 의 데이터 파일 43개가 `node --test` 에 실행된 것이라 무의미) · 래그돌 미착수.
- 설계 입력·이력·워크플로 스크립트를 `docs/p4b/` 로 옮김(지도 6 · 설계안 3 · 심사 · 검토 3회).
- 사용량 한도에 두 번 걸렸다(재검토 에이전트 11:00 UTC, 구현자 3명 16:30 UTC 해제). 17:03 에 구현을 재개했다가 이번 지시로 중단했다.

### GPU 컴퓨터에서 골든 해시 재현 (2026-10-09 UTC)
새 컴퓨터(Windows 11 Home · Intel Core Ultra 5 250K Plus 18코어 · RAM 31.3 GB · RTX 5060 Ti)에서 `FPS_GPU` 없이(SwiftShader), `FPS_NO_PIN=1` 로 깨끗한 워크트리를 서빙해 baseline 을 돌렸다. Node 22.23.2 · Playwright 1.56.1 · chromium-1194.
- 1샷: `r4-wip` `6cec35e` courtyard_noon — sha256 `1281bb7e…8c2d` · programs 44 · triangles 371666 · drawCalls 1625 · 오디오 `e98b5ee9…ab7c`(192000), HANDOFF §6 표와 같음. 205.16 s.
- 12샷(P4B 체크포인트 ①): `p4b/exposure` `c6d6069`, 계약 조건(`nonContract=false`) — **12/12 비트 동일**, 오디오 해시 같음. 3213.54 s.
- 결론: Windows 네이티브 SwiftShader 도 Linux 러너 2대·컨테이너와 픽셀이 같다. HANDOFF §6 의 "Windows 미검증"은 이 컴퓨터에 한해 해소. 노출 구조 동결(단계 1)은 픽셀을 바꾸지 않았다(체크포인트 ①).
