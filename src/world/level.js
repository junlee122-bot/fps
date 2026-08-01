/**
 * src/world/level.js — 관아 경내 90×90m (P1).
 *
 * 건물 제한 (P1-BRIEF §1): 주 3동(동헌·내아·객사) + 부속 2동(행랑·누각)
 * + 회랑 + 담장(남문루 포함). 더 짓지 않는다.
 *
 * 공포 대비: 객사 = 주심포, 동헌·내아 = 다포 (P1-BRIEF §2).
 * BRONZE 배치: 범종 1개 (상한 3 — PATCH-001-A).
 *
 * P0 앵커 보존(샷·playtest 변경 최소화): 동헌 기단 전면 z=-18, 담장 ±44,
 * 회랑 x=38, 누각 (-30,28), 연못 (28,28), 등롱 (±5,40), 스폰 (0,24).
 *
 * 창호지 충돌 규약: 시각은 평면(두께 0), 충돌은 비가시 0.3mm 박스 —
 * 렌더 z-파이팅 없이 P2 관통이 실제 진입/출구 쌍(0.3mm)을 얻는다.
 */

import * as THREE from 'three';
import {
  T, makeMaterials, Assembler, addGableRoof, addHipRoof,
  columnGeometry, defineBracketParts, placeBracketSet, bracketSetHeight, bracketSetOut,
  tileGeometry, rafterGeometry,
} from './kit.js';

const CRATE_HALF = 0.35;
const CRATE_MASS = 14;

