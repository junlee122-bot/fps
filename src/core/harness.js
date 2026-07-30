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
    fire, viewmodel, hanji, fx, viewmodelAuditHook, albedoAuditHook, pipeline,
  } = ctx;

  const errors = [];
  addEventListener('error', (e) => errors.push(`[error] ${e.message}`));
  addEventListener('unhandledrejection', (e) => errors.push(`[rejection] ${e.reason?.message ?? e.reason}`));

  const state = {
    cameraOverride: false,
    script: null, // { segments, index, segEnd, resolve }
    /** stepFrames 진행 중 재진입 가드 (감사 A2) */
    busy: false,
    /** setShot 이후 진행된 프레임 수 — atFrame 지연 액션의 기준 (P2B §4) */
    shotFrame: 0,
    /** atFrame 지정 샷 액션 대기열 */
    pendingActions: [],
  };

  /** 샷 액션 실행 — 즉시(applyShot)·지연(stepFrames) 공용 (P2B) */
  function runShotAction(act) {
    if (act.type !== 'fire') throw new Error(`unknown shot action: ${act.type}`);
    fire.switchTo(act.weapon);
    for (let i = 0; i < (act.rounds ?? 1); i++) fire.fire(act.eye);
  }

  /** 물리 1서브스텝 — fixed(stepSim)·realtime(메인 루프) 공용 배선 (P2A) */
  function simSubstep() {
    const sw = input.consumeWeaponSwitch();
    if (sw) fire.switchTo(sw);
    player.moveSpeedMul = fire.current.adsMoveMul; // ADS 기동성 페널티 주입
    player.update(PHYSICS_DT);
    fire.update(PHYSICS_DT, input.state, player.fireEye);
    fx.update(PHYSICS_DT); // 파티클·예광·화염 수명 — 고정 스텝 (P2B §3-2)
    physics.step(PHYSICS_DT);
  }

  function stepSim() {
    for (let s = 0; s < PHYS_STEPS_PER_FRAME; s++) simSubstep();
  }

  function renderFrame(cpuStartMs = -1) {
    if (!state.cameraOverride) {
      player.applyCamera(camera);
      // P2B §8 카메라 반동 — 렌더 오프셋 (조준 입력 상태를 오염시키지 않는다)
      camera.rotation.x += fire.camSpring.p;
      camera.rotation.y += fire.camSpring.py;
    }
    viewmodel.update(fire.current); // 카메라 확정 후 포즈 갱신 (fixed·realtime 공용)
    fx.writeInstances(camera);      // 빌보드·스트릭 행렬 (P2B)
    const preRender = clock.wallNowMs();
    pipeline.render();              // C1: HDR→GTAO→TAA→MB→AgX (P3)
    const end = clock.wallNowMs();
    // §7 overdraw_estimate — CPU 산출, GPU 타이밍 무관
    const od = fx.overdrawEstimate(camera, renderer.domElement.width, renderer.domElement.height);
    stats.record(
      cpuStartMs >= 0 ? preRender - cpuStartMs : -1,
      cpuStartMs >= 0 ? end - preRender : -1,
      od,
      fx.particles.active,
      Math.min(fx.decals.cursor, fx.decals.capacity),
      pipeline.passStats.scenePass[0], // 단일 씬 패스 (게이트 지표 — P3 판정)
      pipeline.passStats.scenePass[1]
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
      state.shotFrame = 0;
      // atFrame 지정 액션은 지연 실행 (muzzle_interior — 캡처 프레임 정렬, P2B §4)
      state.pendingActions = (shot.actions ?? []).filter((a) => Number.isInteger(a.atFrame) && a.atFrame > 0);
      applyShot(shot, { runActions: true }); // 즉시 액션(atFrame 없음)은 여기서
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
          // atFrame 지연 액션 (P2B) — 프레임 진행 전 실행, 결정적
          if (state.pendingActions.length) {
            for (const act of state.pendingActions) {
              if (act.atFrame === state.shotFrame) runShotAction(act);
            }
            state.pendingActions = state.pendingActions.filter((a) => a.atFrame > state.shotFrame);
          }
          const t0 = clock.wallNowMs();
          clock.tickFixed();
          stepSim();
          renderFrame(t0);
          state.shotFrame++;
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
      fire.reset();                 // 무기 상태·탄약·계수 (P2A §7)
      hanji.reset();                // 피격 누적·불투명도 — 복원 이벤트 재발행
      fx.reset();                   // 이월 마커 방지
      pipeline.reset();             // TAA 히스토리·이전 VP 무효화 (P3 C1)
      viewmodel.setVisible(mode === 'realtime');
      bus.resetToBoot();            // 부팅 이후 추가된 구독 해제 (감사 A4)
      stats.reset();
      state.cameraOverride = false;
      state.script = null;
      state.shotFrame = 0;
      state.pendingActions = [];
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

    /** 직전 프레임 패스별 [콜, 삼각형] 분해 — P3 지표 판정의 실측 근거 */
    getPassStats() {
      return JSON.parse(JSON.stringify(pipeline.passStats));
    },

    /**
     * tris_scene — 씬그래프 순회 산출 (P1.5-BRIEF §0 정정).
     * 렌더러 통계가 아니다. InstancedMesh는 count × 지오메트리 삼각형으로 전개.
     * visible=false 콜라이더(창호지 0.3mm 박스 등)도 씬 복잡도이므로 포함하되
     * 분리 보고한다.
     */
    getSceneTriangles(detail = false) {
      let total = 0;
      let invisible = 0;
      const byName = [];
      const invisibleByName = []; // §9 지오메트리 동결 감사용 — 비가시 전수 목록
      scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const g = o.geometry;
        if (!g?.attributes?.position) return;
        const triPer = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const n = o.isInstancedMesh ? o.count : 1;
        const t = triPer * n;
        total += t;
        if (!o.visible) {
          invisible += t;
          if (detail) invisibleByName.push({ name: o.name || o.type, tris: Math.round(t), instances: n });
        }
        if (t > 5000) byName.push({ name: o.name || o.type, tris: Math.round(t) });
      });
      byName.sort((a, b) => b.tris - a.tris);
      const out = { total: Math.round(total), invisibleColliders: Math.round(invisible), top: byName.slice(0, 12) };
      if (detail) out.invisibleByName = invisibleByName.sort((a, b) => b.tris - a.tris);
      return out;
    },

    /* ------------------------------- P2A 확장 ------------------------- */

    /** 무기·사격 계수·HANJI 상태 스냅샷 (playtest 소비) */
    getWeaponState() {
      return { ...fire.snapshot(), hanji: hanji.snapshot() };
    },

    /** FX 풀 상태 스냅샷 (P2B — playtest 복원 검증·디버그) */
    getFxState() {
      return fx.snapshot();
    },

    /** 무기 교체 (playtest·디버그) */
    setWeapon(id) {
      fire.switchTo(id);
      return fire.currentId;
    },

    /**
     * albedoaudit 카드 리그 설치 (P3 §5 — 감사 전용 렌더 상태로 전환).
     * scaleAlbedo≠1은 음성 테스트 전용이며 출력에 testOverride가 박힌다.
     */
    albedoAuditSetup({ scaleAlbedo = 1 } = {}) {
      if (state.busy) throw new Error('albedoAuditSetup called while stepFrames in progress');
      state.cameraOverride = true;
      return albedoAuditHook({ scaleAlbedo });
    },

    /**
     * viewmodelaudit 카드 리그 설치 (테스트 훅 — P1.5-4 규칙).
     * boost≠1은 음성 테스트 전용이며 출력에 testOverride가 박힌다.
     */
    viewmodelAuditSetup({ boost = 1 } = {}) {
      if (state.busy) throw new Error('viewmodelAuditSetup called while stepFrames in progress');
      state.cameraOverride = true; // 카드 투영을 플레이어 카메라가 덮지 않게
      const rig = viewmodelAuditHook({ boost });
      return {
        rects: rig.rects,
        boost,
        ...(boost !== 1
          ? { testOverride: `boost=${boost} — harnesstest 전용, 계약 판정 무효` }
          : {}),
      };
    },

    /* 내부 배선 (main.js 전용) */
    _internal: { state, stepSim, simSubstep, renderFrame, scriptTick },
  };

  window.__harness = harness;
  return harness;
}
