# 인수인계 — 새 컴퓨터(GPU)에서 이어 하기 (2026-10-08 작성, 작업 중단 시점 스냅샷)

> **이 문서의 용도**: 클라우드 컨테이너에서 하던 JOSEON-CQB 작업을 **GPU 가 있는 새 컴퓨터**에서 이어 가기 위한 전부.
> 새 Claude Code 세션은 이 문서 → `docs/P4B-DESIGN.md` → `docs/CONTRACT-NOTES.md` 「P4B 착수 전 스캔」 순으로 읽으면 된다.
> 작성 시점 `r4-wip` 의 머리 커밋은 `git log -1 --format=%h r4-wip`. 아래 "검증됨/미검증" 표시를 믿고, **추정은 추정으로** 읽을 것.

---

## 0. 한 줄 요약

| 구분 | 상태 |
|---|---|
| P0 ~ P3 (월드·렌더·물리·탄도·창호지·FX) | **종료.** R4 비평까지 마침 (배포 브랜치 FF 완료) |
| P4A (오디오) | **종료.** 게이트 체인 ALL GREEN (CI, 커밋 `9408b49`), 배포 브랜치 `8456f0d`, Vercel 프로덕션 WAV 8/8 200. *audioaudit 는 발주자 청감 판정 대기로 체인 밖* |
| P4B (액터 4종·청크 내비메시·PBD 래그돌·silhouetteaudit·노출 동결) | **설계 완료** (`docs/P4B-DESIGN.md` 개정 2 + 부록 R2). **구현 1묶음 중단**: 노출 동결 일부 · 캐릭터 데이터 층 일부가 브랜치에 있고 **병합·검증 전**, 래그돌은 미착수 |
| 발주자 결정 | **#14(디렉터리 소유권)·#1(차폐 모델 개정) 승인됨 (2026-10-09)** — 병합이 풀렸다. 남은 대기: #3·#2·#4·#5·#7·#18·#20·#11 (단계 11 까지는 추가 결정 없이 진행 가능) |
| 실 GPU 실측 | **P4B 종료 전 1회, P4 종료 전 필수** (종료 게이트). 절차: `docs/PROFILE-RUN.md` — 이 새 컴퓨터가 정확히 그 용도다 |

---

## 1. 이 프로젝트가 일하는 방식 (새 세션이 반드시 지킬 규칙)

