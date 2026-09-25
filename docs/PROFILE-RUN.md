# 실기 성능 실측 절차 — Windows · 브라우저만 있으면 된다 (P4-BRIEF 서두 표, PATCH-010-D)

**왜 재는가**: 컨테이너의 모든 게이트는 소프트웨어 GPU(SwiftShader)에서 돈다. 진짜 fps · 히치 · 부팅 GPU 시간은 **실제 그래픽카드**에서만 나온다.
**어떤 기계인가**: 발주자가 **지금 가진 아무 컴퓨터**. 노트북 내장 그래픽이어도 된다 — 친구들이 실제로 쓸 기계에 더 가깝다.
**언제**: P4B 종료 전 1회, 그리고 P4 종료 전 필수(종료 게이트).

## A. 브라우저 경로 (권장 — 설치 0, 5 분)

### 1. 준비
- **Chrome 또는 Edge** 최신판. 다른 앱은 닫고, 노트북이면 **전원 연결**, 전원 옵션 "고성능".
- 배포 주소를 연다:
  - GitHub Pages: **`https://junlee122-bot.github.io/fps/?mode=realtime`**
  - (Vercel 미리보기를 쓰면 그 주소 뒤에 `?mode=realtime` 을 붙인다)
- 상단에 "플레이·확인용 빌드 — build <해시>" 배너가 보인다. **그 해시가 재는 커밋이다** — 회신에 그대로 적는다.
- 페이지가 열린 뒤 **첫 화면이 뜰 때까지 기다린다**(내장 그래픽에서 10~40 초). 검은 화면에서 멈추면 §C.

### 2. 30 초 플레이
1. 화면을 **클릭**해 마우스를 잡는다(포인터 락). 이때 소리도 켜진다.
2. WASD 로 걷고 Shift 로 뛰며 **마당 → 대청 안 → 창호지 앞**까지 간다. 창호지에 **카빈 3~4발**, 지붕 기와에 **1~2발**을 쏜다(기와가 떨어지는 장면이 히치 측정에 들어간다).
3. 30 초쯤 움직였으면 **Esc** 로 마우스를 푼다. 페이지를 새로고침하지 않는다.

### 3. 수치 뽑기 (DevTools 콘솔)
1. **F12** → 상단 탭 **Console**.
2. 아래 한 줄을 통째로 붙여 넣고 **Enter**. 결과 JSON 이 클립보드에 복사된다(콘솔에도 찍힌다).

```js
(()=>{const s=__harness.getStats();const W=30;const ft=s.frameTimes.slice(Math.max(0,W-1)).filter(x=>x>0);const so=[...ft].sort((a,b)=>a-b);const q=p=>so[Math.min(so.length-1,Math.floor(p*(so.length-1)))];const gl=document.querySelector('canvas').getContext('webgl2')||document.querySelector('canvas').getContext('webgl');const d=gl&&gl.getExtension('WEBGL_debug_renderer_info');const pc=s.programCountPerFrame;const hr=s.horizonReadbacksPerFrame||[];const r={build:(document.querySelector('#deploy-banner')||{}).textContent||location.href,renderer:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):(gl&&gl.getParameter(gl.RENDERER)),ua:navigator.userAgent,dpr:devicePixelRatio,canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],frames:ft.length,fps_p50:+(1000/q(.5)).toFixed(1),frameMs:{p50:+q(.5).toFixed(2),p95:+q(.95).toFixed(2),p99:+q(.99).toFixed(2),worst:+so[so.length-1].toFixed(1)},hitches_over_50ms:ft.filter(x=>x>50).length,newProgramsDuringPlay:Math.max(0,(pc[pc.length-1]||0)-(pc[W]||pc[0]||0)),horizonReadbacks:hr.length?hr[hr.length-1]-(hr[W]||0):null,drawCalls:s.drawCalls,triangles:s.triangles,bootMs:Math.round(s.bootMs)};console.log(JSON.stringify(r,null,1));try{copy(JSON.stringify(r))}catch(e){}return r;})()
```

3. 결과를 **그대로 회신**에 붙인다. `renderer` 에 `SwiftShader` · `llvmpipe` · `Software` 가 들어 있으면 GPU 를 못 잡은 것이다 → §C.

### 4. 회신 항목 (PATCH-005-H / 010-D)

| 항목 | JSON 키 | 뜻 |
|---|---|---|
| 재는 커밋 | `build` | 배너의 build 해시 |
| GPU 식별자 | `renderer` (+ `ua`, `dpr`, `canvas`) | 그래픽카드 · 브라우저 · 해상도 |
| fps 중앙값 | `fps_p50` | 30 초 플레이의 절반 이상이 이 fps 이상 |
| 프레임 시간 | `frameMs.p50/p95/p99/worst` | ms. p99 가 33 ms 넘으면 30 fps 아래로 떨어지는 순간이 1 % 이상 |
| 히치 | `hitches_over_50ms` | 50 ms 넘는 프레임 수 — 0 이 목표 |
| 플레이 중 컴파일 | `newProgramsDuringPlay` | **0** 이어야 한다 (프리웜 약속) |
| 지평선 판독 | `horizonReadbacks` | **0** 이어야 한다 (PATCH-007-D) |
| 부팅 | `bootMs` | 페이지 로드 → 첫 프레임 |

**한 번이 아니라 세 번** 재서 세 JSON 을 다 보내면 가장 좋다(중앙값을 쓴다). 30 초씩 다른 동선이어도 된다.

## B. 개발자 경로 (Node.js — 선택)
Node 22 + `npm ci` + `npx playwright install chromium` 뒤 저장소 루트에서
`node tools/profile.mjs --phase p3 --runs 3 --gpu > profile-gpu.json` (창이 필요하면 `--headful`). 결과 JSON 의 `banners` 에 `GPU-INVALID` 가 없어야 유효.
A 와 같은 항목이 `gpuDependent.*` · `bootCpu` · `bootGpu` · `environment.renderer` 에 들어 있다. 계약 조건(30 s · 3 회 · DPR 2 · 1512×982)이 기본값이다.

## C. 문제 해결
- **검은 화면 · 배너만 보임**: 1 분 기다린다(첫 셰이더 컴파일). 그래도 안 되면 F12 → Console 의 빨간 오류 첫 줄을 회신에 붙인다.
- **`renderer` 가 SwiftShader/Software**: 브라우저가 하드웨어 가속을 끈 상태. Chrome `설정 → 시스템 → "가능한 경우 그래픽 가속 사용"` 켜고 재시작. `chrome://gpu` 에서 WebGL 이 "Hardware accelerated" 인지 확인. 원격 데스크톱(RDP) 세션은 GPU 를 못 잡는다 — 기계 앞에서 직접 연다.
- **`__harness is not defined`**: 페이지가 아직 부팅 중이거나 다른 탭 콘솔이다. 게임 탭의 콘솔에서 첫 화면이 뜬 뒤 다시 실행.
- **`copy` 가 없다**: 콘솔에 찍힌 JSON 을 드래그해 복사한다.
- **소리가 안 남**: 클릭(포인터 락) 뒤에만 켜진다 — 측정과 무관하다.
