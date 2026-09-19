# 플레이·확인용 정적 배포 — P5 요구사항 (2026-09-19 준비, 발주자 요청 CONTRACT-NOTES "추가 요청 2건 — 2")

**이 배포는 게이트 대상이 아니다.** 게이트(픽셀 비트 동일·profile·감사)는 `tools/lib/server.mjs` 가 리포 루트를 그대로 서빙하는 **dev 빌드**
(index.html import map → `/node_modules/three/…`, 번들 없음)에서만 판정한다. 배포본은 `vite build` 가 만든 미니파이·트리셰이킹 번들이며
게이트가 검증한 것과 동일하다는 보장이 없다 — `window.__harness` 가 남아 있어도 지원하지 않고, 배포본에서 본 현상이 게이트된 버전에 없을 수
있다. 배포 페이지 상단에 **"플레이·확인용 빌드. 게이트 대상 아님 — build <sha7>"** 배너를 빌드 시 삽입한다(소스 index.html 은 바뀌지 않는다).
아래 §4 의 선택 검증(프로덕션 빌드에 baseline 1회 → dev 와 픽셀 동일)이 통과하면 그 커밋에 한해 이 단서를 지울 수 있다.

## 1. 빌드
```
npm ci                # devDependency 에 vite 포함 (설치·잠금은 R3 게이트 종료 후 실행 — 아래 상태)
npm run build         # → dist/  (base '/')
DEPLOY_BASE=/fps/ npm run build   # GitHub Pages 등 하위 경로 호스팅
npm run preview       # dist/ 를 로컬에서 확인
```
`vite.config.js` — 빌드 시에만 HTML 변환: import map 제거(번들이 three 포함), 배너·`noindex` 삽입. `build.target: es2022`(main.js 의 top-level await).
`src/main.js` 가 `../tools/shots.js` 를 정적 import 하므로 샷 정의도 번들에 들어간다. 에셋 파일 0개(PATCH-010-A 캐릭터 에셋이 들어오면 `public/` 또는
import 경로로 포함 — 그때 갱신).

## 2. Vercel (우선)
발주자 계정. GitHub 리포 `junlee122-bot/fps` 를 Vercel 프로젝트로 import 하면 `vercel.json`(framework vite, `npm run build`, `dist`) 대로 빌드된다.
- 프로덕션 브랜치: 발주자 선택(기본 `main`). 다른 브랜치·커밋마다 **프리뷰 URL** 이 생겨 "어느 상태를 보고 있는지"가 URL 에 고정된다 — 배너의
  `build <sha7>` 은 `VERCEL_GIT_COMMIT_SHA` 에서 온다.
- 워크플로 파일 불요. private 리포 가능. 환경변수 불요(`DEPLOY_BASE` 미설정 = '/').
- 이 세션에서 Vercel 프로젝트 생성·배포는 하지 않았다(발주자 계정에 외부 공개 대상을 만드는 행위 — 발주자가 직접 import 하거나 지시할 때 수행).

## 3. GitHub Pages (차선)
Actions 필요, private 리포는 유료 플랜. 워크플로: `DEPLOY_BASE=/fps/ npm run build` → `dist/` 를 `actions/deploy-pages` 로 게시. 배너 sha 는 `GITHUB_SHA`.
Vercel 이 막힐 때만.

## 4. 선택 검증 — "배포된 것이 곧 게이트된 것" 증명
```
npm run build
FPS_SERVE_ROOT=$PWD/dist node tools/baseline.mjs --out tmp/prod_baseline   # 같은 캡처 도구, 서빙 루트만 dist/
node tools/imagediff.mjs baseline/<현재 라운드> tmp/prod_baseline           # changedPx = 0 이면 픽셀 동일
```
`FPS_SERVE_ROOT` 가 설정된 실행은 계약 판정이 아니다(server.mjs 주석). dist/ 의 index.html 에는 배너가 있으므로 상단 띠 영역은 다를 수 있다 —
배너 높이만큼의 차분이 전부이면 "배너 외 픽셀 동일"로 기록한다. 결과는 CONTRACT-NOTES 에 커밋 sha 와 함께 적는다.

## 상태 (2026-09-19) — 빌드·선택 검증 완료

- [x] `vite.config.js`, `vercel.json`, `package.json` scripts(build/preview), `server.mjs` FPS_SERVE_ROOT.
- [x] **`npm install -D vite` + `npm run build` 통과** — `dist/index.html` 0.80 kB, `dist/assets/index-*.js` 795 kB(gzip 224 kB), 빌드 574 ms.
  import map **제거 확인**(`grep -c importmap dist/index.html` = 0), 배너 **삽입 확인**(`grep -c "게이트 대상 아님"` = 1).
- [x] **§4 선택 검증 통과 — 배너 행을 빼면 픽셀 동일.** 저해상(756×491, dpr 0.5) 12 샷을 `FPS_SERVE_ROOT=$PWD/dist` 로 캡처해 dev 빌드와 비교:
  **전 12 샷이 y = 0..9 (배너 띠) 에서만 다르고 그 아래는 완전 동일**. 태그 마스크(`.emask.png`)는 12/12 `changedPx = 0`.
  샷당 변경 7,294–7,560 px = 756 × 10 행(배너 높이). 최대 변경 행 y = 9.

  > **이 커밋(ecec7a8 계열)에 한해 "배포된 것이 곧 게이트된 것"이 성립한다 — 단 배너 띠 10 행은 제외이고, 검증 해상도는 계약 해상도(3024×1964)가 아니라
  > 저해상 756×491 이다.** 계약 해상도 재검증은 비용(샷당 25–80 분) 때문에 하지 않았다. 코드 경로·지터·샷 정의가 같으므로 저해상 동일성은 강한 증거지만
  > **동일성 증명은 측정한 해상도에서만 유효하다.**

- [ ] Vercel import — 발주자 계정 작업(이 세션에서 하지 않는다).
