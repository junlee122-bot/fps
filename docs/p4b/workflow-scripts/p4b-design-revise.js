export const meta = {
  name: 'p4b-design-revise',
  description: 'P4B 설계서를 적대 검토 23건대로 고치고, 독립 재검토로 치명·중대가 0이 될 때까지(최대 2회) 반복',
  phases: [
    { title: 'Revise', detail: '검토 지적 반영' },
    { title: 'Re-review', detail: '독립 적대 재검토' },
  ],
}
const P = 'docs/p4b/inputs'
const COMMON = `저장소 <저장소 루트>(브랜치 r4-wip) — 읽기 전용(파일 수정 금지, 브라우저·렌더 도구 실행 금지). 근거 지도: ${P}/map_*.json(6개). 계약: docs/contracts/briefs/P4-BRIEF.md, docs/contracts/patches/CONTRACT-PATCH-008.md·010.md·014.md·015.md·016.md, HARNESS.md, ARCHITECTURE.md, docs/CONTRACT-NOTES.md(014-C 오류 기록 ≈1990, 장부). 원칙: 게이트 임계를 발명하지 않는다(014-C) — 후보+발주자 확정. 검사 조건은 대상의 상태가 아니라 변화에 건다(016-A). 눈으로 합격시키는 게이트 앞에서 절차를 쪼갠다(016-B). 비공허 규칙(모든 X가 Y 는 X≥1). 한국어.`
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['치명', '중대', '경미'] }, section: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'section', 'issue', 'evidence', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}

let doc = null
let issuesFile = `${P}/design_review.json`
let lastReview = null
for (let round = 1; round <= 2; round++) {
  phase('Revise')
  const src = round === 1 ? `${P}/P4B-DESIGN.synth.md 를 cat 으로 읽어라(현재 설계서 전문).` : `현재 설계서 전문은 아래 '현재 설계서' 절에 있다.`
  doc = await agent(`${COMMON}\n\n당신은 P4B 설계서 개정자다. ${src}\n지적 목록: ${round === 1 ? `${issuesFile} 를 cat 으로 읽어라(23건).` : `아래 '재검토 지적' 절.`}\n**모든 치명·중대 지적을 반영하고, 경미 지적도 반영하라.** 지적이 틀렸다고 판단하면 코드·계약 원문으로 확인한 뒤 설계서 '부록 R — 검토 반영표'에 반박 근거를 적어라. 개정하면서 새 임계를 발명하지 마라.\n출력: 개정된 설계서 **전문**(마크다운, 반환 텍스트 전체가 문서). 맨 끝에 '부록 R — 검토 반영표'(지적 번호 · 조치 · 위치)를 둔다. 구조(0 요약 … 13 구현 순서)는 유지하고 11장 '발주자 결정 사항'은 추천안과 근거를 갖춘 표로 정리하라 — 각 결정이 막는 구현 단계와 막지 않는 단계를 열로 표시.${round === 2 ? `\n\n## 재검토 지적\n${JSON.stringify(lastReview)}\n\n## 현재 설계서\n${doc}` : ''}`,
    { label: `revise:${round}`, phase: 'Revise' })
  phase('Re-review')
  lastReview = await agent(`${COMMON}\n\n당신은 독립 적대 검토자다(앞선 검토자와 다른 사람). 아래 P4B 설계서를 **반박하려고** 읽어라: 계약 위반, 코드 사실과 모순되는 가정(의심되면 코드를 열어 확인), 결정성·resetState 구멍, 예산·시간 위험, 공허 검사, 발명 임계, 구현 순서 의존성 오류, 부록 R 의 반박이 틀린 곳. 이미 고쳐진 것을 다시 지적하지 말고 남은 결함과 개정으로 새로 생긴 결함만. 항목마다 근거와 고칠 방법.\n\n${doc}`,
    { label: `rereview:${round}`, phase: 'Re-review', schema: REVIEW_SCHEMA })
  const serious = (lastReview?.issues ?? []).filter(i => i.severity !== '경미')
  log(`라운드 ${round}: 치명·중대 ${serious.length} / 전체 ${(lastReview?.issues ?? []).length}`)
  if (serious.length === 0) break
}
return { doc, lastReview }