export function buildWorld(scene, physics) {
  const mats = makeMaterials();
  const A = new Assembler(scene, physics, mats);

  /* ---------------------------------------------------- 공용 인스턴스 계열 */
  A.defineInstanced('tile', tileGeometry(), 'ROOF_TILE', { collide: false, shadow: false });
  A.defineInstanced('rafter', rafterGeometry(2.6), 'WOOD_COLUMN', { collide: true });
  A.defineInstanced('choseok', new THREE.CylinderGeometry(T.CHOSEOK_D / 2, T.CHOSEOK_D / 2 + 0.04, T.CHOSEOK_H, 10), 'GRANITE', { collide: true });
  defineBracketParts(A); // 공포 부재 5종 (P1.5 §1-1)

  /** 장혀(0.09×0.15) + 도리(ø150) — 공포 상단의 결구 라인 */
  const doriGeoCache = new Map();
  function purlin(name, axis, x, y, z, len) {
    A.box(`${name}_jangyeo`, 'WOOD_COLUMN',
      axis === 'x' ? len : 0.09, 0.15, axis === 'x' ? 0.09 : len, x, y + 0.075, z);
    let g = doriGeoCache.get(`${axis}|${len}`);
    if (!g) {
      g = new THREE.CylinderGeometry(T.DORI_D, T.DORI_D, len, 10);
      if (axis === 'x') g.rotateZ(Math.PI / 2);
      else g.rotateX(Math.PI / 2);
      doriGeoCache.set(`${axis}|${len}`, g);
    }
    A.mesh(`${name}_dori`, 'WOOD_COLUMN', g, x, y + 0.15 + T.DORI_D, z, {});
  }

  const colKeys = new Map(); // 높이별 기둥 인스턴스 계열
  function columnKey(h) {
    const key = `col_${h}`;
    if (!colKeys.has(key)) {
      A.defineInstanced(key, columnGeometry(h), 'WOOD_COLUMN', { collide: true });
      colKeys.set(key, true);
    }
    return key;
  }

  const latKeys = new Set();
  function latticeKey(len, vertical) {
    const key = `lat_${vertical ? 'v' : 'h'}_${len.toFixed(2)}`;
    if (!latKeys.has(key)) {
      const g = vertical
        ? new THREE.BoxGeometry(T.LATTICE_T, len, T.LATTICE_T)
        : new THREE.BoxGeometry(len, T.LATTICE_T, T.LATTICE_T);
      A.defineInstanced(key, g, 'WOOD_LATTICE', { collide: true });
      latKeys.add(key);
    }
    return key;
  }

  /* ---------------------------------------------------- 창호 베이 헬퍼 */
  const hanjiPlaneCache = new Map();
  function hanjiPlane(w, h) {
    const key = `${w}|${h}`;
    let g = hanjiPlaneCache.get(key);
    if (!g) {
      g = new THREE.PlaneGeometry(w, h);
      hanjiPlaneCache.set(key, g);
    }
    return g;
  }

  /**
   * 창호지+창살 베이. 벽 평면: axis='x'(법선 z) 또는 'z'(법선 x).
   * 시각 평면 + 비가시 0.3mm 충돌 박스 + 창살(외측 24mm).
   * out: 창살이 붙는 바깥 방향 부호.
   */
  function hanjiBay(name, axis, cx, cy, cz, w, h, out = 1) {
    const ry = axis === 'x' ? 0 : Math.PI / 2;
    // 시각 (양면 반투과 평면)
    A.mesh(`${name}_hanji`, 'HANJI', hanjiPlane(w, h), cx, cy, cz, { ry, collide: false });
    // 충돌 (0.3mm 실두께 — P2 관통 진입/출구 쌍)
    if (axis === 'x') {
      A.box(`${name}_hanji_col`, 'HANJI', w, h, T.HANJI_T, cx, cy, cz, { visible: false });
    } else {
      A.box(`${name}_hanji_col`, 'HANJI', T.HANJI_T, h, w, cx, cy, cz, { visible: false });
    }
    // 창살: 세로살 간격 ~160mm + 가로띠 3
    const vKey = latticeKey(h, true);
    const nV = Math.max(2, Math.round(w / 0.16) - 1);
    const off = out * (T.LATTICE_T / 2 + 0.004);
    for (let i = 1; i <= nV; i++) {
      const u = -w / 2 + (w / (nV + 1)) * i;
      if (axis === 'x') A.place(vKey, cx + u, cy, cz + off);
      else A.place(vKey, cx + off, cy, cz + u);
    }
    const hKey = latticeKey(w, false);
    for (const fy of [-0.36, 0, 0.36]) {
      if (axis === 'x') A.place(hKey, cx, cy + fy * h, cz + off);
      else A.place(hKey, cx + off, cy + fy * h, cz, 0, Math.PI / 2, 0);
    }
  }

  /** 심벽 베이 (100mm) */
  function simBay(name, axis, cx, cy, cz, w, h) {
    if (axis === 'x') A.box(name, 'EARTH_WALL', w, h, T.SIMBYEOK_T, cx, cy, cz);
    else A.box(name, 'EARTH_WALL', T.SIMBYEOK_T, h, w, cx, cy, cz);
  }

  /** 판벽/판문 베이 (45mm) */
  function panBay(name, axis, cx, cy, cz, w, h) {
    if (axis === 'x') A.box(name, 'WOOD_PLANK', w, h, T.PANBYEOK_T, cx, cy, cz);
    else A.box(name, 'WOOD_PLANK', T.PANBYEOK_T, h, w, cx, cy, cz);
  }

  /* ---------------------------------------------------- 지면 */
  A.box('ground', 'PACKED_DIRT', 90, 1, 90, 0, -0.5, 0, { shadow: false });

  /* ---------------------------------------------------- 담장 + 남문루 */
  // 하부 GRANITE 900mm(t) h1.7 — 유일 상시 엄폐 벽 / 상부 기와 30mm 갓 (관통)
  const WALL = 44, GATE_HW = 3.2;
  const wallRuns = [
    [0, -WALL, 88.9, 'x'],
    [-WALL, 0, 88.9, 'z'],
    [WALL, 0, 88.9, 'z'],
    [-(GATE_HW + (WALL - GATE_HW) / 2) - 0.45, WALL, WALL - GATE_HW + 0.9, 'x'],
    [GATE_HW + (WALL - GATE_HW) / 2 + 0.45, WALL, WALL - GATE_HW + 0.9, 'x'],
  ];
  wallRuns.forEach(([cx, cz, len, axis], i) => {
    const alongX = axis === 'x';
    A.box(`wall_g_${i}`, 'GRANITE',
      alongX ? len : T.WALL_G_T, 1.7, alongX ? T.WALL_G_T : len, cx, 0.85, cz);
    // 기와 갓: 30mm 경사판 2 + 작은 용마루
    const capW = alongX ? len : 1.3, capD = alongX ? 1.3 : len;
    for (const s of [1, -1]) {
      const tilt = 0.42;
      if (alongX) {
        A.box(`wall_cap_${i}_${s}`, 'ROOF_TILE', len, T.WALL_TILE_T, 0.72, cx, 1.86, cz + s * 0.31, { rx: s * tilt });
      } else {
        A.box(`wall_cap_${i}_${s}`, 'ROOF_TILE', 0.72, T.WALL_TILE_T, len, cx + s * 0.31, 1.86, cz, { rz: -s * tilt });
      }
    }
    if (alongX) A.box(`wall_ridge_${i}`, 'ROOF_TILE', len, 0.12, 0.2, cx, 2.02, cz);
    else A.box(`wall_ridge_${i}`, 'ROOF_TILE', 0.2, 0.12, len, cx, 2.02, cz);
  });
  // 남문루: 화강암 협문벽 + 상부 판벽 문루 + 기와지붕
  for (const s of [1, -1]) {
    A.box(`gate_jamb_${s}`, 'GRANITE', 1.1, 3.0, 1.4, s * (GATE_HW + 0.55), 1.5, WALL);
  }
  A.box('gate_lintel', 'WOOD_PLANK', 8.8, 0.4, 1.1, 0, 3.2, WALL);
  A.box('gate_loft_front', 'WOOD_PLANK', 8.8, 1.3, T.PANBYEOK_T, 0, 4.05, WALL - 0.5);
  A.box('gate_loft_back', 'WOOD_PLANK', 8.8, 1.3, T.PANBYEOK_T, 0, 4.05, WALL + 0.5);
  A.box('gate_loft_floor', 'WOOD_PLANK', 8.8, T.MARU_T, 1.1, 0, 3.42, WALL);
  addGableRoof(A, {
    namePrefix: 'gate', cx: 0, cz: WALL, axis: 'x',
    ridgeLen: 8.8, span: 2.4, eaveY: 4.7, ridgeY: 5.7,
    overhangSide: 0.9, overhangEnd: 0.8, segments: 3, gables: true,
  });

  /* ---------------------------------------------------- 동헌 (주건물, 다포) */
  {
    const cx = 0, cz = -24;
    // 기단 20×12 h0.6 (전면 z=-18) + 3단 계단
    A.box('dh_kidan', 'GRANITE', 20, T.KIDAN_H, 12, cx, T.KIDAN_H / 2, cz);
    A.box('dh_step1', 'GRANITE', 3.2, 0.2, 0.75, cx, 0.1, -17.62);
    A.box('dh_step2', 'GRANITE', 3.2, 0.4, 0.4, cx, 0.2, -17.8);
    const colsX = [-8, -4.8, -1.6, 1.6, 4.8, 8];
    const rowsZ = [-19.5, -24, -28.5];
    const colH = 3.3, colBase = 0.9, colTop = colBase + colH; // 4.2
    const ck = columnKey(colH);
    for (const x of colsX) {
      for (const z of rowsZ) {
        A.place('choseok', cx + x, T.KIDAN_H + T.CHOSEOK_H / 2, z);
        A.place(ck, cx + x, colBase, z);
      }
    }
    // 마루 (우물마루 40mm, 상면 1.0)
    A.box('dh_floor', 'WOOD_PLANK', 19.2, T.MARU_T, 11.2, cx, 1.0 - T.MARU_T / 2, cz);
    // 창방(퍼리미터) + 평방(다포)
    A.box('dh_changbang_f', 'WOOD_COLUMN', 16.3, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, -19.5);
    A.box('dh_changbang_b', 'WOOD_COLUMN', 16.3, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, -28.5);
    A.box('dh_changbang_w', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 9.3, cx - 8, colTop - T.BEAM_H / 2, cz);
    A.box('dh_changbang_e', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 9.3, cx + 8, colTop - T.BEAM_H / 2, cz);
    A.box('dh_pyeongbang_f', 'WOOD_COLUMN', 16.6, 0.15, T.BEAM_H, cx, colTop + 0.075, -19.5);
    A.box('dh_pyeongbang_b', 'WOOD_COLUMN', 16.6, 0.15, T.BEAM_H, cx, colTop + 0.075, -28.5);
    // 다포 3출목 — 기둥 위 + 주간포 실배치 (P1.5 §1-1: 출목 대비 동헌3 > 내아2 > 객사1)
    const brBase = colTop + 0.15; // 평방 위
    const CH_DH = 3;
    for (const [row, bry] of [[-19.5, 0], [-28.5, Math.PI]]) {
      for (let i = 0; i < colsX.length; i++) {
        placeBracketSet(A, { kind: 'dapo', chulmok: CH_DH, x: cx + colsX[i], y: brBase, z: row, ry: bry });
        if (i < colsX.length - 1) {
          placeBracketSet(A, { kind: 'dapo', chulmok: CH_DH, x: cx + (colsX[i] + colsX[i + 1]) / 2, y: brBase, z: row, ry: bry });
        }
      }
    }
    for (const [sx, bry] of [[-8, -Math.PI / 2], [8, Math.PI / 2]]) {
      for (const rz of [-21.75, -24, -26.25]) {
        placeBracketSet(A, { kind: 'dapo', chulmok: CH_DH, x: cx + sx, y: brBase, z: rz, ry: bry });
      }
    }
    const setH = bracketSetHeight(CH_DH);
    const brOut = bracketSetOut(CH_DH);
    // 주심도리(기둥열) + 외목도리(최외곽 출목선) — 장혀·도리 결구
    purlin('dh_dori_f', 'x', cx, brBase + setH, -19.5, 17.2);
    purlin('dh_dori_b', 'x', cx, brBase + setH, -28.5, 17.2);
    purlin('dh_dori_fo', 'x', cx, brBase + setH, -19.5 + brOut, 18.4);
    purlin('dh_dori_bo', 'x', cx, brBase + setH, -28.5 - brOut, 18.4);
    purlin('dh_dori_wo', 'z', cx - 8 - brOut, brBase + setH, cz, 10.6);
    purlin('dh_dori_eo', 'z', cx + 8 + brOut, brBase + setH, cz, 10.6);
    // 팔작지붕 (P1.5 §1-2)
    const eaveY = brBase + setH + 0.32;
    addHipRoof(A, {
      namePrefix: 'dh', cx, cz,
      ridgeLen: 16, span: 12, eaveY, ridgeY: eaveY + 2.3,
      overhangSide: 1.7, overhangEnd: 2.6,
    });
    // 전면(남) 베이: 창호 4 + 중앙 개방
    const bayH = colTop - T.BEAM_H - 1.45; // 1.45..3.9
    const bayCY = 1.45 + bayH / 2;
    const bays = [[-8, -4.8], [-4.8, -1.6], [1.6, 4.8], [4.8, 8]];
    for (const [x0, x1] of bays) {
      const bw = x1 - x0 - T.COL_D;
      const bc = cx + (x0 + x1) / 2;
      panBay(`dh_meoreum_${x0}`, 'x', bc, 1.225, -19.5, bw, 0.45);
      hanjiBay(`dh_bay_${x0}`, 'x', bc, bayCY, -19.5, bw, bayH, -1);
    }
    // 후면(북): 심벽 + 중앙 판문
    for (const [x0, x1] of [[-8, -4.8], [-4.8, -1.6], [1.6, 4.8], [4.8, 8]]) {
      simBay(`dh_back_${x0}`, 'x', cx + (x0 + x1) / 2, (1.0 + colTop - T.BEAM_H) / 2, -28.5, x1 - x0 - T.COL_D, colTop - T.BEAM_H - 1.0);
    }
    panBay('dh_back_door', 'x', cx, (1.0 + colTop - T.BEAM_H) / 2, -28.5, 3.2 - T.COL_D, colTop - T.BEAM_H - 1.0);
    // 측면: 심벽 2베이씩
    for (const sx of [-8, 8]) {
      for (const [z0, z1] of [[-19.5, -24], [-24, -28.5]]) {
        simBay(`dh_side_${sx}_${z0}`, 'z', cx + sx, (1.0 + colTop - T.BEAM_H) / 2, (z0 + z1) / 2, Math.abs(z1 - z0) - T.COL_D, colTop - T.BEAM_H - 1.0);
      }
    }
    // 내부 칸막이: 양 끝 베이를 방으로 (x=±4.8 열, 문 개구 1.0)
    for (const px of [-4.8, 4.8]) {
      for (const [z0, z1] of [[-19.5, -24], [-24, -28.5]]) {
        const zc = (z0 + z1) / 2;
        const seg = Math.abs(z1 - z0) - T.COL_D;
        if (z0 === -24 || z1 === -24) {
          // 문 개구가 있는 베이: 폭 1.0 개구를 남기고 두 쪽 창호
          const doorW = 1.0;
          const side = (seg - doorW) / 2;
          hanjiBay(`dh_part_${px}_${z0}_a`, 'z', cx + px, bayCY, zc - (doorW + side) / 2, side, bayH, px > 0 ? -1 : 1);
          hanjiBay(`dh_part_${px}_${z0}_b`, 'z', cx + px, bayCY, zc + (doorW + side) / 2, side, bayH, px > 0 ? -1 : 1);
        } else {
          hanjiBay(`dh_part_${px}_${z0}`, 'z', cx + px, bayCY, zc, seg, bayH, px > 0 ? -1 : 1);
        }
        panBay(`dh_part_meo_${px}_${z0}`, 'z', cx + px, 1.225, zc, seg, 0.45);
      }
    }
  }

  /* ---------------------------------------------------- 내아 (주건물, 다포 소형) */
  {
    const cx = -27, cz = -10, w = 12, d = 8;
    A.box('na_kidan', 'GRANITE', w, T.KIDAN_H, d, cx, T.KIDAN_H / 2, cz);
    A.box('na_step', 'GRANITE', 1.8, 0.3, 0.5, cx + w / 2 + 0.25, 0.15, cz); // 동측 진입
    const colsX = [-5, -1.67, 1.67, 5];
    const rowsZ = [-3, 0, 3];
    const colH = 2.9, colBase = 0.9, colTop = colBase + colH; // 3.8
    const ck = columnKey(colH);
    for (const x of colsX) for (const z of rowsZ) {
      A.place('choseok', cx + x, T.KIDAN_H + T.CHOSEOK_H / 2, cz + z);
      A.place(ck, cx + x, colBase, cz + z);
    }
    A.box('na_floor', 'WOOD_PLANK', w - 0.8, T.MARU_T, d - 0.8, cx, 1.0 - T.MARU_T / 2, cz);
    A.box('na_changbang_f', 'WOOD_COLUMN', 10.2, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, cz + 3);
    A.box('na_changbang_b', 'WOOD_COLUMN', 10.2, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, cz - 3);
    A.box('na_changbang_w', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 6.2, cx - 5, colTop - T.BEAM_H / 2, cz);
    A.box('na_changbang_e', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 6.2, cx + 5, colTop - T.BEAM_H / 2, cz);
    // 평방 (다포 필수 부재)
    A.box('na_pyeongbang_f', 'WOOD_COLUMN', 10.4, 0.15, T.BEAM_H, cx, colTop + 0.075, cz + 3);
    A.box('na_pyeongbang_b', 'WOOD_COLUMN', 10.4, 0.15, T.BEAM_H, cx, colTop + 0.075, cz - 3);
    // 다포 2출목
    const brBase = colTop + 0.15;
    const CH_NA = 2;
    for (const [rz, bry] of [[3, 0], [-3, Math.PI]]) {
      for (let i = 0; i < colsX.length; i++) {
        placeBracketSet(A, { kind: 'dapo', chulmok: CH_NA, x: cx + colsX[i], y: brBase, z: cz + rz, ry: bry });
        if (i < colsX.length - 1) {
          placeBracketSet(A, { kind: 'dapo', chulmok: CH_NA, x: cx + (colsX[i] + colsX[i + 1]) / 2, y: brBase, z: cz + rz, ry: bry });
        }
      }
    }
    for (const [sx, bry] of [[-5, -Math.PI / 2], [5, Math.PI / 2]]) {
      placeBracketSet(A, { kind: 'dapo', chulmok: CH_NA, x: cx + sx, y: brBase, z: cz, ry: bry });
    }
    const setH = bracketSetHeight(CH_NA);
    const brOut = bracketSetOut(CH_NA);
    purlin('na_dori_f', 'x', cx, brBase + setH, cz + 3, 11.0);
    purlin('na_dori_b', 'x', cx, brBase + setH, cz - 3, 11.0);
    purlin('na_dori_fo', 'x', cx, brBase + setH, cz + 3 + brOut, 12.0);
    purlin('na_dori_bo', 'x', cx, brBase + setH, cz - 3 - brOut, 12.0);
    const eaveY = brBase + setH + 0.32;
    addGableRoof(A, {
      namePrefix: 'na', cx, cz, axis: 'x',
      ridgeLen: 10, span: d, eaveY, ridgeY: eaveY + 1.8,
      overhangSide: 1.3, overhangEnd: 1.8, segments: 4,
    });
    const bayH = colTop - T.BEAM_H - 1.45;
    const bayCY = 1.45 + bayH / 2;
    // 서면 (hanji_silhouette 샷 대상): 창호 2베이
    for (const [z0, z1] of [[-3, 0], [0, 3]]) {
      panBay(`na_w_meo_${z0}`, 'z', cx - 5, 1.225, cz + (z0 + z1) / 2, z1 - z0 - T.COL_D, 0.45);
      hanjiBay(`na_w_${z0}`, 'z', cx - 5, bayCY, cz + (z0 + z1) / 2, z1 - z0 - T.COL_D, bayH, -1);
    }
    // 남면: 창호 3베이
    for (const [x0, x1] of [[-5, -1.67], [-1.67, 1.67], [1.67, 5]]) {
      panBay(`na_s_meo_${x0}`, 'x', cx + (x0 + x1) / 2, 1.225, cz + 3, x1 - x0 - T.COL_D, 0.45);
      hanjiBay(`na_s_${x0}`, 'x', cx + (x0 + x1) / 2, bayCY, cz + 3, x1 - x0 - T.COL_D, bayH, 1);
    }
    // 북면: 심벽
    for (const [x0, x1] of [[-5, -1.67], [-1.67, 1.67], [1.67, 5]]) {
      simBay(`na_n_${x0}`, 'x', cx + (x0 + x1) / 2, (1.0 + colTop - T.BEAM_H) / 2, cz - 3, x1 - x0 - T.COL_D, colTop - T.BEAM_H - 1.0);
    }
    // 동면: 문 개구(중앙) + 심벽
    simBay('na_e_a', 'z', cx + 5, (1.0 + colTop - T.BEAM_H) / 2, cz - 1.95, 6 / 3 - T.COL_D + 0.4, colTop - T.BEAM_H - 1.0);
    simBay('na_e_b', 'z', cx + 5, (1.0 + colTop - T.BEAM_H) / 2, cz + 1.95, 6 / 3 - T.COL_D + 0.4, colTop - T.BEAM_H - 1.0);
    // 실루엣 더미 (hanji_silhouette)
    const dummy = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 12), mats.GREY_LIGHT);
    dummy.name = 'silhouette_dummy';
    dummy.position.set(cx - 2.5, 1.0 + 0.83, cz);
    dummy.castShadow = true;
    dummy.receiveShadow = true;
    dummy.userData.surface = 'FABRIC';
    A.group.add(dummy);
    physics.addStaticMesh(dummy, 'FABRIC', A.LAYER_STATIC);
  }

  /* ---------------------------------------------------- 객사 (주건물, 주심포) */
  {
    const cx = 27, cz = -10, w = 14, d = 9;
    A.box('gs_kidan', 'GRANITE', w, T.KIDAN_H, d, cx, T.KIDAN_H / 2, cz);
    A.box('gs_step', 'GRANITE', 1.8, 0.3, 0.5, cx - w / 2 - 0.25, 0.15, cz); // 서측 진입
    const colsX = [-6, -3, 0, 3, 6];
    const rowsZ = [-3.5, 0, 3.5];
    const colH = 3.1, colBase = 0.9, colTop = colBase + colH; // 4.0
    const ck = columnKey(colH);
    for (const x of colsX) for (const z of rowsZ) {
      A.place('choseok', cx + x, T.KIDAN_H + T.CHOSEOK_H / 2, cz + z);
      A.place(ck, cx + x, colBase, cz + z);
    }
    A.box('gs_floor', 'WOOD_PLANK', w - 0.8, T.MARU_T, d - 0.8, cx, 1.0 - T.MARU_T / 2, cz);
    A.box('gs_changbang_f', 'WOOD_COLUMN', 12.2, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, cz + 3.5);
    A.box('gs_changbang_b', 'WOOD_COLUMN', 12.2, T.BEAM_H, T.BEAM_W, cx, colTop - T.BEAM_H / 2, cz - 3.5);
    A.box('gs_changbang_w', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 7.2, cx - 6, colTop - T.BEAM_H / 2, cz);
    A.box('gs_changbang_e', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 7.2, cx + 6, colTop - T.BEAM_H / 2, cz);
    // 주심포 1출목 — 기둥 위에만 (주간포 없음: 다포와의 대비가 목적)
    const brBase = colTop;
    const CH_GS = 1;
    for (const [rz, bry] of [[3.5, 0], [-3.5, Math.PI]]) {
      for (const x of colsX) {
        placeBracketSet(A, { kind: 'jusimpo', chulmok: CH_GS, x: cx + x, y: brBase, z: cz + rz, ry: bry });
      }
    }
    for (const [sx, bry] of [[-6, -Math.PI / 2], [6, Math.PI / 2]]) {
      placeBracketSet(A, { kind: 'jusimpo', chulmok: CH_GS, x: cx + sx, y: brBase, z: cz, ry: bry });
    }
    const setH = bracketSetHeight(CH_GS);
    const brOut = bracketSetOut(CH_GS);
    purlin('gs_dori_f', 'x', cx, brBase + setH, cz + 3.5, 12.8);
    purlin('gs_dori_b', 'x', cx, brBase + setH, cz - 3.5, 12.8);
    purlin('gs_dori_fo', 'x', cx, brBase + setH, cz + 3.5 + brOut, 13.6);
    purlin('gs_dori_bo', 'x', cx, brBase + setH, cz - 3.5 - brOut, 13.6);
    // 팔작지붕 (P1.5 §1-2 — 동헌과 함께 2동)
    const eaveY = brBase + setH + 0.32;
    addHipRoof(A, {
      namePrefix: 'gs', cx, cz,
      ridgeLen: 12, span: d, eaveY, ridgeY: eaveY + 2.0,
      overhangSide: 1.4, overhangEnd: 2.0,
    });
    const bayH = colTop - T.BEAM_H - 1.45;
    const bayCY = 1.45 + bayH / 2;
    // 남면 창호 4베이
    for (const [x0, x1] of [[-6, -3], [-3, 0], [0, 3], [3, 6]]) {
      panBay(`gs_s_meo_${x0}`, 'x', cx + (x0 + x1) / 2, 1.225, cz + 3.5, x1 - x0 - T.COL_D, 0.45);
      hanjiBay(`gs_s_${x0}`, 'x', cx + (x0 + x1) / 2, bayCY, cz + 3.5, x1 - x0 - T.COL_D, bayH, 1);
    }
    // 북면 판벽
    for (const [x0, x1] of [[-6, -3], [-3, 0], [0, 3], [3, 6]]) {
      panBay(`gs_n_${x0}`, 'x', cx + (x0 + x1) / 2, (1.0 + colTop - T.BEAM_H) / 2, cz - 3.5, x1 - x0 - T.COL_D, colTop - T.BEAM_H - 1.0);
    }
    // 동면 판벽 / 서면 문 개구 + 창호
    for (const [z0, z1] of [[-3.5, 0], [0, 3.5]]) {
      panBay(`gs_e_${z0}`, 'z', cx + 6, (1.0 + colTop - T.BEAM_H) / 2, cz + (z0 + z1) / 2, z1 - z0 - T.COL_D, colTop - T.BEAM_H - 1.0);
    }
    hanjiBay('gs_w_a', 'z', cx - 6, bayCY, cz - 1.75, 3.5 - T.COL_D - 1.0, bayH, -1);
    hanjiBay('gs_w_b', 'z', cx - 6, bayCY, cz + 1.75, 3.5 - T.COL_D - 1.0, bayH, -1);
  }

  /* ---------------------------------------------------- 행랑 (부속, 초가) */
  {
    const cx = -36.5, cz = 14, w = 5, d = 14;
    A.box('hr_jukdam', 'GRANITE', w, 0.3, d, cx, 0.15, cz);
    const postH = 2.5;
    const rowsZ = [-6.3, -2.1, 2.1, 6.3];
    for (const x of [-2, 2]) for (const z of rowsZ) {
      A.box(`hr_post_${x}_${z}`, 'WOOD_COLUMN', 0.24, postH, 0.24, cx + x, 0.3 + postH / 2, cz + z);
    }
    A.box('hr_floor', 'WOOD_PLANK', w - 0.6, T.MARU_T, d - 0.6, cx, 0.5 - T.MARU_T / 2, cz);
    // 서면(담장 쪽) 심벽 / 동면 판벽+판문 2개구
    A.box('hr_w', 'EARTH_WALL', T.SIMBYEOK_T, postH - 0.3, d - 0.4, cx - 2, 0.3 + (postH - 0.3) / 2, cz);
    for (const [z0, z1] of [[-7, -3.5], [-1.2, 1.2], [3.5, 7]]) {
      panBay(`hr_e_${z0}`, 'z', cx + 2, 0.3 + (postH - 0.3) / 2, cz + (z0 + z1) / 2, z1 - z0 - 0.3, postH - 0.3);
    }
    // 남·북 마구리 심벽
    A.box('hr_s', 'EARTH_WALL', w - 0.4, postH - 0.3, T.SIMBYEOK_T, cx, 0.3 + (postH - 0.3) / 2, cz + d / 2 - 0.2);
    A.box('hr_n', 'EARTH_WALL', w - 0.4, postH - 0.3, T.SIMBYEOK_T, cx, 0.3 + (postH - 0.3) / 2, cz - d / 2 + 0.2);
    // 부뚜막 — 행랑 실내 유일 화강암 엄폐 (coveraudit: 실내 위반 18.6m 해소)
    A.box('hr_agungi', 'GRANITE', 1.6, 0.95, 0.9, cx, 0.5 + 0.475, cz - 5);
    addGableRoof(A, {
      namePrefix: 'hr', cx, cz, axis: 'z',
      ridgeLen: d, span: w, eaveY: 0.3 + postH, ridgeY: 0.3 + postH + 1.3,
      overhangSide: 0.9, overhangEnd: 0.7, segments: 3, thatch: true, tiles: false,
    });
  }

  /* ---------------------------------------------------- 누각 (부속, 2층) */
  {
    const cx = -30, cz = 28;
    const colH = 5.6;
    const ck = columnKey(colH);
    for (const [ox, oz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
      A.place('choseok', cx + ox, T.CHOSEOK_H / 2, cz + oz);
      A.place(ck, cx + ox, T.CHOSEOK_H, cz + oz);
    }
    // 마루 프레임 + 우물마루 40mm (아래에서 위로 관통 가능 — §5 누각 문법)
    A.box('nu_frame_a', 'WOOD_COLUMN', 5.6, T.BEAM_H, T.BEAM_W, cx, 2.8, cz - 2.2);
    A.box('nu_frame_b', 'WOOD_COLUMN', 5.6, T.BEAM_H, T.BEAM_W, cx, 2.8, cz + 2.2);
    A.box('nu_deck', 'WOOD_PLANK', 5.8, T.MARU_T, 5.8, cx, 3.0 - T.MARU_T / 2, cz);
    // 난간
    for (const s of [1, -1]) {
      A.box(`nu_rail_x_${s}`, 'WOOD_PLANK', 5.8, 0.7, 0.06, cx, 3.35, cz + s * 2.87);
      A.box(`nu_rail_z_${s}`, 'WOOD_PLANK', 0.06, 0.7, 5.8, cx + s * 2.87, 3.35, cz);
    }
    const eaveY = T.CHOSEOK_H + colH + 0.2;
    addGableRoof(A, {
      namePrefix: 'nu', cx, cz, axis: 'x',
      ridgeLen: 4.4, span: 4.4, eaveY, ridgeY: eaveY + 1.5,
      overhangSide: 1.2, overhangEnd: 1.2, segments: 3,
    });
    // 목재 계단 (북측): 12단 × rise 0.25
    const stepN = 12, rise = 3.0 / stepN, tread = 0.3;
    for (let i = 0; i < stepN; i++) {
      A.box(`nu_stair_${i}`, 'WOOD_PLANK', 1.2, rise, tread,
        cx, rise * (i + 0.5), cz - 2.9 - (stepN - 1 - i) * tread);
    }
    // 계단 개구부: 난간 북면은 계단 폭만큼 분할
    A.box('nu_rail_n_a', 'WOOD_PLANK', 2.0, 0.7, 0.06, cx - 1.9, 3.35, cz - 2.87);
    A.box('nu_rail_n_b', 'WOOD_PLANK', 2.0, 0.7, 0.06, cx + 1.9, 3.35, cz - 2.87);
  }

  /* ---------------------------------------------------- 회랑 (동측) */
  {
    const cx = 38;
    const colH = 2.9;
    const ck = columnKey(colH);
    for (let i = 0; i < 13; i++) {
      const z = -30 + i * 4;
      A.place('choseok', cx, 0.35 + T.CHOSEOK_H / 2 - 0.15, z);
      A.place(ck, cx, 0.35, z);
      A.place(ck, cx + 2.2, 0.35, z);
      A.place('choseok', cx + 2.2, 0.35 + T.CHOSEOK_H / 2 - 0.15, z);
    }
    A.box('cr_plinth', 'GRANITE', 3.4, 0.35, 50, cx + 1.1, 0.175, -6);
    A.box('cr_floor', 'WOOD_PLANK', 2.8, T.MARU_T, 49.4, cx + 1.1, 0.55 - T.MARU_T / 2, -6);
    A.box('cr_beam_w', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 49.4, cx, 0.35 + colH - T.BEAM_H / 2, -6);
    A.box('cr_beam_e', 'WOOD_COLUMN', T.BEAM_W, T.BEAM_H, 49.4, cx + 2.2, 0.35 + colH - T.BEAM_H / 2, -6);
    addGableRoof(A, {
      namePrefix: 'cr', cx: cx + 1.1, cz: -6, axis: 'z',
      ridgeLen: 50, span: 2.2, eaveY: 0.35 + colH + 0.15, ridgeY: 0.35 + colH + 1.0,
      overhangSide: 0.8, overhangEnd: 0.6, segments: 2, rafters: false, gables: false,
    });
  }

  /* ---------------------------------------------------- 연못 (석지) — 테두리 0.85 (남측 마당 엄폐 리듬) */
  A.box('pond_rim_n', 'GRANITE', 11.0, 0.85, 0.8, 28, 0.425, 28 - 5.1);
  A.box('pond_rim_s', 'GRANITE', 11.0, 0.85, 0.8, 28, 0.425, 28 + 5.1);
  A.box('pond_rim_w', 'GRANITE', 0.8, 0.85, 9.4, 28 - 5.1, 0.425, 28);
  A.box('pond_rim_e', 'GRANITE', 0.8, 0.85, 9.4, 28 + 5.1, 0.425, 28);
  // 물 — 캐릭터 통과(도섭, CONTRACT-NOTES B10 예외), 탄·파편만 충돌
  A.box('pond_water', 'WATER', 9.6, 0.45, 9.6, 28, 0.175, 28, { layer: A.LAYER_DEBRIS_ONLY, shadow: false });

  /* ---------------------------------------------------- 석등·정료대·초석 더미 */
  function stoneLantern(i, x, z) {
    A.box(`slantern_${i}_base`, 'GRANITE', 0.95, 0.28, 0.95, x, 0.14, z);
    A.box(`slantern_${i}_shaft`, 'GRANITE', 0.3, 0.85, 0.3, x, 0.705, z);
    A.box(`slantern_${i}_lamp`, 'GRANITE', 0.62, 0.5, 0.62, x, 1.38, z);
    A.box(`slantern_${i}_cap`, 'GRANITE', 0.85, 0.22, 0.85, x, 1.74, z);
  }
  stoneLantern(0, -10, 6);
  stoneLantern(1, 10, 6);
  stoneLantern(2, 0, 16);
  // 남측 마당 엄폐 공백 보강 (coveraudit 실측 — 위반 밴드 z 15..33)
  stoneLantern(3, -5, 31);
  stoneLantern(4, 5, 31);
  // 우물 — 화강암 정호
  const well = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.95, 10), mats.GREY_LIGHT);
  well.name = 'well';
  well.position.set(14, 0.475, 22);
  well.castShadow = true;
  well.receiveShadow = true;
  well.userData.surface = 'GRANITE';
  A.group.add(well);
  physics.addStaticMesh(well, 'GRANITE', A.LAYER_STATIC);
  // 하마비 (비석 + 대석)
  A.box('hamabi_base', 'GRANITE', 1.2, 0.4, 0.7, -14, 0.2, 24);
  A.box('hamabi_stele', 'GRANITE', 0.75, 1.5, 0.25, -14, 1.15, 24);
  // 초석 더미 (서측 마당)
  A.box('block_c', 'GRANITE', 0.85, 0.85, 0.85, -23, 0.425, 20.5);
  A.box('block_d', 'GRANITE', 0.85, 0.85, 0.85, -22.1, 0.425, 21.2);
  // 정료대 — 마당 중앙부 엄폐 공백 보강 (coveraudit 대응)
  A.box('jeongryodae_base', 'GRANITE', 1.1, 0.35, 1.1, 0, 0.175, -2);
  A.box('jeongryodae_shaft', 'GRANITE', 0.55, 0.85, 0.55, 0, 0.775, -2);
  A.box('jeongryodae_top', 'GRANITE', 0.8, 0.18, 0.8, 0, 1.29, -2);
  A.box('block_a', 'GRANITE', 0.85, 0.55, 0.85, -8, 0.275, 14);
  A.box('block_b', 'GRANITE', 0.85, 0.55, 0.85, -7, 0.275, 14.9);

  /* ---------------------------------------------------- 범종 (BRONZE 1/3) */
  A.box('bell_plinth', 'GRANITE', 2.4, 0.35, 2.4, 34, 0.175, -34);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 1.5, 16), mats.BRONZE);
  bell.name = 'bell';
  bell.position.set(34, 1.1, -34);
  bell.castShadow = true;
  bell.receiveShadow = true;
  bell.userData.surface = 'BRONZE';
  A.group.add(bell);
  physics.addStaticMesh(bell, 'BRONZE', A.LAYER_STATIC);

  /* ---------------------------------------------------- 등롱 ×2 (포인트라이트 상주) */
  const lanternLights = [];
  for (const side of [-1, 1]) {
    const x = side * 5, z = 40;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.3, 10), mats.GREY_MID);
    post.name = `lantern_post_${side}`;
    post.position.set(x, 1.15, z);
    post.castShadow = true;
    post.receiveShadow = true;
    post.userData.surface = 'WOOD_COLUMN';
    A.group.add(post);
    physics.addStaticMesh(post, 'WOOD_COLUMN', A.LAYER_STATIC);
    A.box(`lantern_head_${side}`, 'FABRIC', 0.36, 0.36, 0.36, x, 2.35, z, { matKey: 'LANTERN' });
    // [P3 §4] 광원은 저채도 백황색 — 앰버 발광(LANTERN h≈43°)은 유지하되, 고채도
    // 온광이 목재 회색과 곱해지면 조명된 목재가 30–40° 고채도로 대량 이탈한다
    // (목재·흙 대역 sat≤0.35). 색 정체성은 발광 코어가, 조명은 낮은 채도가 맡는다.
    const light = new THREE.PointLight(0xffeecc, 0, 18, 2);
    light.name = `lantern_light_${side}`;
    light.position.set(x, 2.45, z);
    A.group.add(light);
    lanternLights.push(light);
  }

  /* ---------------------------------------------------- 동적 상자 ×3 */
  const crateGeo = new THREE.BoxGeometry(CRATE_HALF * 2, CRATE_HALF * 2, CRATE_HALF * 2);
  const crateSpecs = [
    { pos: [2, 1.0, 6], yaw: 0 },
    { pos: [2.85, 1.85, 6.3], yaw: 0.5 },
    { pos: [1.35, 2.65, 5.8], yaw: 1.1 },
  ];
  const crates = [];
  crateSpecs.forEach((spec, i) => {
    const mesh = new THREE.Mesh(crateGeo, mats.GREY_MID);
    mesh.name = `crate_${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.surface = 'WOOD_PLANK';
    A.group.add(mesh);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.yaw, 0));
    const body = physics.addRigidBody({
      shape: 'box',
      halfExtents: [CRATE_HALF, CRATE_HALF, CRATE_HALF],
      mass: CRATE_MASS,
      position: new THREE.Vector3(...spec.pos),
      quaternion: quat,
      object3D: mesh,
      surface: 'WOOD_PLANK',
      friction: 0.65,
      restitution: 0.18,
    });
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    crates.push({ body, mesh, initPos: new THREE.Vector3(...spec.pos), initQuat: quat.clone() });
  });

  /* ---------------------------------------------------- 확정 */
  const instanced = A.finalizeInstancing();

  function resetDynamic() {
    for (const c of crates) {
      const b = c.body;
      b.position.copy(c.initPos);
      b.quaternion.copy(c.initQuat);
      b.prevPosition.copy(c.initPos);
      b.prevQuaternion.copy(c.initQuat);
      b.linearVelocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.sleeping = false;
      b.sleepTimer = 0;
      b.age = 0;
      b._impactCooldown = 0;
      b.updateInertiaWorld();
      c.mesh.position.copy(b.position);
      c.mesh.quaternion.copy(b.quaternion);
    }
  }

  return { group: A.group, crates, lanternLights, resetDynamic, instanced };
}
