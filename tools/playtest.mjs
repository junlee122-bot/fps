#!/usr/bin/env node
/**
 * tools/playtest.mjs — 스크립트 이동 스모크 테스트 (P0 범위. 사격은 P2에서 추가).
 *
 * fixed 모드에서 결정적으로 실행한다:
 *  - 콘솔 에러 / pageerror 0
 *  - 위치·속도 유한성 (NaN 검출)
 *  - 지오메트리 관통 (캡슐 침투 깊이 상한)
 *  - 무한 낙하 (y 하한)
 *  - 이동 배선 (걸으면 실제로 움직인다)
 *  - 충돌 배선 (벽·기단은 실제로 막는다)
 *  - 점프 상태 전이, 앉기 높이 변화
 *  - 강체 안정 (상자들이 유한한 위치에 정착)
 *
 * 비정상 시 exit 1.
 */

import { startServer } from './lib/server.mjs';
import { HANJI_BASE_OPACITY, HANJI_TEAR_THRESHOLD, HANJI_HOLE_RADIUS } from '../src/materials/hanji.js';
import { launchBrowser, openGamePage, parseArgs } from './lib/browser.mjs';

const args = parseArgs();
/**
 * 음성 훅 (PATCH-014-D 6항): 구멍 생성을 인위로 막는다 — 피격은 기록되지만 구멍 목록이
 * 비어 있는 상태. 구멍 검사가 살아 있으면 반드시 exit 1 이어야 한다.
 * 게이트 판정 경로의 기본값은 바꾸지 않는다(플래그 없이는 원본 그대로).
 */
const NO_HOLES = args['inject-no-holes'] === true;
/**
 * 음성 훅 (R4 데칼 부재 클립): 데칼 클립을 인위로 해제한다 — 수정 전 상태. 24 mm 창살에 찍힌
 * 38~64 mm 탄흔이 창호지 위로 번지므로 `decal_within_member` 는 반드시 실패해야 한다.
 */
const DECAL_NO_CLIP = args['inject-decal-noclip'] === true;
const testOverride = NO_HOLES ? 'inject-no-holes(구멍 생성 차단) — harnesstest 전용, 계약 판정 무효'
  : DECAL_NO_CLIP ? 'inject-decal-noclip(데칼 부재 클립 해제) — harnesstest 전용, 계약 판정 무효' : undefined;
const failures = [];
const log = [];

function check(name, cond, detail) {
  if (cond) {
    log.push({ check: name, ok: true, ...detail });
  } else {
    failures.push({ check: name, ...detail });
    log.push({ check: name, ok: false, ...detail });
  }
}

const PEN_LIMIT = 0.02;      // m — 해석 후 허용 침투
const FALL_LIMIT = -5;       // m — 이보다 낮으면 월드 밖으로 떨어진 것

const server = await startServer();
const browser = await launchBrowser();

