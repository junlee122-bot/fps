# 실기 성능 실측 절차 (PATCH-010-D) — Windows 기준, Linux/macOS 동일

목적: **SwiftShader 가 아닌 실제 GPU** 에서 `profile.mjs` 를 돌려 `gpuDependent` 수치를 얻는다. 플랫폼 간 절대 비교가 아니라
**자기 자신과의 시계열 비교**가 목적이므로 결과 JSON 은 GPU 식별자·해상도·DPR·기동 경로를 함께 담는다. 결과에 `GPU-INVALID` 배너가
**뜨지 않으면** 유효한 측정이다. (컨테이너 기본 경로는 결정성을 위해 SwiftShader 를 강제한다 — 실기에서는 반드시 `--gpu` 를 붙인다.)

> 이 절차는 R4 병합 이후 커밋(실 GPU 플래그 `--gpu`·`--headful` 포함)에서 유효하다. 그 전 커밋(1f251b9·d47fbe5 등)에는 플래그가 없어 항상
> SwiftShader 로 돈다. 병합 커밋 해시는 CONTRACT-NOTES "R4" 기록에 적는다.

## 1. 준비 (1회)
1. **Node.js 22 LTS** 설치 — https://nodejs.org (설치 후 새 터미널에서 `node -v` 가 v22.x).
2. **Git** 설치 후 저장소 클론:
   ```
   git clone https://github.com/junlee122-bot/fps.git
   cd fps
   git checkout <측정 커밋>
   ```
3. 의존성 설치(three · playwright · pngjs):
   ```
   npm ci
   ```
4. Playwright Chromium 설치(≈150 MB):
   ```
   npx playwright install chromium
   ```
   회사 프록시 뒤라면 `HTTPS_PROXY` 를 설정한 뒤 다시 실행.

## 2. 실행
PowerShell 또는 cmd 에서 저장소 루트로 이동한 뒤:
```
node tools/profile.mjs --phase p3 --runs 3 --gpu > profile-gpu.json
```
- `--gpu` : 소프트웨어 렌더러 강제 해제 + GPU 차단 목록 무시 (Windows 는 ANGLE D3D11).
- 창 없이(헤드리스) GPU 를 못 잡는 환경(일부 노트북·원격 데스크톱)이면 **헤드풀 경로**:
  ```
  node tools/profile.mjs --phase p3 --runs 3 --gpu --headful > profile-gpu.json
  ```
  창이 하나 뜨고 30 s × 3회 자동 재생된다. 측정 중 창을 건드리지 말고 다른 앱을 띄우지 마라.
- 환경변수로도 같은 효과: `set FPS_GPU=1` / `set FPS_HEADFUL=1` (PowerShell: `$env:FPS_GPU=1`).
- 기본 인자(30 s · 3회 · DPR 2 · 1512×982)가 계약 조건이다. 축소 인자를 주면 JSON 에 `NON-CONTRACT` 배너가 박힌다.
- 소요 ≈ 3–5 분(부팅 3회 포함). 콘솔 stderr 에 진행이 찍히고 결과 JSON 은 stdout(위 리다이렉트 파일).

## 3. 결과 확인
`profile-gpu.json` 을 열어:
1. `banners` 에 **`GPU-INVALID` 가 없어야** 한다. 있으면 `environment.renderer` 를 확인 — `SwiftShader`/`llvmpipe`/`Software` 면 GPU 를
   못 잡은 것 → `--headful` 로 재시도, 그래도 안 되면 그래픽 드라이버 갱신·원격 세션 여부 확인.
2. `environment` : `renderer`(UNMASKED_RENDERER_WEBGL — GPU 식별자) · `vendor` · `platform` · `drawingBuffer`(해상도) · `dpr` · `launch`(gpu/headful/인자).

## 4. 회신 항목 (PATCH-005-H/010-D)
JSON 에서 아래를 그대로 보낸다(파일 전체를 보내면 가장 좋다):

| 항목 | JSON 경로 |
|---|---|
| fps p50 | `gpuDependent.fps_p50_median` |
| fps p99 | `gpuDependent.fps_p99_median` |
| 최악 프레임 | `gpuDependent.frame_worst_max` |
| 부팅 CPU / GPU | `bootCpu` / `bootGpu` |
| CPU 프레임 p95 | `leadingIndicators.cpuFrameMsP95` |
| 플레이 중 지평선 판독 | `gpuDependent.horizonReadbacksDuringPlay_total` (**0** 이어야 함) |
| GPU 식별자 | `environment.renderer` (+ `vendor`, `platform`, `drawingBuffer`, `dpr`) |

## 5. 문제 해결
- `npx playwright install` 이 실패: 네트워크/프록시. 오프라인이면 다른 PC 에서 받은 브라우저 폴더를 `%USERPROFILE%\AppData\Local\ms-playwright` 에 복사.
- "포트" 오류: 도구는 127.0.0.1 의 임의 포트를 쓴다 — 방화벽이 로컬 루프백을 막으면 허용.
- 결과가 매번 크게 다르면: 전원 옵션 "고성능", 배터리 대신 전원 연결, 백그라운드 앱 종료 후 재실행. 3회 중앙값을 쓴다.
- 눈으로 보는 경로(선택): `npm run serve` 로 로컬 서버를 띄우고 브라우저에서 `http://127.0.0.1:<포트>/?mode=realtime` 를 열면 실시간 모드로
  플레이된다(히치 귀속은 없음, 체감 fps·룩 확인용). 정적 배포는 import map 이 `/node_modules/three/...` 를 가리키므로 별도 번들이 필요 — 미제공.
