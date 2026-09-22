#!/usr/bin/env node
/**
 * tools/audioaudit.case21.mjs — audioaudit 음성 테스트 (P4-BRIEF §2-5 "케이스 21").
 *
 * TAB-B §2: harnesstest.mjs 는 이 탭이 수정할 수 없다 → 별도 러너로 둔다. 번호는 병합 시 A 탭이
 * harnesstest 에 편입하며 부여한다. 편입 형태(harnesstest 의 record/runAudit 관례):
 *
 *   const r = runAudit('node', ['tools/audioaudit.mjs', '--test-clone', 'ROOF_SOIL=EARTH_WALL']);
 *   pass = r.code === 1 && 표식(testOverride) && ROOF_SOIL vs EARTH_WALL 0축 && 핵심쌍 실패 기록
 *
 * 판정: 두 프로파일을 인위로 동일하게 만든 입력에서 반드시 exit 1 + testOverride 표식 +
 * 복제 쌍이 0축으로 측정되어야 한다(다른 이유로 실패한 exit 1 을 통과로 세지 않는다).
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const r = spawnSync('node', ['tools/audioaudit.mjs', '--test-clone', 'ROOF_SOIL=EARTH_WALL'], { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60 * 1000 });
let rep = null;
try { rep = JSON.parse(r.stdout); } catch { /* 아래에서 실패 처리 */ }
const marked = !!rep?.testOverride;
const pair = rep?.pairs?.find((p) => p.a === 'EARTH_WALL' && p.b === 'ROOF_SOIL');
const zeroAxes = pair?.n === 0;
const flagged = !!rep?.problems?.some((p) => p.includes('ROOF_SOIL vs EARTH_WALL'));
const pass = r.status === 1 && marked && zeroAxes && flagged;
console.log(JSON.stringify({ case: 'audioaudit 음성 (--test-clone ROOF_SOIL=EARTH_WALL)', pass, exit: r.status, marked, zeroAxes, flagged }, null, 2));
process.exit(pass ? 0 : 1);
