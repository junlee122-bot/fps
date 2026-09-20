/**
 * src/render/opacity.js — surface:opacity 구독자 (P2A-BRIEF §5 → CONTRACT-PATCH-013-B).
 *
 * materials(hanji.js)가 상태(구멍 목록·찢어짐)를 소유하고 이벤트를 발행하면,
 * render는 여기서 THREE 머티리얼에 반영만 한다 (ARCHITECTURE §3 소유 경계).
 *
 * 판마다 머티리얼을 부팅 시 1회 클론한다 — 공유 머티리얼을 그대로 쓰면
 * 판 하나의 피격이 모든 창호지에 구멍을 낸다. 클론은 파라미터가 동일하므로
 * 셰이더 프로그램이 갈라지지 않고(동일 순열), 부팅 시점 값도 동일해 픽셀 중립이다.
 *
 * [PATCH-013-B] 구멍은 유니폼 배열로 전달한다 — 길이가 고정이라 프로그램 수 불변.
 *   구멍이 뚫린 자리의 알파는 셰이더가 판 로컬 UV로 직접 깎는다.
 *
 * [발주자 지시 2026-09-20] **재질 불투명도는 기본값에 고정**한다. 찢어짐을 불투명도 0으로
 *   처리하면 종이가 통째로 사라져 성긴 창살만 남고 "감옥 창살" 인상이 된다. 실제 창호지는
 *   살에 풀로 붙어 있어 찢어지면 칸 가운데만 뜯기고 살을 따라 너덜한 조각이 남는다 —
 *   그 형상은 셰이더가 살 배치(world/level.js HANJI_LATTICE 단일 출처)로 해석적으로 그린다.
 *   게임 규칙용 파생 불투명도(0)는 materials/hanji.js 상태가 계속 소유한다.
 */

import { bus } from '../core/events.js';

export class OpacityApplier {
  /**
   * @param {Map<string, THREE.Mesh>} panes paneId → 가시 창호지 메시
   * @param {(w:number)=>number} latticeCount 판 폭 → 세로살 수 (world 단일 출처를 main.js가 주입)
   * @param {number} bandCount 가로띠 수
   */
  constructor(panes, latticeCount = () => 8, bandCount = 3) {
    this.panes = panes;
    this.latticeCount = latticeCount;
    this.bandCount = bandCount;
    this.base = new Map(); // paneId → 부팅 불투명도
    for (const [id, mesh] of panes) {
      mesh.material = mesh.material.clone();
      mesh.material.name = `HANJI@${id}`;
      this.base.set(id, mesh.material.opacity);
      // 판 실제 크기(m) — 구멍 반지름이 m 단위라 UV 이방성을 여기서 보정한다
    }
    bus.on('surface:opacity', (e) => this.apply(e));
  }

