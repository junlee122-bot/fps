/**
 * test-fixtures/ragdoll/run-hash.mjs — 별도 프로세스 최종 자세 해시 (설계서 §6-5 "별도 프로세스").
 * 사용: node test-fixtures/ragdoll/run-hash.mjs <시나리오 이름>... → JSON {이름: {hash, sleeping, forced, steps}}
 */
import { finalPose } from './scenarios.mjs';

const out = {};
for (const name of process.argv.slice(2)) out[name] = finalPose(name);
process.stdout.write(JSON.stringify(out));