try {
  const g = await openGamePage(browser, {
    baseUrl: server.url,
    width: 960,
    height: 600,
    dpr: 1,
    query: 'mode=fixed',
  });
  const page = g.page;
  const inv = () => page.evaluate(() => window.__harness.getInvariants());
  const step = (n) => page.evaluate((k) => window.__harness.stepFrames(k), n);
  const setInput = (s) => page.evaluate((v) => window.__harness.setInput(v), s);

  if (NO_HOLES) {
    await page.evaluate(() => {
      const h = window.__harness._internal.hanji;
      const orig = h.registerHit.bind(h);
      h.registerHit = (id, uv, w) => { const p = orig(id, uv, w); p.holes.length = 0; return p; };
    });
  }

  await page.evaluate(() => window.__harness.resetState());

  // --- 1. 정지 30프레임: 스폰 안착 ---
  await step(30);
  let a = await inv();
  check('spawn_grounded', a.player.grounded === true, { got: a.player });
  check('spawn_finite', a.finitePlayer === true, {});
  check('spawn_no_penetration', a.penetrationDepth < PEN_LIMIT, { depth: a.penetrationDepth });

  // --- 2. 서쪽으로 4.5m 비켜서기 (x=0 직선상에는 석등(0,16)이 있다 —
  //        그 충돌 자체는 아래 6번이 담장으로 검증한다) ---
  await setInput({ right: -1 });
  await step(70);
  await setInput({ right: 0 });
  await step(10);
  const a2 = await inv();
  check('strafe_moves', a.player.pos[0] - a2.player.pos[0] > 3, {
    strafedMeters: +(a.player.pos[0] - a2.player.pos[0]).toFixed(2),
  });

  // --- 3. 북쪽으로 걷기 2초 → 달리기 2초 (걷기보다 빨라야 한다) ---
  await setInput({ forward: 1 });
  await step(120);
  const b = await inv();
  const walked = a2.player.pos[2] - b.player.pos[2];
  check('walk_moves', walked > 6, { walkedMeters: +walked.toFixed(2) });
  check('walk_finite', b.finitePlayer === true, {});
  check('walk_no_penetration', b.penetrationDepth < PEN_LIMIT, { depth: b.penetrationDepth });

  await setInput({ forward: 1, sprint: true });
  await step(120);
  let c = await inv();
  const sprinted = b.player.pos[2] - c.player.pos[2];
  check('sprint_faster', sprinted > walked + 2, {
    walked: +walked.toFixed(2), sprinted: +sprinted.toFixed(2),
  });
  // --- 3b. 계속 달려 대청 기단(앞면 z=-18, 높이 0.7)에 막힌다 ---
  await setInput({ forward: 1, sprint: true });
  await step(240);
  c = await inv();
  check('hall_kidan_blocks', c.player.pos[2] > -18.6, { z: +c.player.pos[2].toFixed(2) });
  check('hall_no_penetration', c.penetrationDepth < PEN_LIMIT, { depth: c.penetrationDepth });
  check('hall_no_fall', c.player.pos[1] > FALL_LIMIT, { y: +c.player.pos[1].toFixed(2) });

  // --- 4. 점프 상태 전이 ---
  await setInput({ forward: 0, sprint: false });
  await step(30);
  const beforeJump = await inv();
  await setInput({ jump: true });
  await step(12);
  const midJump = await inv();
  await step(80);
  const afterJump = await inv();
  check('jump_leaves_ground', midJump.player.grounded === false || midJump.player.pos[1] > beforeJump.player.pos[1] + 0.15, {
    before: beforeJump.player.pos[1], mid: midJump.player.pos[1],
  });
  check('jump_lands', afterJump.player.grounded === true, { got: afterJump.player.state });
  check('jump_no_penetration', afterJump.penetrationDepth < PEN_LIMIT, { depth: afterJump.penetrationDepth });

  // --- 5. 앉기 → 높이 감소, 서기 → 복귀 ---
  await setInput({ crouch: true });
  await step(10);
  const crouched = await inv();
  check('crouch_height', crouched.player.height < 1.4, { h: crouched.player.height });
  await setInput({ crouch: false });
  await step(10);
  const stood = await inv();
  check('stand_height', stood.player.height > 1.7, { h: stood.player.height });

  // --- 6. 서쪽 담장으로 돌진 6초 — 막혀야 한다 ---
  await setInput({ yaw: Math.PI / 2, forward: 1, sprint: true });
  await step(360);
  const westEnd = await inv();
  check('west_wall_blocks', westEnd.player.pos[0] > -43.9, { x: +westEnd.player.pos[0].toFixed(2) });
  check('west_no_penetration', westEnd.penetrationDepth < PEN_LIMIT, { depth: westEnd.penetrationDepth });
  check('west_finite', westEnd.finitePlayer === true, {});

  // --- 7. 강체: 부팅 낙하 상자 3개가 유한 위치에 정착 ---
  const bodies = westEnd.bodies;
  check('crates_exist', bodies.length === 3, { count: bodies.length });
  for (const bd of bodies) {
    check(`crate_${bd.id}_finite`, bd.finite === true, { pos: bd.pos });
    check(`crate_${bd.id}_above_ground`, bd.pos[1] > 0 && bd.pos[1] < 4, { y: +bd.pos[1].toFixed(3) });
    check(`crate_${bd.id}_settled`, bd.sleeping === true || bd.speed < 0.5, {
      sleeping: bd.sleeping, speed: +bd.speed.toFixed(3),
    });
  }

  // --- 7b. 사격 시나리오 (P2A) — 스폰에서 동헌 전면 창호 조준·연사 ---
  // 스폰 (0, 1.69눈, 24) → 창호 베이 중심 (3.2, 2.2, -19.5): 거리 ~43.6m.
  // 힙 산포 1.4°는 이 거리에서 ±1m라 판 명중이 불확실 — ADS(0.18°, ±14cm)로 조준.
  await page.evaluate(() => window.__harness.resetState());
  await step(30); // 스폰 안착
  const aimYaw = -Math.atan2(3.2 - 0, 24 - (-19.5));
  const aimPitch = Math.atan2(2.2 - 1.69, Math.hypot(3.2, 43.5));
  await setInput({ yaw: aimYaw, pitch: aimPitch, ads: true });
  await step(30); // ADS 블렌드 완료
  await setInput({ fire: true });
  await step(60); // 1초 @700rpm ≈ 11발
  await setInput({ fire: false, ads: false });
  await step(10);
  const ws = await page.evaluate(() => window.__harness.getWeaponState());
  check('fire_rounds', ws.counters.fired >= 8 && ws.counters.fired <= 13, { fired: ws.counters.fired });
  check('fire_ammo_spent', ws.weapons.CARBINE.ammo === 30 - ws.counters.fired, {
    ammo: ws.weapons.CARBINE.ammo, fired: ws.counters.fired,
  });
  check('fire_multilayer_hits', ws.counters.hits > ws.counters.fired, { counters: ws.counters });
  check('fire_stops_at_wall', ws.counters.stops >= 1, { stops: ws.counters.stops });
  const hanjiPanes = Object.keys(ws.hanji);
  check('hanji_hit_recorded', hanjiPanes.length >= 1, { panes: ws.hanji });
  if (hanjiPanes.length) {
    const hp = ws.hanji[hanjiPanes[0]];
    check('hanji_opacity_drops', hp.opacity < HANJI_BASE_OPACITY, { got: hp, base: HANJI_BASE_OPACITY }); // PATCH-005-D: 기본값은 materials 상수
    // [PATCH-014-D] 구멍 모델 검사 1·2·4 — 상태가 "판 전체 반투명"이 아니라 "맞은 자리 구멍"인지
    // 1. 임계 미만이면 피격 수 = 구멍 수 (임계 이상은 찢어짐이라 구멍 수를 따지지 않는다)
    const belowT = Object.entries(ws.hanji).filter(([, p]) => p.hits < HANJI_TEAR_THRESHOLD);
    check('hanji_hole_per_hit', belowT.every(([, p]) => p.holes.length === p.hits),
      { panes: belowT.map(([id, p]) => [id, p.hits, p.holes.length]) });
    // 2. 구멍 위치가 판 안(0..1)이고 반지름이 무기 상수와 일치 (카빈 사격이었다)
    const R = HANJI_HOLE_RADIUS.CARBINE;
    check('hanji_hole_uv_in_pane', Object.values(ws.hanji).every(
      (p) => p.holes.every(([u, v, r]) => u >= 0 && u <= 1 && v >= 0 && v <= 1 && Math.abs(r - R) < 1e-3)),
      { sample: hp.holes.slice(0, 3), expectedR: R });
    // 4. 임계 초과 판은 찢어짐 상태 — 그리고 임계 미만 판은 찢어지지 않았다
    check('hanji_tear_threshold', Object.values(ws.hanji).every(
      (p) => p.torn === (p.hits >= HANJI_TEAR_THRESHOLD)),
      { threshold: HANJI_TEAR_THRESHOLD, panes: Object.entries(ws.hanji).map(([id, p]) => [id, p.hits, p.torn]) });
  }

  // --- 7c. 무기 교체(산탄) → 1격발 = 9펠릿 독립 ---
  await page.evaluate(() => window.__harness.setWeapon('SHOTGUN'));
  const pelletsBefore = ws.counters.pellets;
  await setInput({ fire: true });
  await step(4);
  await setInput({ fire: false });
  await step(10);
  const ws2 = await page.evaluate(() => window.__harness.getWeaponState());
  check('shotgun_one_trigger', ws2.counters.fired === ws.counters.fired + 1, {
    fired: ws2.counters.fired,
  });
  check('shotgun_nine_pellets', ws2.counters.pellets - pelletsBefore === 9, {
    delta: ws2.counters.pellets - pelletsBefore,
  });

  // --- 7d. 장전 배선 ---
  await page.evaluate(() => window.__harness.setWeapon('CARBINE'));
  await setInput({ reload: true });
  await step(10);
  const midReload = await page.evaluate(() => window.__harness.getWeaponState());
  check('reload_begins', midReload.weapons.CARBINE.reloading === true, {
    got: midReload.weapons.CARBINE,
  });
  await step(140); // 2.2s = 132프레임
  await setInput({ reload: false });
  const done = await page.evaluate(() => window.__harness.getWeaponState());
  check('reload_refills', done.weapons.CARBINE.ammo === 30, { ammo: done.weapons.CARBINE.ammo });

  // --- 7d2. [P2B §3-1] 사격 후 resetState → 전 상태 바이트 단위 복원 ---
  // 기준: 리셋 직후 스냅샷. 사격(파티클·데칼·예광·화염·기와낙하·반동·강체 임펄스)
  // 후 resetState하면 JSON 직렬화가 기준과 정확히 일치해야 한다.
  const fullState = async () => {
    // 복원 검증 대상: 무기·FX·강체·플레이어·HANJI (frameTimes 등 계측 배열은 제외 —
    // 벽시계 종속이라 결정 대상이 아니다)
    const inv0 = await page.evaluate(() => window.__harness.getInvariants());
    const w0 = await page.evaluate(() => window.__harness.getWeaponState());
    const f0 = await page.evaluate(() => window.__harness.getFxState());
    return JSON.stringify({
      player: inv0.player, bodies: inv0.bodies, simTime: inv0.simTime, frame: inv0.frame,
      weapon: w0, fx: f0,
    });
  };
  await page.evaluate(() => window.__harness.resetState());
  const pristine = await fullState();
  // 사격 난장: 지붕(기와 낙하) + 상자(강체 임펄스) + 창호(HANJI) 순서로 갈긴다
  await setInput({ yaw: 0, pitch: 0.6, fire: true });  // 상공(지붕 방향)
  await step(40);
  await setInput({ yaw: aimYaw, pitch: aimPitch, fire: true });
  await step(40);
  await setInput({ fire: false });
  await step(30);
  const dirtyFx = await page.evaluate(() => window.__harness.getFxState());
  check('p2b_fx_engaged', dirtyFx.particles.emittedTotal > 0 && dirtyFx.decals.cursor > 0, {
    fx: dirtyFx,
  });
  await page.evaluate(() => window.__harness.resetState());
  const restored = await fullState();
  check('p2b_reset_byte_identical', restored === pristine, restored === pristine ? {} : {
    diffHint: '복원 불일치 — 두 스냅샷 길이 ' + pristine.length + ' vs ' + restored.length,
  });

  // --- 7e. resetState가 사격 상태를 완전 초기화 (§7 결정성) ---
  await page.evaluate(() => window.__harness.resetState());
  const cleared = await page.evaluate(() => window.__harness.getWeaponState());
  check('reset_clears_counters', cleared.counters.fired === 0 && cleared.counters.pellets === 0, {
    counters: cleared.counters,
  });
  check('reset_clears_hanji', Object.keys(cleared.hanji).length === 0, { hanji: cleared.hanji });
  check('reset_refills_ammo', cleared.weapons.CARBINE.ammo === 30 && cleared.weapons.SHOTGUN.ammo === 6, {
    carbine: cleared.weapons.CARBINE.ammo, shotgun: cleared.weapons.SHOTGUN.ammo,
  });

  // --- 7f. [R4] 탄흔 데칼 부재 클립 — 창살 탄흔이 창호지 위로 번지지 않는다 ---
  // 데칼은 부재에 맞춰 잘리지 않는 쿼드다. 창살은 24 mm 각재인데 탄흔 쿼드는 38~64 mm 라
  // 종이 위로 번졌다(R4 실측). 맞은 부재의 월드 AABB 를 인스턴스 속성으로 넘겨 프래그먼트에서 자른다.
  //
  // **기하로 잰다(픽셀 아님)**: 같은 장면을 두 번 찍어 차분하면 TAA 지터 잔여가 화면 전체에
  // 11,600 px 남는데 탄흔 발자국은 1,104 px, 클립이 지우는 양은 435 px 라 잡음이 신호를 삼킨다.
  // 클립의 성립은 기하 성질이므로 기하로 판정하고, 그림 증거(클립 유무 두 실행의 직접 차분:
  // 435 px 삭제, 남는 띠 16 px = 24 mm 창살)는 docs/R4-LOG.md 에 남긴다.
  {
    await page.evaluate(() => window.__harness.resetState());
    const PANE = 'na_w_-3_hanji';
    const pose = await page.evaluate((n) => window.__harness.debugObjectPose(n), PANE);
    if (!pose) {
      check('decal_within_member', false, { reason: `판 ${PANE} 없음 — 검사 대상을 찾지 못했다` });
    } else {
      const [cx, cy, cz] = pose.center;
      const eye = [cx - 0.6, cy, cz];
      // 창살 중앙(띠 0)과 **가장자리**(중앙선 +10 mm) 두 곳 — 가장자리 명중이 더 잘 번진다
      for (const dy of [0, 0.010]) {
        await page.evaluate(({ e, d }) => window.__harness.debugFire({
          pos: [e[0], e[1] + d, e[2]], yaw: -Math.PI / 2, pitch: 0,
        }), { e: eye, d: dy });
      }
      await step(2);
      // 판정 대상만 남긴다 — 탄자는 판을 뚫고 뒤의 기둥·벽에도 탄흔을 남긴다(그 자체는 정상)
      const trim = await page.evaluate((e) => window.__harness.debugTrimDecals(e, 1.0), eye);
      if (DECAL_NO_CLIP) await page.evaluate(() => window.__harness.debugDecalNoClip());
      const rep = await page.evaluate(() => window.__harness.debugDecalClipReport());
      check('decal_clip_wired', rep.length >= 1 && rep.every((r) => r.clipHalf[1] < 1000), {
        decals: trim, report: rep, note: '창살 탄흔마다 부재 상자가 실렸는지 (1e4 = 상자 없음)',
      });
      check('decal_within_member', rep.length >= 1 && rep.every((r) => r.cuts), {
        report: rep,
        note: '쿼드가 부재 상자를 넘으므로 프래그먼트에서 잘린다 = 종이 위로 번지지 않는다',
      });
    }
  }

  // --- 8. 페이지 에러 0 ---
  check('no_page_errors', g.errors.length === 0, { errors: g.errors });
  const harnessErrors = await page.evaluate(() => window.__harness.getErrors());
  check('no_harness_errors', harnessErrors.length === 0, { errors: harnessErrors });

  await g.close();
} catch (e) {
  failures.push({ check: 'run', error: e.message });
} finally {
  await browser.close();
  await server.close();
}

console.log(JSON.stringify({ ok: failures.length === 0, ...(testOverride ? { testOverride } : {}), failures, log }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
