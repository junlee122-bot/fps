/**
 * src/core/harness.js — window.__harness 계측 인터페이스.
 *
 * HARNESS.md §2 계약 5종(ready/setShot/stepFrames/getStats/resetState) +
 * CONTRACT-NOTES B2의 확장(setInput/runScript/getPlayerState/getBootMs/
 * getInvariants/getErrors).
 *
 * fixed 모드: 페이지는 자체 프레임 루프를 돌리지 않는다. stepFrames()만이
 * 시간을 전진시킨다 — 부팅 소요 시간과 무관하게 (frame → 상태) 매핑이
 * 고정되므로 캡처가 비트 동일해진다 (참조 레포의 lockstep 기법).
 */

import { clock, FIXED_DT, PHYSICS_DT } from './clock.js';
import { resetAllStreams } from './rng.js';
import { bus } from './events.js';

const PHYS_STEPS_PER_FRAME = Math.round(FIXED_DT / PHYSICS_DT); // = 2

export function installHarness(ctx) {
  const {
    renderer, scene, camera, player, input, physics, world,
    stats, shotsByName, applyShot, applyDefaultView, readyPromise, mode,
  } = ctx;

  const errors = [];
  addEventListener('error', (e) => errors.push(`[error] ${e.message}`));
  addEventListener('unhandledrejection', (e) => errors.push(`[rejection] ${e.reason?.message ?? e.reason}`));

  const state = {
    cameraOverride: false,
    script: null, // { segments, index, segEnd, resolve }
    /** stepFrames 진행 중 재진입 가드 (감사 A2) */
    busy: false,
  };

  function stepSim() {
    for (let s = 0; s < PHYS_STEPS_PER_FRAME; s++) {
      player.update(PHYSICS_DT);
      physics.step(PHYSICS_DT);
    }
  }

  function renderFrame(cpuStartMs = -1) {
    if (!state.cameraOverride) player.applyCamera(camera);
    const preRender = clock.wallNowMs();
    renderer.render(scene, camera);
    const end = clock.wallNowMs();
    stats.record(
      cpuStartMs >= 0 ? preRender - cpuStartMs : -1,
      cpuStartMs >= 0 ? end - preRender : -1
    );
  }

  /** realtime 루프가 매 프레임 호출 — 프로파일 스크립트 재생 */
  function scriptTick() {
    const sc = state.script;
    if (!sc) return;
    if (clock.time >= sc.segEnd) {
      sc.index++;
      if (sc.index >= sc.segments.length) {
        state.script = null;
        input.override({ forward: 0, right: 0, sprint: false, jump: false });
        sc.resolve();
        return;
      }
      const seg = sc.segments[sc.index];
      sc.segEnd = clock.time + seg.dur;
      if (seg.input) input.override(seg.input);
      if (seg.tag) stats.markEvent(seg.tag);
      if (seg.jumpPulse) input.override({ jump: true });
    }
    const seg = sc.segments[sc.index];
    if (seg && seg.yawRate) {
      input.override({ yaw: input.state.yaw + seg.yawRate * clock.dt });
    }
  }

  const harness = {
    ready: readyPromise,

    async setShot(name) {
      if (state.busy) throw new Error('setShot called while stepFrames in progress');
      const shot = shotsByName.get(name);
      if (!shot) throw new Error(`unknown shot: ${name}`);
      state.cameraOverride = true;
      applyShot(shot);
      return { ok: true, shot: name };
    },

    async stepFrames(n) {
      if (mode !== 'fixed') throw new Error('stepFrames requires fixed mode (?mode=fixed)');
      // n<1 거부 (감사 A5): 0프레임이면 새 샷이 한 번도 렌더되지 않아
      // 프리웜 잔여 프레임이 샷 이름의 PNG로 저장된다 — 조용한 오캡처.
      if (!Number.isInteger(n) || n < 1) throw new Error(`stepFrames: n must be an integer >= 1 (got ${n})`);
      if (state.busy) throw new Error('stepFrames re-entered while stepping (감사 A2 가드)');
      state.busy = true;
      try {
        for (let i = 0; i < n; i++) {
          const t0 = clock.wallNowMs();
          clock.tickFixed();
          stepSim();
          renderFrame(t0);
          if ((i & 31) === 31) await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        state.busy = false;
      }
      // 컴포지터가 마지막 프레임을 집도록 rAF 2회 양보 (스크린샷 안정화)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ok: true, frames: n, simTime: clock.time };
    },

    getStats() {
      return stats.snapshot();
    },

    resetState() {
      if (state.busy) throw new Error('resetState called while stepFrames in progress');
      clock.resetSimTime();
      resetAllStreams();
      input.reset();
      player.reset();
      physics.pruneRuntimeBodies(); // 런타임 스폰 강체 제거 (감사 A1)
      world.resetDynamic();
      bus.resetToBoot();            // 부팅 이후 추가된 구독 해제 (감사 A4)
      stats.reset();
      state.cameraOverride = false;
      state.script = null;
      applyDefaultView();
      return { ok: true };
    },

    /* ------------------------- 확장 (CONTRACT-NOTES B2) ------------------ */

    setInput(partial) {
      input.override(partial);
      return input.state;
    },

    /** realtime 전용 — 세그먼트 스크립트 재생. 완료 시 resolve */
    runScript(segments) {
      if (mode !== 'realtime') return Promise.reject(new Error('runScript requires realtime mode'));
      return new Promise((resolve) => {
        state.script = {
          segments,
          index: -1,
          segEnd: -Infinity,
          resolve,
        };
      });
    },

    getPlayerState() {
      return player.eyeState;
    },

    getBootMs() {
      return clock.bootMs;
    },

    /** playtest 불변식: 유한성 / 침투 깊이 / 강체 상태 */
    getInvariants() {
      const c = player.controller;
      const p = c.position;
      const finitePlayer = Number.isFinite(p.x + p.y + p.z + c.velocity.x + c.velocity.y + c.velocity.z);
      // 현재 캡슐의 최대 침투 깊이 재계산
      let maxPen = 0;
      const n = physics.static.overlapCapsule(
        p.x, c.p0y, p.z, p.x, c.p1y, p.z, c.radius, c.mask, 0
      );
      for (let i = 0; i < n; i++) {
        if (physics.static.contacts.depth[i] > maxPen) maxPen = physics.static.contacts.depth[i];
      }
      const bodies = physics.rigid.bodies.map((b) => ({
        id: b.id,
        pos: [b.position.x, b.position.y, b.position.z],
        speed: b.linearVelocity.length(),
        sleeping: b.sleeping,
        finite: Number.isFinite(b.position.x + b.position.y + b.position.z),
      }));
      return {
        player: player.eyeState,
        finitePlayer,
        penetrationDepth: maxPen,
        bodies,
        simTime: clock.time,
        frame: clock.frame,
      };
    },

    getErrors() {
      return errors.slice();
    },

    /* 내부 배선 (main.js 전용) */
    _internal: { state, stepSim, renderFrame, scriptTick },
  };

  window.__harness = harness;
  return harness;
}
