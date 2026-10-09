# docs/p4b — P4B 설계 입력·이력·워크플로 스크립트

설계서 본문은 `docs/P4B-DESIGN.md`(개정 2 + 부록 R2). 이 디렉터리는 그 설계서를 만든 **근거와 재현 수단**이다.

| 경로 | 내용 |
|---|---|
| `inputs/map_{physics,world,render,core,tooling,contracts}.json` | 하위 시스템 지도 6종 — 코드를 읽고 만든 구조화 사실(파일:줄 근거, 위험, 열린 질문). 구현자가 먼저 읽는 입력 |
| `inputs/proposal_{A_fidelity,B_extensible,C_robust}.json` | 우선순위가 다른 독립 설계안 3종 (설계서 §0 에서 구성요소별로 접목) |
| `inputs/judge.json` | 6기준 채점·구성요소별 승자·치명 결함 |
| `inputs/review1.json` · `review2_after_revision1.json` · `review3_after_revision2.json` | 적대 검토 3회 (23건 · 17건 · 13건). 반영 상태는 설계서 부록 R · R2 |
| `workflow-scripts/*.js` | 이 설계를 만든 Workflow 스크립트(Claude Code `Workflow` 도구용). 경로를 저장소 상대로 고친 사본 — `<저장소 루트>`·`<임시디렉터리>` 표기는 실행 환경에 맞게 바꿔야 한다 |

스크립트는 **참고용 템플릿**이다: `p4b-understand` → `p4b-design` → `p4b-design-revise` 순으로 설계서를 만들었고, `p4b-impl-batch1` 은 구현 1묶음(노출 구조 동결 · 캐릭터 데이터 층 · PBD 래그돌)이다.
