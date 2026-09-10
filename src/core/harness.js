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
import { markSimWindow, simWindowCalls, mathRandomStats } from './determinism.js';

const PHYS_STEPS_PER_FRAME = Math.round(FIXED_DT / PHYSICS_DT); // = 2

export function installHarness(ctx) {
  const {
    renderer, scene, camera, player, input, physics, world,
    stats, shotsByName, applyShot, applyDefaultView, readyPromise, mode,
    fire, viewmodel, hanji, fx, viewmodelAuditHook, albedoAuditHook, pipeline,
    hanjiPanes,
  } = ctx;

  /**
   * C2 §8: overdraw_estimate 확장 성분 — 안개 풀스크린 패스(상수 1.0) +
   * HANJI 반투과 판의 화면 투영 면적 합. 판은 4모서리를 투영해 신발끈 공식
   * 면적(뷰포트 클램프 근사)으로 계산한다. CPU 산출·GPU 무관 (P2B §7 계보).
   * 합성 고부하 기준선(PATCH-004-C: 504/1512/3528 → 0.26/0.80/1.86)과
   * 대조해 편입 후 수치의 타당성을 판정한다.
   */
  const _pc = [new (camera.position.constructor)(), new (camera.position.constructor)(),
               new (camera.position.constructor)(), new (camera.position.constructor)()];
  function overdrawExtras(w, h) {
    let extra = 0;
    if (pipeline.sky && pipeline.sky.fog.density > 0) extra += 1.0; // 안개 풀스크린 패스
    if (hanjiPanes) {
      let area = 0;
      for (const mesh of hanjiPanes.values()) {
        if (!mesh.visible) continue;
        const { width, height } = mesh.geometry.parameters;
        const hw = width / 2, hh = height / 2;
        _pc[0].set(-hw, -hh, 0); _pc[1].set(hw, -hh, 0); _pc[2].set(hw, hh, 0); _pc[3].set(-hw, hh, 0);
        let behind = false;
        for (const p of _pc) {
          p.applyMatrix4(mesh.matrixWorld).project(camera);
          if (p.z > 1 || p.z < -1) { behind = true; break; }
          p.x = Math.min(1, Math.max(-1, p.x)) * w * 0.5;
          p.y = Math.min(1, Math.max(-1, p.y)) * h * 0.5;
        }
        if (behind) continue;
        let a2 = 0;
        for (let i = 0; i < 4; i++) {
          const p = _pc[i], q = _pc[(i + 1) % 4];
          a2 += p.x * q.y - q.x * p.y;
        }
        area += Math.abs(a2) / 2;
      }
      extra += area / (w * h);
    }
    return extra;
  }

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
    const _vw = renderer.domElement.width, _vh = renderer.domElement.height;
    // C2 §8: fx(파티클·데칼) + 안개 풀스크린 + HANJI 반투과 화면 면적
    const od = fx.overdrawEstimate(camera, _vw, _vh) + overdrawExtras(_vw, _vh);
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
      markSimWindow(true); // PATCH-004-B: 시뮬 창 내 Math.random 소비는 오류로 승격
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
        markSimWindow(false);
        state.busy = false;
      }
      if (simWindowCalls() > 0) {
        errors.push(`[determinism] stepFrames 창 내 Math.random ${simWindowCalls()}회 — 시드 수열이라 결정적이나 미지 소비자 존재 (PATCH-004-B)`);
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

    /** PATCH-004-B 트랩 상태 — 장착 여부·총 호출 수 (툴 검증용) */
    getDeterminism() {
      return mathRandomStats();
    },

    /**
     * 컴파일된 프로그램 목록 — "플레이 중 컴파일 0" 위반 시 범인 특정용.
     * cacheKey는 defines 나열이라 길다: 해시 + 식별 define 몇 개만 추린다.
     */
    getProgramList() {
      const progs = renderer.info.programs ?? [];
      return progs.map((p) => {
        const key = String(p.cacheKey ?? '');
        let h = 0x811c9dc5;
        for (let i = 0; i < key.length; i++) { h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0; }
        const tags = ['USE_ENVMAP', 'USE_SHADOWMAP', 'USE_FOG', 'TRANSPARENT', 'ALPHATEST', 'USE_INSTANCING',
          'DEPTH_PACKING', 'USE_EMISSIVE', 'DOUBLE_SIDED', 'CSM_CASCADES'].filter((t) => key.includes(t));
        return { name: p.name, usedTimes: p.usedTimes, keyHash: h.toString(16), tags };
      });
    },

    /**
     * PATCH-004-C 합성 고부하 — 파티클 n개 강제 방출 (overdraw_estimate 반응성
     * 검증 전용). 시드 스트림 기반 emit이라 결정적. 계약 캡처에 쓰지 마라.
     */
    debugEmitParticles(profileKey, n, x, y, z) {
      for (let i = 0; i < n; i++) {
        fx.particles.emit(profileKey, x, y, z, 0, 1, 0);
      }
      return fx.particles.active;
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

  /**
   * 프로그램 생성 훅 — "플레이 중 컴파일 0" 위반의 범인 특정 (C2 실측: profile
   * run 2에서 1건이 게임플레이 조건부로 발생, 사후 목록 diff로는 원인 불명).
   * three WebGLPrograms.acquireProgram이 renderer.info.programs.push(program)를
   * 호출하므로 push를 감싸 생성 시점의 이름·define 태그·프레임·스택을 남긴다.
   * 픽셀·순열 무영향 (기록만). 부팅 중 생성분은 frame=-1로 구분한다.
   */
  const compileLog = [];
  {
    const progs = renderer.info.programs;
    const origPush = progs.push.bind(progs);
    progs.push = (p) => {
      const key = String(p?.cacheKey ?? '');
      compileLog.push({
        name: p?.name ?? '?',
        tags: ['USE_ENVMAP', 'USE_SHADOWMAP', 'TRANSPARENT', 'ALPHATEST', 'USE_INSTANCING',
          'DEPTH_PACKING', 'DOUBLE_SIDED', 'FLIP_SIDED', 'USE_UV', 'USE_NORMALMAP', 'USE_MAP',
          'USE_EMISSIVEMAP', 'USE_ROUGHNESSMAP', 'USE_METALNESSMAP', 'SKINNING', 'USE_MORPHTARGETS']
          .filter((t) => key.includes(t)),
        frame: clock.bootMs ? clock.frame : -1,
        shotFrame: state.shotFrame,
        stack: (new Error().stack ?? '').split('\n').slice(2, 9).map((s) => s.trim()).join(' | '),
      });
      return origPush(p);
    };
  }
  harness.getCompileLog = () => compileLog.map((e) => ({ ...e }));

  window.__harness = harness;
  return harness;
}