  /**
   * [PATCH-001-D 유니폼판 — 발주자 지시 2026-09-20] 판별 유니폼이 기본값으로 남아 있으면 즉시 throw.
   *
   * 이 버그의 본질은 "판별 유니폼이 기본값으로 남아도 조용히 그려진다"였다. 표면 매핑에서
   * 기본값을 금지하고 throw 하게 한 PATCH-001-D 와 같은 상황이므로 같은 처방을 쓴다:
   * **조용한 렌더 오류를 시끄러운 크래시로 바꾼다.**
   *
   * 판정은 값의 그럴듯함이 아니라 **불가능한 값(0)** 으로 한다. `div == 8` 같은 판정은
   * 폭 1.28 m 판이 생기면 정상값과 구별되지 않는다(현재 실측 div: 10·14·17·18·19).
   * @param {THREE.Scene} [scene] 주면 판 목록 밖의 HANJI 재질까지 전수 검사한다
   */
  assertSynced(scene = null) {
    const bad = [];
    const check = (label, mat) => {
      const u = mat?.userData?.hanjiUniforms;
      if (!u) { bad.push(`${label}: hanjiUniforms 없음`); return; }
      const ps = u.uHanjiPaneSize.value, lat = u.uHanjiLattice.value;
      if (!(ps.x > 0) || !(ps.y > 0)) bad.push(`${label}: uHanjiPaneSize 미설정 (${ps.x},${ps.y})`);
      if (!(lat.x > 0) || !(lat.y > 0)) bad.push(`${label}: uHanjiLattice 미설정 (div=${lat.x}, bands=${lat.y})`);
    };
    for (const [id, mesh] of this.panes) check(id, mesh.material);
    if (scene) {
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const n = o.material?.name ?? '';
        if (n === 'HANJI' || n.startsWith('HANJI@')) {
          if (!this.panes.has(o.name)) check(`${o.name}(판 목록 밖)`, o.material);
        }
      });
    }
    if (bad.length) {
      throw new Error(`[hanji-uniforms] 판별 유니폼이 기본값이다 — ${bad.length}건: ${bad.slice(0, 6).join(' / ')}`);
    }
    return { panes: this.panes.size };
  }

  /**
   * 판 기하 유니폼(판 크기·창살 분할) 주입 — **applyHanjiTransmit 이후에 불러야 한다.**
   * main.js 는 부팅 끝에서 판별 클론마다 applyHanjiTransmit 을 다시 호출하고, 그 호출이
   * userData.hanjiUniforms 를 새 기본값 객체로 교체한다. 생성자에서 넣으면 그때 지워진다
   * (실측: 창살 분할이 기본값 8로 남아 칸 간격이 2배, 판 크기가 (1,1)로 남아 구멍 반지름이
   *  m 가 아니라 UV 로 해석돼 3배 커졌다).
   */
  syncPaneUniforms() {
    for (const [, mesh] of this.panes) {
      const u = mesh.material.userData.hanjiUniforms;
      const g = mesh.geometry.parameters;
      if (!u || !g) continue;
      u.uHanjiPaneSize.value.set(g.width, g.height);
      // 세로 분할 수 = 살 수 + 1 (양 끝 문틀 사이 칸 수). 셰이더는 이 값으로 살 위치를 복원한다.
      u.uHanjiLattice.value.x = this.latticeCount(g.width) + 1;
      u.uHanjiLattice.value.y = this.bandCount;
    }
  }

  apply(e) {
    const { surfaceId: paneId, opacity, holes = [], torn = false } = e;
    const mesh = this.panes.get(paneId);
    if (!mesh) throw new Error(`surface:opacity for unknown pane: ${paneId}`); // PATCH-001-D
    // 재질 불투명도는 기본값 고정 — 찢어짐은 셰이더가 형상으로 그린다(위 주석)
    mesh.material.opacity = this.base.get(paneId);
    const u = mesh.material.userData.hanjiUniforms;
    if (!u) return;
    // [발주자 결정 2026-09-20] PATCH-005-D 의 "불투명도 → 산란 반경" 연동은 **되살리지 않는다.**
    // 실제 창호지도 손상 시 **남은 종이의 산란은 변하지 않고**, 구멍으로 산란 없이 통과하는 빛이
    // 생길 뿐이다. 005-D 연동은 판 하나에 숫자 하나뿐이던 모델에서 구멍을 흉내 내던 대역품이었고,
    // PATCH-013-B 구멍 모델이 그 역할을 대체했다. 종이 산란은 이제 종이의 상수 성질이다.
    u.uHanjiTorn.value = torn ? 1 : 0;
    // PATCH-013-B: 구멍 목록 → 유니폼 배열 (배열 길이는 고정, 유효 개수만 바뀐다)
    const arr = u.uHanjiHoles.value;
    const n = Math.min(holes.length, arr.length);
    for (let i = 0; i < n; i++) arr[i].set(holes[i].u, holes[i].v, holes[i].r);
    u.uHanjiHoleCount.value = n; // 찢어져도 남은 조각에 뚫린 구멍은 그대로 있다
  }

  /** resetState 방어선 — materials.reset()이 이벤트로 복원하지만, 이중 안전 */
  restoreAll() {
    for (const [id, mesh] of this.panes) {
      mesh.material.opacity = this.base.get(id);
      const u = mesh.material.userData.hanjiUniforms;
      if (u) { u.uHanjiHoleCount.value = 0; u.uHanjiTorn.value = 0; } // 산란은 손상과 무관한 상수 — 되돌릴 것이 없다
    }
  }
}