- **계약 주도.** 발주자 = 계약 작성자(이승준). 계약 원문은 `docs/contracts/` (`briefs/`·`patches/`), 이를 구현한 규칙은 `HARNESS.md`·`ARCHITECTURE.md`. 계약 해석·충돌은 `docs/CONTRACT-NOTES.md` 에 기록(오류 장부 #1~#27 포함).
- **보고는 한국어만.** 결과는 계측으로만 말한다(추측·기억으로 쓰지 않는다). 못 잰 것은 "미측정"이라고 쓴다.
- **게이트 임계를 발명하지 않는다 (PATCH-014-C, 내 오류 기록).** 설계가 '후보'·'발주자 확정'이라고 한 값은 코드 상수 이름과 주석에 그 표시를 남긴다. 숫자는 후보를 좁히는 데까지만 쓰고 최종은 캡처를 본 발주자가 정한다.
- **검사 조건은 대상의 '상태'가 아니라 '변화'에 건다 (PATCH-016-A).** "모든 X 가 Y" 검사는 X ≥ 1 을 함께 단언한다(비공허 규칙, 이 규칙을 어겨서 playtest 구멍 검사가 공허 통과한 적이 있다).
- **눈으로 합격시키는 게이트 앞에서 절차를 쪼갠다 (PATCH-016-B).** 설계서 단계 11(silhouetteaudit 1차 실측)은 **보고로 끝나고 멈춘다.**
- **새 게이트에는 음성 테스트를 같이 넣는다** (harnesstest, P2A-BRIEF §0-1). 타임아웃은 단독 실측 × 2.5.
- **렌더를 쓰는 도구는 한 번에 하나, 순차.** (PATCH-005-J — 동시에 돌리면 측정이 흔들린다.) 렌더 도구를 돌리기 전에 작업 트리를 커밋한다(고정 스냅샷 `tools/lib/pinned.mjs`).
- **게이트 목록의 유일한 원본은 `tools/gates.sh`** (장부 #27). 브리프·문서에 목록·개수를 손으로 쓰지 않는다.
- **GitHub PR 은 요청받기 전에는 만들지 않는다.** 푸시는 `r4-wip`(작업 본선), 배포 브랜치는 **게이트가 통과한 뒤 fast-forward 만**.
- 커밋 메시지는 한국어. 끝의 `Co-Authored-By`/`Claude-Session` 줄은 세션이 주는 지침을 따른다. 커밋·PR·코드 주석에 모델 식별자를 쓰지 않는다.

---

## 2. 저장소와 브랜치 지도

원격: `https://github.com/junlee122-bot/fps` (공개). 기본 브랜치 = 배포 브랜치.

| 브랜치 | 가리키는 곳 | 의미 |
|---|---|---|
| `claude/new-session-qfglz6` | `8456f0d` | **배포 브랜치** (GitHub 기본 브랜치, Vercel 프로덕션 `https://joseon-cqb.vercel.app/` 이 따라간다). P4A 종료 상태. **FF 만, 게이트 통과 뒤에만** |
| `r4-wip` | 최신 (이 문서가 들어 있는 곳) | **작업 본선.** 설계서·스캔·시간 조각·CI 워크플로가 여기 있다 |
| `p4b/exposure` | `c6d6069` | P4B 단계 1 (노출 계약 구조 동결) 중단분 — **병합 전, 독립 검증 전** (§4) |
| `p4b/actordata` | `a4a64d2` | P4B 단계 3a (캐릭터 데이터 층) 중단분 — **병합 전, 테스트 미작성** (§4) |
| `claude/p4a-audio-m4g6de` | `a850f9c` | 탭 B 가 만든 P4A 오디오 원본 (이미 `r4-wip` 에 병합됨, 보존용) |
| `chain-ci/trial1` | `9408b49` | CI 시험 실행 1 이 돈 커밋 (P4A 종료 체인의 근거 — `docs/P4-LOG.md`) |
| `chain-finish/trial1` | — | 위 실행의 profile 을 이어 받아 끝낸 일회용 워크플로 |

**`chain-ci/**` 로 시작하는 브랜치에 푸시하면 `.github/workflows/gates.yml` 이 게이트 체인을 돌린다** (§9).

정리 규칙: 병합 순서는 `p4b/*` → `r4-wip` → (종료 체인 통과 후) 배포 브랜치 FF. `.claude/` 디렉터리(에이전트 워크트리)는 커밋하지 않는다 — `.git/info/exclude` 에 `.claude/` 를 넣어 둘 것.

---

## 3. 지금까지 한 일 (큰 줄기)

자세한 기록은 `docs/P3-REPORT.md`·`docs/R4-LOG.md`·`docs/P4-LOG.md`·`docs/CONTRACT-NOTES.md`.

1. **P0 ~ P3**: 한옥 모듈 킷으로 만든 경내(동헌·내아·객사·누각·남문·담장), 절차 머티리얼 15종(단청 포함), 다층 관통 탄도(`computePenetration` 동결, 무기 3계열 k 5.6/0.425/9.332), 창호지 구멍 모델(PATCH-013-B, p=9·T=6), 노출 자동 적응, FX 표면 15종, 하네스(`window.__harness`), 감사 도구 일체.
2. **R4** (P3 마지막 라운드): 캡처 ×2 비트 동일 → 12 세션 블라인드 비평 → 분류·판정 → P3-DEBT 118건 확정 → 배포 브랜치 FF. 발주자가 P3 종료 승인.
3. **P4-BRIEF(계약 개정판)**: PvP(2:2, 이세계 공격 vs 인간계 수비), 한국 설화 캐릭터, 서버 권위 넷코드 준비. 착수 전 스캔 16항 → 발주자 6결정 (게이트 목록 원본 = `gates.sh`, distaudit, 직녀 방패 = EARTH_WALL 재사용, 장독 = ROOF_TILE + 내구도(깨짐은 모든 무기에서 명중으로 판정), W1 수신처 신설 …).
4. **P4A 오디오** (탭 B 병합): 표면 체인 오클루전, 공간 잔향, 합성 + CC0 총소리 8파일, `distaudit`(배포물 검사: `vite build` → `dist/` 부팅 → 에셋 200).
5. **P4A 종료 체인**: 컨테이너에서 6번 끊김(§12) → **CI 로 이전** → ALL GREEN. 이 과정에서 만든 구조: `gates.sh` 재개(`RESUME=1`)·구간 모드·시간 조각(exit 75), `baseline --resume`, `profile --state`, `gates.yml`.
6. **P4B 착수 전 스캔 + 설계**: 하위 시스템 지도 6종 → 설계안 3종 → 심사 → 종합 → 적대 검토 3회. 결과 `docs/P4B-DESIGN.md`. 코드 대조로 드러난 **브리프 전제 오류 9건**(PBD 래그돌·내비 부재, 창호지 실루엣은 캡슐 프록시, 투영 대역 0.68–1.875 m 등)은 `CONTRACT-NOTES.md` 「P4B 착수 전 스캔」.

---

## 4. 중단 시점의 정확한 상태 — P4B 구현

### 4-1. 설계서 (완료, `docs/P4B-DESIGN.md`)
- 개정 2. 구성: 0 요약(결정 10) · 1 모듈 · 2 데이터 형식 · 3 절차 메시 · 4 차폐/조명 · 5 내비 · 6 래그돌 · 7 액터 런타임 · 8 silhouetteaudit · 9 노출 동결 · 10 하네스·게이트 · 11 **발주자 결정 표** · 12 위험 · 13 **구현 순서**.
- **부록 R2 = 2차 독립 재검토 13건** (조건부 승인, 치명 0 · 중대 4). 각 항목은 표의 "반영 시점" 단계를 시작하기 **전에** 본문에 반영해야 한다 (미반영 상태):
  - R2-1 (중대): 샷 3 추천 정체 토끼가 shotaudit 최소 면적 0.5 % 가드에 못 미칠 수 있음(더미 실측 0.71 %, 토끼 추정 0.4 %) → 3c 직후 4종 면적을 헤드리스로 실측해 표와 함께 결정 #3 요청.
  - R2-2 (중대): 내아 동문 r 0.34 통과가 내비 대표점 동률 선택에 달림 → 단계 7 전.
  - R2-3 (중대): silhouetteaudit 새 검사(대조군·누설·B_end·루트)·navcheck 에 harnesstest 음성 없음 → 단계 11 전.
  - R2-4 (중대): paletteauditactors 가 프레임 전체 비율이라 액터 색 반응 증거 없음 → 단계 12b 전.

### 4-2. `p4b/exposure` @ `c6d6069` — 단계 1 (노출 계약 구조 동결), 10 커밋
- **한 일**: `src/render/exposure-contract.js`(deepFreeze·계약 해시, 값은 **현재값 그대로** v1 provisional `3375c746`), `exposure.js`·`pipeline.js`(frozen 뷰, 셰이더 상수 템플릿, lock/unlock, 그리기 시점 기록, testOverride 층), `harness.js`(계약 노출·잠금 훅), `tools/playtest.mjs`(`--section <이름>` + `--inject-exposure-drift`, **+613/−306 줄의 큰 재구성**), `tools/lib/sections.mjs`, harnesstest **케이스 30**(단독 실측 ≈26–30 s, 타임아웃 75 s), `HARNESS.md` 규칙, `CONTRACT-NOTES.md` 계약 해시 기록.
- **검증됨**: `npm test` 62/62 (기준 36 + 신규 26). 케이스 30 단독 실행.
- **미검증 — 병합 전에 반드시**:
  1. **체크포인트 ①**: 구조 동결은 픽셀을 바꾸면 안 된다 → `node tools/baseline.mjs --out=tmp/ckpt1 --shots=courtyard_noon,hanji_silhouette` 의 샷 sha256 이 §6 골든 해시와 같아야 한다.
  2. **전체 `node tools/playtest.mjs` 1회 통과** (≈39 분). playtest 를 크게 건드렸다 → 케이스 26·28(playtest 의존, 비공허 조건 포함)이 여전히 의미 있게 통과하는지.
  3. 독립 적대 검증(워크플로 `p4b-impl-batch1` 의 Verify 단계, 아직 안 돌았다).

### 4-3. `p4b/actordata` @ `a4a64d2` — 단계 3a (캐릭터 데이터 층), 6 커밋
- **한 일**: `src/actors/data/{limits, freeze, geom, schema, index, roster}.js`, `skeletons/biped.js`, `characters/{jara, dokkaebi, tokki, kongjwi}.js`(설계서 §2-6 초안 수치), `test/fixtures/characters-v1/*`(견우·직녀·심청·흥부 제안 윤곽, 흥부 disguise=도깨비 선언 예외 포함), `test/fixtures/characters-negative/*`(음성 정의 25개).
- ⚠ **`npm test` 가 79/79 라고 나오지만 의미 없다.** `node --test` 는 `test/` 아래 **모든 .js/.mjs 를 테스트로 실행**하므로 데이터 fixture 43개가 "통과한 테스트"로 세어진 것이다. **실제 단위 테스트(`test/actor-data.test.mjs`)는 아직 없다.** fixture 를 `test/` 밖(예: `test-fixtures/`)으로 옮기거나 `package.json` 의 test 스크립트에 glob 을 지정해 고칠 것 (이 함정은 래그돌 fixture 에도 그대로 적용된다).
- **남은 것**: 설계서 §2·§13(3a) 검증 항목 — 8종(v0 4 + v1 fixture 4) 검증 통과, 음성 fixture 마다 throw/problem, `src/**` 에서 로스터 id 문자열 리터럴 0, JSON 왕복 동일(순수성), roster.js 린트, `buildRest` 결정성, 외견 해석(`rigOf`), `estimateTris ≤ 25,000`. 독립 적대 검증.

### 4-4. 단계 5 (PBD 래그돌) — **미착수** (커밋 0)
설계서 §6. 합성 템플릿으로 먼저 개발하고 나중에 `biped.js` 로 바꿔 끼우는 방식. 래그돌 fixture 도 `test/` 밖에 둘 것(§4-3 함정).

### 4-5. 구현 순서와 의존 (설계서 §13, 요약)
```
0 스캔·결정요청 → 1 노출동결(진행) → 2 차폐v2 (결정 #1) → 3a 데이터(진행) → 3b 포즈/리그/히트박스 → 3c 메시생성
→ 3d 실루엣 지표/예측 → 4 ActorSim → 5 래그돌 → 6 룩/팀색 → 7 내비 → 8 ActorView/풀 → 9a 통합 → 9b 샷3 액터(결정 #3)
→ 10 determinismaudit·surfaceaudit·시간조각 → 11 silhouetteaudit 1차 실측 **(보고 후 정지)** → 12a 조명 → 12b 규칙·체인 편입
→ 13 노출 값 확정 → 14 종료 체인 + 실 GPU 실측
```
재개하는 세션이 처음 할 일은 §10 체크리스트.

---

## 5. 새 컴퓨터 준비

### 5-1. 설치
| 항목 | 값 | 비고 |
|---|---|---|
| Node.js | **22.x** (컨테이너 22.22) | `package.json` 은 ESM(`"type":"module"`) |
| git | 최신 | Windows 는 `git config core.autocrlf false` 권장 (CRLF 가 셰이더 문자열·해시에 섞이지 않게; 추정) |
| 브라우저 | Chrome/Edge 최신 (실측 A 경로) + Playwright Chromium (`playwright 1.56.1` → `chromium-1194`) | 도구는 Playwright 가 받는 Chromium 을 쓴다 |
| bash | `tools/gates.sh` 는 bash | Windows 는 WSL2 또는 Git Bash. **게이트 체인은 새 컴퓨터가 아니라 CI 에서 돌리는 것을 권장**(§9) |

```bash
git clone https://github.com/junlee122-bot/fps.git && cd fps
git checkout r4-wip
npm ci
npx playwright install chromium          # 이미 chromium-1194 가 있으면 건너뜀
echo '.claude/' >> .git/info/exclude     # 에이전트 워크트리는 커밋 금지
npm test                                  # 기대: tests 36 pass 36 fail 0 (r4-wip 머리 기준)
bash tools/gates.sh --list                # 게이트 19단계 이름이 순서대로 나와야 함
```
이 다섯 줄이 통과하면 환경은 쓸 만하다. (컨테이너에서 같은 순서로 확인함 — 새 컴퓨터에서의 확인은 **미검증**.)

### 5-2. Windows 에서의 알려진 함정 (추정 포함)
- `tools/lib/pinned.mjs` 는 `git worktree add` + 디렉터리 심볼릭 링크(`node_modules`)를 만든다. Windows 는 심볼릭 링크에 개발자 모드/관리자 권한이 필요 → **`FPS_NO_PIN=1`** 로 스냅샷 고정을 끄고 작업 트리를 직접 서빙한다(개발용; 결과가 SHA 로 고정되지 않는다).
- `tools/gates.sh` 의 `date`·`tee`·`grep` 은 GNU 도구 전제. WSL2/Git Bash 에서 쓸 것.
- 렌더 도구의 `/tmp/fps-render.lock` 경로는 POSIX. Windows 네이티브에서는 렌더 도구를 한 번에 하나만 직접 돌리면 된다.

---

## 6. GPU 가 하는 일, 하면 안 되는 일 ← 가장 중요

컨테이너·CI 의 모든 게이트는 **소프트웨어 GPU(SwiftShader)로 강제**된다 (`tools/lib/browser.mjs` 의 `LAUNCH_ARGS`: `--use-angle=swiftshader`). 픽셀 게이트(baseline·imagediff)는 이 조건에서만 **비트 동일**하다.

| 하고 싶은 일 | GPU | 근거·방법 |
|---|---|---|
| **실 GPU 성능 실측** (fps·프레임 시간·히치·부팅) | **✅ 이게 목적** | `docs/PROFILE-RUN.md` A(브라우저, 설치 0) 또는 B(`node tools/profile.mjs --phase p3 --runs 3 --gpu > profile-gpu.json`, 창이 필요하면 `--headful`). `banners` 에 `GPU-INVALID` 가 없어야 유효. **P4B 종료 전 1회, P4 종료 전 필수** |
| 개발 중 눈으로 보는 캡처·후보 비교 (조명 L0/B/C/D, 캐릭터 룩, 등) | ✅ 가능(빠름) | 환경변수 **`FPS_GPU=1`**(또는 `FPS_HEADFUL=1`)이면 `launchBrowser()` 를 쓰는 모든 도구가 소프트웨어 강제를 푼다 (`tools/lib/browser.mjs:40`). 발주자가 캡처를 보고 판단하는 단계(결정 #2·#4·#5·#7)에 쓸 수 있다. **수치 판정은 하지 않는다** |
| `baseline` · `imagediff` · `rendervariance` · `albedoaudit` · `viewmodelaudit` · `harnesstest` · `playtest` · `shotaudit` 등 **게이트** | ❌ **GPU 금지** | 실 GPU 는 SwiftShader 와 픽셀이 다르다(CONTRACT-NOTES A3/B5: 머신 간 이식 안 됨). ⚠ **`FPS_GPU=1` 상태로 게이트 도구를 돌리는 것을 막는 가드가 아직 없다** → 해야 할 일 (§10-7) |
| silhouetteaudit 의 **판정 수치**(대비·4축) | ❌ SwiftShader | 계약 조건(1512×982 DPR 2, 노출 잠금)에서 재야 한다 |
| 게이트 체인 전체 (≈21 시간) | CI 권장 | §9 |

### 골든 해시 — 새 컴퓨터가 게이트와 같은 픽셀을 내는지 확인
기준: 커밋 `9408b49` 의 `src`·`index.html`·`tools/shots.js` (`r4-wip` 에서 P4B 병합 전까지 동일). CI 러너 2대와 컨테이너 1대가 **12/12 비트 동일**했다 (Linux x64, chromium-1194, SwiftShader). 1512×982 @DPR2, settle 90.

| 샷 | sha256 (png) | programs | triangles | drawCalls |
|---|---|---|---|---|
| courtyard_noon | `1281bb7eaae67b5cd33ea75b0f0174b4717a040f7b80b4a9c63edf9e70718c2d` | 44 | 371666 | 1625 |
| daecheong_backlit | `a0063d1221d775b70bf3f3851f2076531ca66c0643e859104d1d13b3820002ef` | 44 | 408104 | 1889 |
| hanji_silhouette | `23c66e4b63adc3991146c05a1b8eb8e28dcb2e444a3cc7340cc6bb5e5c2f2a68` | 44 | 393742 | 1850 |
| dancheong_closeup | `be07db77df9c3e60ea141698967082e7d0b02eadca864bf55d5fe44dbb1d046e` | 44 | 229236 | 933 |
| roofline_distant | `fbb8b364ac7677b3ab813329da0b74c53c3aa57ff24a5c02fab4175270d47fa6` | 44 | 332480 | 1673 |
| lantern_night | `494559e34808501d17b11dc817b7ab7695b9a4939a3245d10220eb0e88d3981d` | 44 | 79100 | 702 |
| fog_wall | `313a247d00d2fe0864c9e4c33d6e412a225093e202df57d224b22adcc643cbdf` | 44 | 231410 | 1059 |
| muzzle_interior | `9ae29cc593bde8f626e33cc0be4515972832bfbcb0243df11263b9ce6f4a5223` | 44 | 263018 | 1420 |
| hanji_pierced | `e558699a8e4699eefa737b287ac5cde77e8597a445b158f1bcc8a75567bc3b87` | 44 | 248416 | 1071 |
| corridor_columns | `5cd57f16f233478a9c853bcda9ca87e6b3088c2d1fe7883cd6dc3e65bcaa4633` | 44 | 327552 | 1548 |
| viewmodel_ads | `9b822529918c49b25b86e2b7c30266894c25e368c0179c7fa16cb8bfd7f7703e` | 44 | 336992 | 1449 |
| tile_fall | `c2e735894f85e93741427c0f0d79dd6ff582a06f3d23adb2aa784d6eedef9779` | 44 | 35566 | 272 |

오디오 시나리오 해시(SHA-256, L+R Float32): `e98b5ee9f69862f2c6ac114a8a3eb4b6a5c373bfd3036e7ce2555762b2fcab7c` (192000 샘플).

확인 절차 (`FPS_GPU` **없이**; 샷 1장 ≈ 18 분 @컨테이너 SwiftShader):
```bash
node tools/baseline.mjs --out=tmp/xcheck --shots=courtyard_noon
node -e "const r=JSON.parse(require('fs').readFileSync('tmp/xcheck/report.json','utf8'));console.log(r.shots[0].sha256, r.audioHash.scenarioHash)"
```
첫 값이 위 표와 같으면 이 컴퓨터는 게이트 동등 환경(적어도 그 샷). **다르면 이 컴퓨터는 게이트를 못 돌린다** — Windows/macOS 에서 Linux 와 SwiftShader 결과가 같은지는 **미검증**이다. 달라도 정상일 수 있으니 그 경우 게이트는 CI 에서만 돌린다. (`--shots` 부분 실행이라 `NON-CONTRACT` 배너가 뜨지만 sha256 은 유효하다.)

**재현 기록 — GPU 컴퓨터(Windows), 2026-10-09 UTC.** 이 컴퓨터는 골든 해시를 **12/12 비트 동일**로 재현했다. 따라서 Windows 네이티브 + SwiftShader 도 Linux 러너·컨테이너와 같은 픽셀을 낸다(이 컴퓨터에서 실측).

| 항목 | 값 |
|---|---|
| 컴퓨터 | Intel Core Ultra 5 250K Plus (18코어/18스레드) · RAM 31.3 GB · NVIDIA GeForce RTX 5060 Ti(드라이버 32.0.16.1742) + Intel Graphics · Windows 11 Home |
| 실행 환경 | Node 22.23.2 · Playwright 1.56.1 · chromium-1194 · `FPS_GPU` 없음(SwiftShader 강제) · `FPS_NO_PIN=1`(Windows 심볼릭 링크 회피 — 깨끗한 워크트리를 직접 서빙, §5-2) · `git config core.autocrlf false` |
| 1샷 확인 | `r4-wip` `6cec35e` · courtyard_noon sha256·programs 44·triangles 371666·drawCalls 1625·오디오 `e98b5ee9…ab7c`(192000) 모두 표와 같음 · **205.16 s** (16:56:58Z → 17:00:23Z) |
| 12샷(체크포인트 ①) | `p4b/exposure` `c6d6069`(노출 구조 동결) · 계약 조건(1512×982@2x, settle 90, `nonContract=false`) · 12샷 sha256·programs·triangles·drawCalls 와 오디오 해시가 모두 표와 같음 · **3213.54 s** (17:07:16Z → 18:00:50Z, 앞쪽 일부 구간은 노드 시험과 병행) |

이 컴퓨터에서는 baseline 류 렌더 게이트를 직접 돌릴 수 있다(샷당 ≈3.4–4.5 분, 컨테이너 ≈18 분). `gates.sh` 체인 전체는 bash·`/tmp` 경로 전제(§5-2)라 여전히 CI 를 권장한다.

---

## 7. 실 GPU 실측 (종료 게이트) — 요약

전체 절차는 `docs/PROFILE-RUN.md`. 핵심:
1. 배포 주소 `https://joseon-cqb.vercel.app/?mode=realtime` (또는 로컬 `npm run build && npm run preview`) → 상단 배너의 `build <해시>` 를 적어 둔다.
2. 클릭(포인터 락) → 30 초 걷고 창호지에 카빈 3–4발, 기와 1–2발 → Esc.
3. F12 콘솔에 PROFILE-RUN §A-3 의 한 줄을 붙여 JSON 을 복사. `renderer` 에 SwiftShader/llvmpipe/Software 가 있으면 GPU 를 못 잡은 것.
4. 3회 반복해 JSON 3개를 회신.
기준점(비교용, 컨테이너 SwiftShader): drawCalls 480–486 · trisFrame p95 122,610 · programs 44 · cpuFrameMs p95 1.78–2.75 ms. 플레이 중 컴파일 0, 지평선 판독 0 이어야 한다.

---

## 8. GPU 로 개발 속도를 올릴 수 있는 곳 (P4B 단계별)

| 설계서 단계 | GPU 로 가속 | 비고 |
|---|---|---|
| 11 silhouetteaudit 1차 실측 — 조명 후보 L0/B/C/D 캡처 비교 | 눈으로 보는 비교 캡처 | 판정 수치(.15 대비, 4축)는 SwiftShader 로 재측정해 보고 |
| 6 액터 룩·팀 색 (LACQUER/BRONZE 변형, 단청) | 룩 반복 확인 | 팔레트 위반율(1.5 %)은 paletteaudit(SwiftShader)으로 |
| 13 노출 E1–E4 (`tools/exposureprobe.mjs`, 보고 전용·비게이트) | 적응 곡선 확인 | 최종 값은 계약 조건에서 |
| 14 실 GPU 실측 | **필수** | §7 |

게이트 시간이 병목이므로(§9) GPU 컴퓨터의 가장 큰 효용은 **눈으로 보는 반복(캡처)과 종료 게이트의 실 GPU 실측**이다.

---

## 9. 게이트 체인 실행 — CI 를 쓰는 이유와 방법

**컨테이너는 체인을 끝내지 못했다** (§12): 생존 창 2–4.5 h < baseline 3.7 h·profile 5 h. 그래서 `.github/workflows/gates.yml` 로 옮겼다.

- 트리거: `chain-ci/**` 브랜치 푸시 또는 Actions 탭의 *Run workflow*.
- 구조: `tools/gates.sh` 의 구간 모드(`GATES_FROM`/`GATES_TO`) + 시간 조각(baseline `FPS_MAX_NEW_SHOTS`, profile `FPS_MAX_NEW_RUNS` → **exit 75 = 조각 끝**, 다음 잡이 산출물을 받아 `RESUME=1`)으로 **잡 10개를 `needs` 순차** 실행. 마지막 `coverage` 잡이 `gates.sh --list` 의 모든 단계 `exit=0`·실패 줄 0·pinned sha 단일(=실행 커밋)을 대조해 `ALL GREEN (CI, <sha>)` 를 낸다.
- ⚠ **10잡 시간 조각 버전은 CI 에서 한 번도 돌지 않았다** (로컬로 baseline 2샷·profile 2런 조각을 확인했을 뿐). 첫 사용은 검증 실행이라고 생각할 것. 시험 실행 1 은 6잡 구버전(`chain-ci/trial1`)이었고 profile 잡이 6 h 상한에 취소돼 `chain-finish/trial1` 로 마무리했다.
- 실측 소요 (CI 러너 ubuntu-latest 4 vCPU): harnesstest 2 h 42 m · statics 52 m · baseline1 5 h 39 m · baseline2 3 h 54 m · post 43 m · profile 런 ≈2 h 09 m × 3 + 스윕 ≈ 7 h 15 m ⇒ **합계 ≈21 시간**. 산출물 보관 14일(최종 요약 90일).
- 이 환경(Claude Code 클라우드 컨테이너)에서 `gh api` 는 아티팩트 다운로드가 막혀 있다(타 호스트 리다이렉트 거부). 새 컴퓨터의 `gh` 는 정상일 것이다. 아티팩트 URL 은 Actions 웹 UI 에서 받으면 된다.
- 재개: 컨테이너/로컬 실행이 끊기면 같은 출력 디렉토리에서 `RESUME=1 bash tools/gates.sh <디렉토리>`. **SUMMARY.txt 첫 줄(pinned sha·dirty)이 글자까지 같을 때만** 재개되므로 **커밋된 깨끗한 트리**에서만 성립한다.
- **체인의 정식 실행 장소를 CI 로 옮기는 것은 발주자 결정 사항**으로 남아 있다. P4A 는 CI 결과로 배포 브랜치를 FF 했다 — 발주자가 컨테이너/로컬 실행만 인정하면 FF 를 되돌리고(`claude/new-session-qfglz6` 를 `1ed693f` 로) 다시 돌린다.

---

## 10. 이어서 할 일 — 순서 있는 체크리스트

1. **환경 확인** (§5-1) → 골든 해시 1샷 확인 (§6, 선택).
2. **읽기**: 이 문서 → `docs/P4B-DESIGN.md`(§0 요약 · §11 결정표 · §13 순서 · 부록 R2) → `docs/CONTRACT-NOTES.md` 「P4B 착수 전 스캔」·「P4 착수 판정」 → `docs/P4-LOG.md`.
3. ~~발주자에게 결정 요청 #14·#1~~ **완료 — 승인(2026-10-09).** 다음 결정 요청은 단계 9b 전 #3(4종 면적 실측표와 함께), 단계 11 보고 때 #2·#4·#5·#7·#20.
4. **`p4b/exposure` 마무리·병합**: 체크포인트 ① 확인 → 전체 playtest 1회 → 독립 검증 → `r4-wip` 병합.
5. **`p4b/actordata` 마무리**: fixture 를 `test/` 밖으로 → `test/actor-data.test.mjs` 작성(§4-3 목록) → 독립 검증 → 병합.
6. **단계 5 래그돌** (설계서 §6) → 검증 → 병합.
7. (선택·권장) **게이트 도구 가드**: `FPS_GPU=1` 인 채 `baseline`/`imagediff`/`playtest`/`harnesstest` 등을 돌리면 exit 2 로 거부 — 새 컴퓨터에서 실수로 게이트를 GPU 로 돌리는 일을 막는다(새 게이트가 아니라 기존 도구의 안전장치이므로 발주자 보고 후).
8. 다음 묶음: 3b·3c(+ **4종 면적 헤드리스 실측 → 결정 #3 재요청**), 2(차폐 v2, 결정 #1 후), 4, 6, 7(부록 R2-2 반영 후), 8, 9a, 9b, 10, **11(보고 후 정지)**, 12a/b, 13, 14.
9. **작업 방식 팁**: 이전 세션은 Claude Code 의 `Workflow` 도구(`docs/p4b/workflow-scripts/*.js`)로 구현자들을 git 워크트리에 병렬로 풀고 브랜치별 독립 검증을 붙였다. 사용량 한도에 두 번 걸렸다 — 큰 워크플로는 단위를 작게 나누고, 끊기면 워크트리의 미커밋 변경을 WIP 로 커밋해 브랜치로 보존한 뒤 이어 돌릴 것(이번에 그렇게 했다).

---

## 11. 발주자 결정 — 대기 / 이미 내려진 것

### 대기 (추천안은 `docs/P4B-DESIGN.md` §11, 요약은 `CONTRACT-NOTES.md` 「P4B 착수 전 스캔」)
| # | 결정 | 먼저 필요한 이유 |
|---|---|---|
| ~~14~~ | ~~디렉터리 소유권~~ | **승인 2026-10-09** (ARCHITECTURE.md §1 에 `src/actors` 행 추가 완료) |
| ~~1~~ | ~~창호지 차폐 모델 개정~~ | **승인 2026-10-09** (`CONTRACT-NOTES.md` 판정 기록) |
| 3 | 샷 3 더미 → 액터 (정체 추천은 4종 면적 실측 후 재요청) | `hanji_silhouette` 기준 이미지 변경 |
| 2·4·5·7·20 | 조명 구성 · 4축/ρ/자세 · 대비 공식 · 팀 대역/등껍질 재질/무기 금속 · 투영 불가 특징(콩쥐 치마단) | 단계 11 캡처를 본 뒤 |
| 11 | 노출 동결 값·시점 (구조는 현재값으로 먼저 동결) | 단계 13 측정 뒤 |
| 그 밖 | 6·8·9·10·12·13·15–19 | 후보로 진행하고 종료 보고에서 확인 |

### 그 밖의 대기 항목
- **audioaudit 청감 판정** — 3쌍(창살–천, 기둥–초가, 기둥–지붕흙)이 들리는 축 1개. 청감 파일 `docs/audio-listen/`. 판정 후 `tools/gates.sh` 의 주석을 푼다.
- **체인 실행 장소 = CI 로 이전** (§9).
- **GitHub Pages**: 리포 설정(Settings → Pages → Source = GitHub Actions)이 꺼져 있어 `pages.yml` 의 배포 단계가 매번 실패한다(빌드는 성공). Vercel 프로덕션은 정상. 켤지는 발주자 설정 사항.
- **실 GPU 실측**: 이 새 컴퓨터에서 수행(§7).

### 이미 내려진 결정 (되묻지 말 것)
HANJI_BASE_OPACITY = 1.0 · 구멍 p = 9, T = 6 · "산탄은 창살을 뚫지 못한다"는 계약 작성자 오류(장부 #26) · 6 m 산탄 p_min = 4 는 게임 정보 · 게이트 목록 원본 = gates.sh · imagediff = 같은 커밋 2회 비트 동일(저장 기준선 차분은 정보용) · distaudit 가 Vercel 미리보기 확인을 대체 · 직녀 방패 = EARTH_WALL 재사용 · 장독 = ROOF_TILE + 내구도(깨짐은 관통과 무관하게 명중으로 판정, 모든 무기) · §4-6 벽 접근권은 `tools/wallaccess.mjs` 기계 표가 권위 · 수신처 **W1 — 월드·아트 회귀**(`docs/contracts/briefs/W1-RECEIVING.md`, P5 질문 "벽 너머 사격에 히트마커를 줄 것인가 — 주면 맹사가 레이더가 된다") · P3 종료.

---

## 12. 알려진 함정과 교훈

- **컨테이너 회수** (P4A 체인 소실 6회): 사용자 입력 없이 세션이 2–4.5 h 지나면 워커가 멈추고 컨테이너가 재시작되어 `nohup` 체인이 죽는다. "14 h 간격"·"예약 웨이크가 원인"이라는 초기 추정은 **둘 다 틀렸다.** 긴 작업은 CI 로.
- **사용량 한도**: 대형 워크플로(에이전트 6~7개 × 수 시간)가 두 번 걸렸다. 단위를 작게.
- **`node --test` 는 `test/` 아래 모든 .js/.mjs 를 실행한다** (§4-3).
- **`.claude/`**(에이전트 워크트리)는 `.git/info/exclude` 로 제외 — 훅이 untracked 로 보고 커밋을 요구한다.
- **재개 규칙**: 더러운 트리는 `git stash create` 가 부를 때마다 SHA 가 달라 `RESUME=1` 이 거부된다.
- **`gh` 제약(클라우드 컨테이너)**: 아티팩트 다운로드 리다이렉트 거부, Pages API 접근 거부. MCP github 도구로 우회했다.
- **노드 vs 브라우저 비트 동등성**은 선례가 없다 — 설계서는 부팅 throw 를 정수 지문·파라미터 해시로 제한했다(결정 16).
- 문서 내 수치는 날짜가 있다. 최신은 `docs/P4-LOG.md`·`CONTRACT-NOTES.md` 의 가장 아래.

---

## 13. 새 Claude Code 세션 시작 프롬프트 (복붙용)

```
저장소 JOSEON-CQB (junlee122-bot/fps) 의 r4-wip 브랜치에서 이어 작업한다.
먼저 docs/HANDOFF-GPU.md 를 끝까지 읽고, 이어서 docs/P4B-DESIGN.md (§0, §11, §13, 부록 R2) 와
docs/CONTRACT-NOTES.md 의 「P4B 착수 전 스캔」을 읽어라. 보고는 한국어로만, 계측으로만 말하고,
게이트 임계를 발명하지 마라(014-C). 규칙은 HANDOFF §1.
이 컴퓨터는 GPU 가 있다. 게이트 도구는 FPS_GPU 없이(소프트웨어 렌더) 돌리고, 실 GPU 실측은 docs/PROFILE-RUN.md 로 한다.
할 일: HANDOFF §10 체크리스트 1~6 순서대로. 발주자 결정 #14·#1 이 먼저 필요하니 질문을 정리해서 먼저 보여줘라.
```

---

## 14. 파일 지도 (읽는 순서)

| 파일 | 내용 |
|---|---|
| `docs/HANDOFF-GPU.md` | 이 문서 |
| `docs/P4B-DESIGN.md` | **P4B 설계서** (개정 2 + 부록 R2) |
| `docs/p4b/README.md`, `docs/p4b/inputs/*`, `docs/p4b/workflow-scripts/*` | 설계 입력(지도 6·설계안 3·심사·검토 3)과 워크플로 스크립트 사본 |
| `docs/CONTRACT-NOTES.md` | 계약 해석·충돌·오류 장부 (맨 아래가 최신: P4B 착수 전 스캔) |
| `docs/P4-LOG.md` | P4A 병합·체인 소실 6회·구조 조치·CI 결과·배포 확인 |
| `docs/contracts/briefs/P4-BRIEF.md` | P4 계약 (§3 = P4B) |
| `docs/contracts/briefs/W1-RECEIVING.md`, `docs/P3-DEBT.md`, `docs/CARRYOVER-AUDIT.md` | 이월·수신처 |
| `HARNESS.md` · `ARCHITECTURE.md` | 하네스·도구 규칙, 서브시스템 소유권 |
| `docs/PROFILE-RUN.md` | **실 GPU 실측 절차** |
| `docs/DEPLOY.md` | 배포(Vercel 우선, Pages) |
| `tools/gates.sh` · `.github/workflows/gates.yml` | 게이트 목록 원본 · CI 체인 |
