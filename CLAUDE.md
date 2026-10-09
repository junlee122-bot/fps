# JOSEON-CQB — 새 세션이 가장 먼저 읽을 것

1. **`docs/HANDOFF-GPU.md`** — 현재 상태, 브랜치 지도, 새 컴퓨터(GPU) 준비, 이어서 할 일, 규칙. 먼저 끝까지 읽는다.
2. `docs/P4B-DESIGN.md` — P4B 설계서 (§0 요약 · §11 발주자 결정 · §13 구현 순서 · 부록 R2).
3. `docs/CONTRACT-NOTES.md` 맨 아래 「P4B 착수 전 스캔」.

핵심 규칙 (자세히는 HANDOFF §1):
- 발주자 보고는 **한국어만**, 계측으로만 말한다. 게이트 임계를 발명하지 않는다(PATCH-014-C).
- 게이트 목록의 유일한 원본은 `tools/gates.sh`. 렌더 도구는 한 번에 하나, 게이트는 **소프트웨어 렌더(SwiftShader)**로만 — `FPS_GPU=1` 로 게이트 도구를 돌리지 않는다.
- 작업 브랜치 `r4-wip`. 배포 브랜치 `claude/new-session-qfglz6` 는 게이트 통과 뒤 fast-forward 만. PR 은 요청받기 전에는 만들지 않는다.
- `.claude/`(에이전트 워크트리)는 커밋하지 않는다 (`.git/info/exclude`).
