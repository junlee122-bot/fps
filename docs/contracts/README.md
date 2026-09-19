# docs/contracts — 계약 원문 보관소

발주자가 에이전트 세션에 전달한 계약 문서의 **원문**이다.
`PATCH-011-B` 이월 감사에서 이 문서들이 리포에 존재하지 않아 감사를 코드 주석에 의존해야 했던 것이
확인되어 개설했다.

## 구조

| 경로 | 내용 |
|---|---|
| `00-prompt.md` | 마스터 오케스트레이션 프롬프트 |
| `original/` | 최초 계약 원문 — `ARCHITECTURE.md`, `HARNESS.md`, `surfaces.js` |
| `briefs/` | 패스별 착수 지시서 P1 ~ P3 |
| `patches/` | 계약 정정 PATCH-001 ~ 011 |

## 살아 있는 문서와의 관계

`original/`의 세 파일은 **역사 기록**이다. 실제로 쓰이는 판본은 리포의 원래 위치에 있고,
패치에 따라 개정되어 왔다.

| 원문 | 살아 있는 판본 |
|---|---|
| `original/ARCHITECTURE.md` | `/ARCHITECTURE.md` |
| `original/HARNESS.md` | `/HARNESS.md` |
| `original/surfaces.js` | `/src/core/surfaces.js` (PATCH-002-D · 003-A 반영, 동결) |

**원문과 살아 있는 판본이 다를 때는 살아 있는 판본이 규범이다.**
차이의 근거는 `patches/`와 `docs/CONTRACT-NOTES.md`에서 찾는다.

## 읽는 순서

새 세션이 계약을 복원할 때:

1. `00-prompt.md` — 원칙과 금지 사항
2. `patches/`를 번호 순으로 — 원칙이 어떻게 개정됐는지
3. `docs/CONTRACT-NOTES.md` — 에이전트의 해석과 판정 기록
4. 현재 패스의 브리프

## 규칙

- 원문은 **수정하지 않는다.** 정정은 새 패치로 한다
- 새 브리프 · 패치를 받으면 **수령 즉시 이 폴더에 커밋한다**
- `P4-BRIEF.md`는 R4 결함 소유 분류 종료 후 전달되며, 그때 `briefs/`에 추가한다
  (`PATCH-009` 분류 오염 방지 판단)
