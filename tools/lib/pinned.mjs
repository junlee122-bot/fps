/**
 * tools/lib/pinned.mjs — 렌더 프로브·게이트가 서빙할 **고정 스냅샷 워크트리**.
 *
 * 왜 (발주자 지시 2026-09-23): 프로브가 도는 동안 작업 트리를 건드리지 않는다는 규칙은 기억에 기댄다.
 * 실제로 한 번 어겼고, 그때는 원인을 서버 종류로 오진하기까지 했다. 구조로 막는다 —
 * 서빙 루트를 작업 트리가 아니라 **불변 스냅샷**으로 두면 편집이 도는 프로브에 닿지 못하고,
 * 결과가 어느 상태의 것인지도 SHA 로 자동 확정된다.
 *
 * 스냅샷 = `git stash create` 가 만드는 댕글링 커밋(작업 트리 그대로, 인덱스·작업 트리는 건드리지 않는다).
 * 트리가 깨끗하면 HEAD 를 쓴다. **추적되지 않은 파일은 스냅샷에 들어가지 않으므로** 서빙 대상 경로
 * (index.html · src · tools/shots.js)에 그런 파일이 있으면 경고로 알린다 — 조용히 다른 코드를 재는 일이 없게.
 *
 * 한 세션에서 같은 SHA 는 워크트리를 재사용하고, 다른 SHA 로 바뀌면 이전 것을 지운다(디스크 누적 방지).
 * `FPS_NO_PIN=1` 또는 `FPS_SERVE_ROOT`, 또는 startServer 에 루트를 직접 주면 이 경로를 쓰지 않는다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const BASE = process.env.FPS_PIN_DIR ?? '/tmp/fps-pinned';
/** 서빙되는 경로만 본다 — tools/*.mjs 는 노드가 작업 트리에서 직접 실행하므로 스냅샷과 무관하다 */
const SERVED = ['index.html', 'src', 'tools/shots.js'];

let cached = null;

function git(...args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * @returns {{root:string, sha:string, dirty:boolean, untracked:string[]}} 또는 실패 시 null
 */
export function pinnedRoot() {
  if (cached) return cached;
  try {
    const head = git('rev-parse', 'HEAD');
    let sha = '';
    try { sha = git('stash', 'create'); } catch { sha = ''; }
    const dirty = sha !== '';
    if (!sha) sha = head;

    const dir = join(BASE, sha);
    mkdirSync(BASE, { recursive: true });
    // 다른 SHA 의 스냅샷은 정리한다 — 같은 SHA 면 재사용.
    // 다만 **최근에 만들어진 것은 건드리지 않는다**: 다른 프로세스가 아직 그 위에서 돌고 있을 수 있다
    // (harnesstest 가 playtest 를 자식으로 띄우는 것처럼). 디스크 회수보다 실행 중인 측정이 우선이다.
    const KEEP_MS = 2 * 60 * 60 * 1000;
    for (const name of existsSync(BASE) ? readdirSync(BASE) : []) {
      if (name === sha) continue;
      const dirPath = join(BASE, name);
      try { if (Date.now() - statSync(dirPath).mtimeMs < KEEP_MS) continue; } catch { /* 없으면 아래에서 정리 */ }
      try { git('worktree', 'remove', '--force', dirPath); } catch { rmSync(dirPath, { recursive: true, force: true }); }
    }
    try { git('worktree', 'prune'); } catch { /* 무시 */ }
    if (!existsSync(dir)) git('worktree', 'add', '--detach', dir, sha);
    const nm = join(dir, 'node_modules');
    if (!existsSync(nm)) symlinkSync(join(REPO, 'node_modules'), nm, 'dir');

    const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...SERVED)
      .split('\n').filter(Boolean);
    cached = { root: dir, sha, dirty, untracked };
    return cached;
  } catch (e) {
    console.error(`[pinned] 스냅샷 실패 — 작업 트리를 그대로 서빙한다: ${e.message}`);
    return null;
  }
}
