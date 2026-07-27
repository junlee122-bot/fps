/**
 * src/world/kit.js — 한옥 모듈 킷 (P1).
 *
 * 두께가 게임플레이다: 모든 부재 치수는 P1-BRIEF §2 표의 실측값이며
 * `computePenetration()`의 입력이 된다. 장식적으로 얇게 만들지 않는다.
 *
 * 회색 규율 (P1-BRIEF §3): 불투명 부재는 회색 명도 3단계만.
 * HANJI(반투과)·WATER·BRONZE·LANTERN(자발광)은 P0에서 확립된 물성을
 * 그대로 유지한다 — "조정 전부 금지"이므로 유지가 곧 준수다
 * (해석 기록: docs/CONTRACT-NOTES.md P1 신규 항목).
 *
 * physics는 직접 import하지 않는다 — Assembler가 주입받은 파사드만 쓴다.
 */

import * as THREE from 'three';

/** 부재 두께·치수 상수 (m). P1-BRIEF §2 표와 1:1 대조 가능해야 한다 */
export const T = Object.freeze({
  KIDAN_H: 0.6,        // 기단 높이 600mm
  KIDAN_EDGE: 0.9,     // 기단 두께(가장자리 돌출 폭) 900mm
  CHOSEOK_D: 0.6,      // 초석 ø600
  CHOSEOK_H: 0.3,
  COL_D: 0.3,          // 기둥 ø300 (배흘림)
  BEAM_W: 0.18,        // 창방·평방 180×300
  BEAM_H: 0.3,
  DORI_D: 0.15,        // 도리·서까래 ø150
  TILE_T: 0.03,        // 기와 30mm
  BOTO_T: 0.08,        // 보토 80mm (ROOF_SOIL 태그 — PATCH-003-A 분리)
  THATCH_T: 0.2,       // 초가 이엉층
  HANJI_T: 0.0003,     // 창호지 0.3mm
  LATTICE_T: 0.024,    // 창살 24mm
  SIMBYEOK_T: 0.10,    // 심벽 100mm
  PANBYEOK_T: 0.045,   // 판벽·판문 45mm
  MARU_T: 0.040,       // 우물마루 40mm
  WALL_G_T: 0.9,       // 담장 하부 화강암 900mm
  WALL_TILE_T: 0.03,   // 담장 상부 기와 30mm
});

/** 불투명 부재 회색 3단계 + P0 유지 물성 4종 */
export function makeMaterials() {
  const std = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  const m = {
    GREY_LIGHT: std(0x9a9a97), // 석재·흙
    GREY_MID: std(0x7b766f),   // 목재·초가
    GREY_DARK: std(0x585b5f),  // 기와·창살
    HANJI: std(0xe3e0d8, { transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
    WATER: std(0x6e7a80, { transparent: true, opacity: 0.85, roughness: 0.25 }),
    BRONZE: std(0x6f6d62, { roughness: 0.5, metalness: 0.55 }),
    LANTERN: new THREE.MeshStandardMaterial({
      color: 0xd8cba8, emissive: 0xffcf9e, emissiveIntensity: 1.1, roughness: 0.9,
    }),
  };
  for (const [k, v] of Object.entries(m)) v.name = k;
  return m;
}

/** 표면 → 머티리얼 키. 시각은 3단계 회색이 소유하고 물성은 표면 태그가 소유한다 */
export const MAT_OF = Object.freeze({
  GRANITE: 'GREY_LIGHT',
  PACKED_DIRT: 'GREY_LIGHT',
  EARTH_WALL: 'GREY_LIGHT',
  ROOF_SOIL: 'GREY_LIGHT',   // 보토 — 회색 규율상 EARTH_WALL과 시각 동일 (PATCH-003 픽셀 중립)
  WOOD_COLUMN: 'GREY_MID',
  WOOD_PLANK: 'GREY_MID',
  THATCH: 'GREY_MID',
  ROOF_TILE: 'GREY_DARK',
  WOOD_LATTICE: 'GREY_DARK',
  HANJI: 'HANJI',
  WATER: 'WATER',
  BRONZE: 'BRONZE',
  FABRIC: 'GREY_LIGHT',
});

/* ------------------------------------------------------------------ */
/* 지오메트리 유틸                                                      */
/* ------------------------------------------------------------------ */

/** 인덱스드 지오메트리 병합 (BufferGeometryUtils 의존 없이) */
export function mergeGeometries(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** [w,h,d,x,y,z] 박스 사양 배열 → 병합 지오메트리 */
export function mergeBoxes(specs) {
  return mergeGeometries(specs.map(([w, h, d, x, y, z]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }));
}

/** 배흘림 기둥 — 원점이 기둥 하단. ø300 기준, 최대 배 +10% */
export function columnGeometry(h, d = T.COL_D) {
  const r = d / 2;
  const pts = [
    new THREE.Vector2(r * 0.94, 0),
    new THREE.Vector2(r * 1.05, h * 0.30),
    new THREE.Vector2(r * 1.0, h * 0.62),
    new THREE.Vector2(r * 0.86, h),
  ];
  return new THREE.LatheGeometry(pts, 12);
}

/* ------------------------------------------------------------------ */
/* 공포 부재 (P1.5 §1-1 — 부재별 개별 지오메트리, 인스턴스 배치)          */
/* ------------------------------------------------------------------ */

/**
 * 굽 블록 (주두·소로 공용 형태) — 정사각 평면 + 오목 굽 곡면.
 * LatheGeometry 4세그(45° 위상)로 정사각 단면, 프로파일 곡선으로 굽 표현.
 * size = 상판 한 변, h = 전체 높이. 원점 = 하단 중심.
 */
function gupBlockGeometry(size, h) {
  const rt = (size / 2) * Math.SQRT2; // 모서리 반경
  const pts = [
    new THREE.Vector2(rt * 0.52, 0),
    new THREE.Vector2(rt * 0.60, h * 0.16),
    new THREE.Vector2(rt * 0.78, h * 0.36),
    new THREE.Vector2(rt * 0.97, h * 0.52),
    new THREE.Vector2(rt, h * 0.58),
    new THREE.Vector2(rt, h),
  ];
  const g = new THREE.LatheGeometry(pts, 4, Math.PI / 4);
  return g;
}

/** 첨차 — 도리 방향 팔. 하단 양 끝 연화두형 곡선. 원점 = 하단 중심 */
function cheomchaGeometry(L = 0.94, H = 0.18, D = 0.15) {
  const hx = L / 2;
  const s = new THREE.Shape();
  s.moveTo(-hx, H);
  s.lineTo(hx, H);
  s.lineTo(hx, H * 0.5);
  // 우측 연화두 (오목 곡선 3분절)
  s.lineTo(hx - 0.05, H * 0.24);
  s.lineTo(hx - 0.13, H * 0.07);
  s.lineTo(hx - 0.22, 0);
  s.lineTo(-hx + 0.22, 0);
  // 좌측 연화두
  s.lineTo(-hx + 0.13, H * 0.07);
  s.lineTo(-hx + 0.05, H * 0.24);
  s.lineTo(-hx, H * 0.5);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false });
  g.translate(0, 0, -D / 2);
  return g;
}

/** 행공첨차 — 짧은 첨차 (다포 출목선용) */
function haenggongGeometry() {
  return cheomchaGeometry(0.62, 0.16, 0.14);
}

/**
 * 살미 — 보 방향(외부 +z) 팔, 쇠서(牛舌) 돌출.
 * (z,y) 프로파일을 x로 압출. 원점 = 하단 중심(몸통 기준).
 */
function salmiGeometry(D = 0.15) {
  const s = new THREE.Shape();
  // z를 shape의 x축으로 사용
  s.moveTo(-0.33, 0.18);
  s.lineTo(0.18, 0.18);
  s.lineTo(0.30, 0.15);
  s.lineTo(0.45, 0.20);
  s.lineTo(0.54, 0.30);   // 쇠서 끝 — 위로 굽음
  s.lineTo(0.47, 0.17);
  s.lineTo(0.36, 0.06);
  s.lineTo(0.24, 0.0);
  s.lineTo(-0.27, 0);
  s.lineTo(-0.33, 0.07);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false });
  // rotateY(-90°): 프로파일 x축 → 월드 +z (쇠서가 외부로), 압출축 → 월드 -x
  g.rotateY(-Math.PI / 2);
  g.translate(D / 2, 0, 0); // 압출 두께를 x 중심 정렬
  return g;
}

/** 공포 부재 인스턴스 계열 등록 (Assembler에 1회) */
export function defineBracketParts(A) {
  A.defineInstanced('judu', gupBlockGeometry(0.36, 0.24), 'WOOD_COLUMN', { collide: true });
  A.defineInstanced('soro', gupBlockGeometry(0.15, 0.115), 'WOOD_COLUMN', { collide: false }); // 소단면 — 시각
  A.defineInstanced('cheomcha', cheomchaGeometry(), 'WOOD_COLUMN', { collide: true });
  A.defineInstanced('haenggong', haenggongGeometry(), 'WOOD_COLUMN', { collide: false });
  A.defineInstanced('salmi', salmiGeometry(), 'WOOD_COLUMN', { collide: true });
}

/** 출목 기하 상수 */
const CHULMOK_STEP_OUT = 0.28; // 출목 1단당 외부 돌출
const CHULMOK_STEP_UP = 0.26;  // 출목 1단당 상승
const JUDU_H = 0.24;
const SORO_H = 0.115;

/**
 * 공포 1조 배치. 로컬 좌표: x = 도리 방향, +z = 외부(출목 진행 방향), ry로 회전.
 * y = 주두 하단. 반환 = 조립 상단(도리 하단) 높이 오프셋.
 *
 * 구성(간략화된 결구): 주두 → [단마다: 첨차(도리방향)+살미(직교)+소로 3] ×출목수
 * → 최상단 행공첨차 + 소로. 다포는 매 출목선에 행공.
 */
export function placeBracketSet(A, { kind, chulmok, x, y, z, ry = 0 }) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, ly, lz, key, extraRy = 0) =>
    A.place(key, x + lx * c + lz * s, y + ly, z - lx * s + lz * c, 0, ry + extraRy, 0);

  P(0, 0, 0, 'judu');
  let ly = JUDU_H - 0.03;

  for (let step = 0; step < chulmok; step++) {
    const oz = CHULMOK_STEP_OUT * step;
    // 도리 방향 첨차 + 직교 살미(쇠서는 외부로)
    P(0, ly, oz, 'cheomcha');
    P(0, ly, oz, 'salmi');
    // 첨차 끝 소로 2 + 살미 위 소로 1 (개별 배치 — 뭉뚱그리지 않는다)
    P(-0.35, ly + 0.18, oz, 'soro');
    P(0.35, ly + 0.18, oz, 'soro');
    P(0, ly + 0.18, oz + CHULMOK_STEP_OUT * 0.6, 'soro');
    // 다포: 출목선 행공첨차
    if (kind === 'dapo' && step > 0) P(0, ly + 0.02, oz, 'haenggong');
    ly += CHULMOK_STEP_UP;
  }
  // 최상단: 외목도리 받침 행공 + 소로
  const ozTop = CHULMOK_STEP_OUT * chulmok;
  P(0, ly, ozTop * 0.85, 'haenggong');
  P(-0.24, ly + 0.16, ozTop * 0.85, 'soro');
  P(0.24, ly + 0.16, ozTop * 0.85, 'soro');
  return ly + 0.16 + SORO_H; // 도리 하단
}

/** 공포 조립 높이 (지붕 처마 산정용): 출목 수 기준 */
export function bracketSetHeight(chulmok) {
  return JUDU_H - 0.03 + CHULMOK_STEP_UP * chulmok + 0.16 + SORO_H;
}

/** 최외곽 출목 돌출량 (외목도리·처마선 산정) */
export function bracketSetOut(chulmok) {
  return CHULMOK_STEP_OUT * chulmok;
}

/** 수키와 반원 셸 — 축이 +Z(경사 방향). 시각 전용 */
export function tileGeometry() {
  const g = new THREE.CylinderGeometry(0.09, 0.09, 0.44, 6, 1, true, 0, Math.PI);
  g.rotateZ(Math.PI / 2);  // 반원 개구부가 아래를 보게
  g.rotateY(Math.PI / 2);  // 축을 z로
  return g;
}

/** 서까래 — 축 +Z, 원점 중앙. ø150 */
export function rafterGeometry(len = 2.6) {
  const g = new THREE.CylinderGeometry(T.DORI_D / 2, T.DORI_D / 2, len, 8);
  g.rotateX(Math.PI / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* 어셈블러                                                             */
/* ------------------------------------------------------------------ */

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _mat4 = new THREE.Matrix4();

export class Assembler {
  constructor(scene, physics, mats) {
    this.group = new THREE.Group();
    this.group.name = 'gwana';
    this.physics = physics;
    this.mats = mats;
    this.geoCache = new Map();
    /** key → { geometry, matKey, surface, collide, layer, shadow, xforms: [] } */
    this.inst = new Map();
    scene.add(this.group);
    this.LAYER_STATIC = physics.layers.STATIC;
    this.LAYER_DEBRIS_ONLY = physics.layers.DEBRIS_ONLY;
  }

  boxGeo(w, h, d) {
    const key = `b|${w}|${h}|${d}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** 단일 메시 추가. visible=false면 렌더 제외(순수 콜라이더 — 얇은 창호지용) */
  mesh(name, surface, geometry, x, y, z, {
    rx = 0, ry = 0, rz = 0, collide = true, layer = this.LAYER_STATIC,
    visible = true, matKey = null, shadow = true,
  } = {}) {
    const m = new THREE.Mesh(geometry, this.mats[matKey ?? MAT_OF[surface]]);
    m.name = name;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow && visible;
    m.receiveShadow = visible;
    m.visible = visible;
    m.userData.surface = surface;
    this.group.add(m);
    if (collide) this.physics.addStaticMesh(m, surface, layer);
    return m;
  }

  box(name, surface, w, h, d, x, y, z, opts = {}) {
    return this.mesh(name, surface, this.boxGeo(w, h, d), x, y, z, opts);
  }

  /** 인스턴스 계열 정의 (같은 key로 place를 반복) */
  defineInstanced(key, geometry, surface, { collide = true, layer = this.LAYER_STATIC, matKey = null, shadow = true } = {}) {
    if (this.inst.has(key)) throw new Error(`instanced key redefined: ${key}`);
    this.inst.set(key, { geometry, matKey: matKey ?? MAT_OF[surface], surface, collide, layer, shadow, xforms: [] });
  }

  place(key, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
    const rec = this.inst.get(key);
    if (!rec) throw new Error(`unknown instanced key: ${key}`);
    _euler.set(rx, ry, rz);
    _quat.setFromEuler(_euler);
    _pos.set(x, y, z);
    _scale.set(s, s, s);
    rec.xforms.push(new THREE.Matrix4().compose(_pos, _quat, _scale));
  }

  /**
   * 모든 인스턴스 계열을 InstancedMesh로 확정 + 콜라이더 등록.
   *
   * [P2A-BRIEF §0-3] 공간 버킷 분할: 단일 배치는 바운딩 스피어가 맵 전체를
   * 덮어 프러스텀 컬링이 무효였다 (P1.5 실측: tris_frame_p95 ≈ tris_scene).
   * 평면 그리드(CELL m)로 나눠 배치하면 화면 밖 버킷이 통째로 컬링된다.
   * 결정성: xforms 순서·정수 나눗셈 버킷·Map 삽입 순회 전부 결정적.
   * BVH 내용은 분할 전과 동일(같은 월드 삼각형 집합)이라 물리 불변.
   */
  finalizeInstancing({ cellSize = 18 } = {}) {
    const created = [];
    for (const [key, rec] of this.inst) {
      if (rec.xforms.length === 0) continue;
      const buckets = new Map();
      for (const m of rec.xforms) {
        const bk = `${Math.floor(m.elements[12] / cellSize)}|${Math.floor(m.elements[14] / cellSize)}`;
        let arr = buckets.get(bk);
        if (!arr) buckets.set(bk, (arr = []));
        arr.push(m);
      }
      let batchCount = 0;
      for (const [bk, xf] of buckets) {
        const im = new THREE.InstancedMesh(rec.geometry, this.mats[rec.matKey], xf.length);
        im.name = `inst_${key}@${bk}`;
        for (let i = 0; i < xf.length; i++) im.setMatrixAt(i, xf[i]);
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = rec.shadow;
        im.receiveShadow = true;
        im.userData.surface = rec.surface;
        im.computeBoundingSphere(); // 인스턴스 전개 기준 스피어 — 컬링의 근거
        this.group.add(im);
        if (rec.collide) this.physics.addStaticMesh(im, rec.surface, rec.layer);
        batchCount++;
      }
      created.push({ key, count: rec.xforms.length, batches: batchCount });
    }
    return created;
  }
}

/* ------------------------------------------------------------------ */
/* 파라메트릭 셸 유틸 (팔작지붕용)                                       */
/* ------------------------------------------------------------------ */

/**
 * (u,v) 그리드 표면 함수 → 두께 t의 닫힌 셸 지오메트리.
 * fn(u,v) → THREE.Vector3 (외피 좌표). 노멀 방향으로 -t 오프셋한 내피 + 테두리.
 * 관통 계산이 이 두께를 실제로 만난다 (진입/출구 쌍).
 */
export function shellGeometry(fn, segU, segV, t) {
  const nu = segU + 1, nv = segV + 1;
  const top = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      top.push(fn(i / segU, j / segV));
    }
  }
  // 정점 노멀 (이웃 차분)
  const normals = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p = top[j * nu + i];
      const pu = top[j * nu + Math.min(i + 1, nu - 1)].clone().sub(top[j * nu + Math.max(i - 1, 0)]);
      const pv = top[Math.min(j + 1, nv - 1) * nu + i].clone().sub(top[Math.max(j - 1, 0) * nu + i]);
      _n.copy(pu.normalize()).cross(pv.normalize()).normalize();
      if (_n.y < 0) _n.negate(); // 외피는 위를 본다
      normals.push(_n.clone());
    }
  }
  const bottom = top.map((p, k) => p.clone().addScaledVector(normals[k], -t));

  const pos = [];
  const idx = [];
  const push = (p) => { pos.push(p.x, p.y, p.z); return pos.length / 3 - 1; };
  const topIdx = top.map(push);
  const botIdx = bottom.map(push);
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const k = j * nu + i;
      quad(topIdx[k], topIdx[k + 1], topIdx[k + nu + 1], topIdx[k + nu]);           // 외피
      quad(botIdx[k + nu], botIdx[k + nu + 1], botIdx[k + 1], botIdx[k]);           // 내피 (반대 감김)
    }
  }
  // 테두리 4변
  for (let i = 0; i < segU; i++) {
    quad(topIdx[i + 1], topIdx[i], botIdx[i], botIdx[i + 1]);                                     // v=0 (처마)
    const k = segV * nu + i;
    quad(topIdx[k], topIdx[k + 1], botIdx[k + 1], botIdx[k]);                                     // v=1 (마루)
  }
  for (let j = 0; j < segV; j++) {
    const a = j * nu, b = (j + 1) * nu;
    quad(topIdx[a], topIdx[b], botIdx[b], botIdx[a]);                                             // u=0
    const c = j * nu + segU, d = (j + 1) * nu + segU;
    quad(topIdx[d], topIdx[c], botIdx[c], botIdx[d]);                                             // u=1
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* 팔작지붕 빌더 (P1.5 §1-2)                                            */
/* ------------------------------------------------------------------ */

/**
 * 팔작: 전·후 주경사면(처마→용마루) + 좌·우 합각하부 경사면(처마→합각 밑선) +
 * 합각 판벽 + 추녀·사래·선자연 + 마루 3종. 기와 30mm + 보토 80mm 2레이어를
 * 곡면 셸로 유지한다 — 관통 체인 불변.
 *
 * 처마 곡선: 앙곡(처마 끝단 상승 angok) + 안허리(처마 끝 평면 내밈 anheori).
 * 주경사면·합각하부면의 대각 이음매 잔차는 추녀마루가 덮는다 (전통 그대로의 처리).
 */
export function addHipRoof(A, {
  namePrefix, cx, cz,
  ridgeLen,             // 벽체 x-길이 (도리 방향)
  span,                 // 벽체 z-깊이
  eaveY, ridgeY,
  overhangSide = 1.5,   // 처마 내밀기 (z)
  overhangEnd = 1.5,    // 처마 내밀기 (x)
  angok = 0.34,         // 앙곡
  anheori = 0.30,       // 안허리
  hipRatio = 0.55,      // 합각 밑선 높이 비율
  sag = 1.45,
  segU = 12, segV = 5,
  tiles = true,
}) {
  const eaveHalfX = ridgeLen / 2 + overhangEnd;
  const eaveHalfZ = span / 2 + overhangSide;
  const drop = ridgeY - eaveY;
  const yProfile = (v) => ridgeY - drop * (1 - Math.pow(1 - v, sag));
  const yBreak = yProfile(hipRatio);
  const topHalfX = Math.max(1.2, eaveHalfX - eaveHalfZ * hipRatio);
  const zAtV = (v) => eaveHalfZ * (1 - v);
  // 팔작 평면 규칙: x 반폭은 합각 밑선(hipRatio)까지만 좁아지고 그 위는 topHalfX 고정.
  // (이 규칙이 어긋나면 합각하부면 상단과 합각 벽 사이에 구멍이 생긴다 — chainaudit이 잡았던 결함)
  const xHalfAtV = (v) => eaveHalfX - (eaveHalfX - topHalfX) * Math.min(v / hipRatio, 1);
  const corner = (u) => Math.pow(Math.abs(u), 2.4);

  const layers = [
    { surface: 'ROOF_SOIL', t: T.BOTO_T, lift: 0 },  // 보토 재태깅 [PATCH-003-D]
    { surface: 'ROOF_TILE', t: T.TILE_T, lift: T.BOTO_T },
  ];

  /** 전/후 주경사면 (s = ±1 → ±z). 앙곡·안허리는 모서리(|u|→1)에서 최대 */
  const mainSlopeFn = (s, lift) => (uu, vv) => {
    const u = uu * 2 - 1;
    const ct = corner(u);
    const x = u * (xHalfAtV(vv) + anheori * 0.4 * ct * (1 - vv));
    const z = s * (zAtV(vv) + anheori * ct * (1 - vv));
    const y = yProfile(vv) + angok * ct * Math.pow(1 - vv, 2) + lift;
    return new THREE.Vector3(cx + x, y, cz + z);
  };

  /** 좌/우 합각하부면 (e = ±1 → ±x). vv: 처마(0)→합각 밑선(1). 높이 축척은 주경사면과 공유.
   *  x는 vv 기준 선형(처마→topHalfX)으로 주경사면의 대각 모서리와 정확히 만난다 */
  const hipSlopeFn = (e, lift) => (uu, vv) => {
    const u = uu * 2 - 1; // z 방향
    const vAbs = vv * hipRatio;
    const ct = corner(u);
    const x = e * (eaveHalfX - (eaveHalfX - topHalfX) * vv + anheori * 0.4 * ct * (1 - vAbs));
    const z = u * (zAtV(vAbs) + anheori * ct * (1 - vAbs) * 0.6);
    const y = yProfile(vAbs) + angok * ct * Math.pow(1 - vAbs, 2) + lift;
    return new THREE.Vector3(cx + x, y, cz + z);
  };

  for (const layer of layers) {
    for (const s of [1, -1]) {
      const g = shellGeometry(mainSlopeFn(s, layer.lift), segU, segV, layer.t);
      A.mesh(`${namePrefix}_hip_main_${layer.surface}_${s > 0 ? 'p' : 'n'}`, layer.surface, g, 0, 0, 0, {});
    }
    for (const e of [1, -1]) {
      const g = shellGeometry(hipSlopeFn(e, layer.lift), Math.max(6, segU - 4), Math.max(3, segV - 2), layer.t);
      A.mesh(`${namePrefix}_hip_side_${layer.surface}_${e > 0 ? 'p' : 'n'}`, layer.surface, g, 0, 0, 0, {});
    }
  }

  /* 합각 판벽 (삼각) */
  const gableZ = zAtV(hipRatio);
  for (const e of [1, -1]) {
    const shape = new THREE.Shape([
      new THREE.Vector2(-gableZ, yBreak),
      new THREE.Vector2(gableZ, yBreak),
      new THREE.Vector2(0, ridgeY),
    ]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: T.PANBYEOK_T, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    A.mesh(`${namePrefix}_hapgak_${e > 0 ? 'p' : 'n'}`, 'WOOD_PLANK', g,
      cx + e * topHalfX - T.PANBYEOK_T / 2, 0, cz, {});
  }

  /* 용마루 */
  A.box(`${namePrefix}_ridge`, 'ROOF_TILE', topHalfX * 2 + 0.6, 0.22, 0.36, cx, ridgeY + 0.11, cz);

  /* 모서리 4곳: 추녀마루 + 추녀 + 사래 */
  for (const e of [1, -1]) {
    for (const s of [1, -1]) {
      const x0 = e * (eaveHalfX + anheori), z0 = s * (eaveHalfZ + anheori), y0 = eaveY + angok;
      const x1 = e * topHalfX, z1 = s * gableZ, y1 = yBreak;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      // Euler 'XYZ': local +z → (sin ry, -cos ry sin rx, cos ry cos rx)
      const rx = Math.atan2(-dy, dz);
      const ry = Math.atan2(dx, Math.hypot(dy, dz));
      const lift = T.BOTO_T + T.TILE_T;
      A.box(`${namePrefix}_hipridge_${e}_${s}`, 'ROOF_TILE', 0.26, 0.18, len,
        cx + (x0 + x1) / 2, (y0 + y1) / 2 + lift + 0.06, cz + (z0 + z1) / 2, { rx, ry });
      A.box(`${namePrefix}_chunyeo_${e}_${s}`, 'WOOD_COLUMN', 0.22, 0.24, len * 0.6,
        cx + x0 + dx * 0.28, y0 + dy * 0.28 - 0.18, cz + z0 + dz * 0.28, { rx, ry });
      A.box(`${namePrefix}_sarae_${e}_${s}`, 'WOOD_COLUMN', 0.16, 0.17, 0.85,
        cx + x0 - e * 0.1, y0 - 0.14, cz + z0 - s * 0.1, { rx: rx * 0.5, ry });
    }
    /* 내림마루 — 합각 빗변 2 */
    for (const s of [1, -1]) {
      const dx2 = 0 - 0, dy2 = ridgeY - yBreak, dz2 = 0 - s * gableZ;
      const len2 = Math.hypot(dy2, dz2);
      A.box(`${namePrefix}_naerim_${e}_${s}`, 'ROOF_TILE', 0.24, 0.16, len2,
        cx + e * topHalfX, (yBreak + ridgeY) / 2 + 0.06, cz + s * gableZ / 2,
        { rx: Math.atan2(-dy2, dz2), ry: 0 });
    }
  }

  /* 선자연 — 모서리 부챗살 서까래 (각 모서리 6개) */
  for (const e of [1, -1]) {
    for (const s of [1, -1]) {
      const FAN = 6;
      const eaveSlope = Math.atan2(drop, eaveHalfZ) * 0.5;
      for (let k = 0; k < FAN; k++) {
        const t = (k + 0.5) / FAN;
        const yaw = e * t * (Math.PI / 4);
        const px = e * (eaveHalfX - 0.9 - t * 1.3);
        const pz = s * (eaveHalfZ - 0.5 - (1 - t) * 0.35);
        A.place('rafter', cx + px, eaveY + angok * (1 - t) * 0.6 + 0.1, cz + pz,
          s > 0 ? eaveSlope : -eaveSlope, yaw, 0);
      }
    }
  }

  /* 일반 서까래 — 전/후 처마 중앙부 */
  {
    const plainHalf = eaveHalfX - 2.6;
    const count = Math.max(2, Math.floor((plainHalf * 2) / 0.55));
    const eaveSlope = Math.atan2(drop, eaveHalfZ) * 0.5;
    for (const s of [1, -1]) {
      for (let k = 0; k < count; k++) {
        const x = -plainHalf + (2 * plainHalf) * (k / (count - 1));
        A.place('rafter', cx + x, eaveY + 0.1, cz + s * (eaveHalfZ - 0.9),
          s > 0 ? eaveSlope : -eaveSlope, 0, 0);
      }
    }
  }

  /* 시각 기와 — 주경사면·합각하부면 곡면 추종 (비충돌) */
  if (tiles) {
    const topOff = T.BOTO_T + T.TILE_T + 0.05;
    for (const s of [1, -1]) {
      const fn = mainSlopeFn(s, 0);
      const rows = segV * 2;
      for (let r = 0; r < rows; r++) {
        const vv = (r + 0.5) / rows;
        const halfX = xHalfAtV(vv);
        const cols = Math.max(2, Math.floor((halfX * 2) / 0.32));
        for (let ci = 0; ci < cols; ci++) {
          const uu = (ci + 0.5) / cols;
          const p = fn(uu, vv);
          const p2 = fn(uu, Math.min(1, vv + 0.08));
          const rx = Math.atan2(p.y - p2.y, Math.abs(p2.z - p.z)) * (s > 0 ? 1 : -1);
          A.place('tile', p.x, p.y + topOff, p.z, rx, 0, 0);
        }
      }
    }
    for (const e of [1, -1]) {
      const hfn = hipSlopeFn(e, 0);
      for (let r = 0; r < 6; r++) {
        const vv = (r + 0.5) / 6;
        const zH = zAtV(vv * hipRatio);
        const cols = Math.max(2, Math.floor((zH * 2) / 0.32));
        for (let ci = 0; ci < cols; ci++) {
          const uu = (ci + 0.5) / cols;
          const p = hfn(uu, vv);
          const p2 = hfn(uu, Math.min(1, vv + 0.1));
          const rz = Math.atan2(p.y - p2.y, Math.abs(p2.x - p.x)) * (e > 0 ? -1 : 1);
          A.place('tile', p.x, p.y + topOff, p.z, 0, Math.PI / 2, rz);
        }
      }
    }
  }

  return { eaveHalfX, eaveHalfZ, yBreak, topHalfX };
}

/* ------------------------------------------------------------------ */
/* 맞배지붕 빌더                                                        */
/* ------------------------------------------------------------------ */

/**
 * 충돌 2레이어(기와 ROOF_TILE 30mm 위 / 보토 ROOF_SOIL 80mm 아래 — 탄이 위에서
 * 아래로 기와→보토 순서로 만난다) + 시각 기와 인스턴스(비충돌) + 용마루 +
 * 서까래(충돌 — 지붕 관통 체인의 3층) + 박공 판벽.
 *
 * axis='x': 용마루가 x방향, 경사면 ±z. axis='z': 경사면 ±x.
 * 지붕면은 오목 곡선: 용마루 쪽이 급하고 처마로 갈수록 완만.
 */
export function addGableRoof(A, {
  namePrefix, cx, cz, axis = 'x',
  ridgeLen,            // 용마루 방향 벽체 길이 (박공면 간격)
  span,                // 경사 방향 폭 (벽체)
  eaveY, ridgeY,
  overhangSide = 1.2,  // 처마 내밀기 (경사 방향)
  overhangEnd = 0.9,   // 박공 방향 내밀기
  segments = 4,
  sag = 1.4,           // 곡률 지수 (1 = 직선)
  tiles = true,
  rafters = true,
  thatch = false,
  gables = true,
}) {
  const halfRun = span / 2 + overhangSide;
  const width = ridgeLen + 2 * overhangEnd;
  const drop = ridgeY - eaveY;
  const profile = (t) => ridgeY - drop * (1 - Math.pow(1 - t, sag));

  const layerDefs = thatch
    ? [{ surface: 'THATCH', t: T.THATCH_T, collide: true }]
    : [
        { surface: 'ROOF_SOIL', t: T.BOTO_T, collide: true },   // 보토 (아래) [PATCH-003-D]
        { surface: 'ROOF_TILE', t: T.TILE_T, collide: true },   // 기와 (위)
      ];

  for (const s of [1, -1]) {
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const u0 = halfRun * t0, u1 = halfRun * t1;
      const y0 = profile(t0), y1 = profile(t1);
      const du = u1 - u0, dy = y1 - y0; // dy < 0
      const L = Math.hypot(du, dy);
      const theta = Math.atan2(-dy, du); // 하강 경사각 (양수)
      // (경사축, y) 평면의 상향 노멀
      const nU = -dy / L, nY = du / L; // (경사축 성분, y 성분) — nU>0: 처마 쪽으로 기움
      const um = (u0 + u1) / 2, ym = (y0 + y1) / 2;

      let acc = 0;
      for (const layer of layerDefs) {
        const off = acc + layer.t / 2;
        acc += layer.t;
        const uOff = um + nU * off; // 표면 노멀 오프셋의 경사축 성분 (월드 부호는 s가 준다)
        const yOff = ym + nY * off;
        const name = `${namePrefix}_roof_${layer.surface}_${s > 0 ? 'p' : 'n'}${i}`;
        if (axis === 'x') {
          A.box(name, layer.surface, width, layer.t, L, cx, yOff, cz + s * uOff, {
            rx: s * theta, collide: layer.collide,
          });
        } else {
          A.box(name, layer.surface, L, layer.t, width, cx + s * uOff, yOff, cz, {
            rz: -s * theta, collide: layer.collide,
          });
        }
      }

      // 시각 기와 (비충돌) — 표층 위에 수키와 골 반복
      if (tiles && !thatch) {
        const topOff = acc + 0.045;
        const rows = Math.max(1, Math.round(L / 0.46));
        const cols = Math.max(2, Math.floor(width / 0.3));
        for (let r = 0; r < rows; r++) {
          const tr = (r + 0.5) / rows;
          const u = u0 + du * tr + nU * topOff;
          const y = y0 + dy * tr + nY * topOff;
          for (let c = 0; c < cols; c++) {
            const w = -width / 2 + 0.15 + c * 0.3;
            if (axis === 'x') {
              A.place('tile', cx + w, y, cz + s * u, s * theta, 0, 0);
            } else {
              A.place('tile', cx + s * u, y, cz + w, 0, Math.PI / 2, s * theta);
            }
          }
        }
      }
    }

    // 서까래 — 처마 밑, ø150 (기와→보토→서까래 관통 체인의 3층)
    if (rafters) {
      const tE = (segments - 1) / segments;
      const thetaE = Math.atan2(profile(tE) - profile(1), halfRun / segments);
      const count = Math.max(2, Math.floor(width / 0.55));
      const uR = halfRun - 1.1;
      const yR = profile(1 - 1.1 / halfRun) - 0.12;
      for (let c = 0; c < count; c++) {
        const w = -width / 2 + 0.28 + c * ((width - 0.56) / (count - 1));
        if (axis === 'x') {
          A.place('rafter', cx + w, yR, cz + s * uR, s * thetaE, 0, 0);
        } else {
          A.place('rafter', cx + s * uR, yR, cz + w, 0, Math.PI / 2, s * thetaE);
        }
      }
    }
  }

  // 용마루
  const ridgeSurface = thatch ? 'THATCH' : 'ROOF_TILE';
  const rt = thatch ? 0.24 : 0.2;
  if (axis === 'x') {
    A.box(`${namePrefix}_ridge`, ridgeSurface, width, rt, 0.34, cx, ridgeY + rt / 2, cz);
  } else {
    A.box(`${namePrefix}_ridge`, ridgeSurface, 0.34, rt, width, cx, ridgeY + rt / 2, cz);
  }

  // 박공 판벽 (45mm) — 벽체 평면 위치
  if (gables) {
    const h = ridgeY - eaveY;
    const shape = new THREE.Shape([
      new THREE.Vector2(-span / 2 - overhangSide * 0.4, 0),
      new THREE.Vector2(span / 2 + overhangSide * 0.4, 0),
      new THREE.Vector2(0, h),
    ]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T.PANBYEOK_T, bevelEnabled: false });
    if (axis === 'x') {
      geo.rotateY(Math.PI / 2); // 삼각형 평면을 (z,y)로, 압출 두께를 +x로
      for (const e of [1, -1]) {
        A.mesh(`${namePrefix}_gable_${e > 0 ? 'p' : 'n'}`, 'WOOD_PLANK', geo,
          cx + e * ridgeLen / 2 - T.PANBYEOK_T / 2, eaveY, cz);
      }
    } else {
      for (const e of [1, -1]) {
        A.mesh(`${namePrefix}_gable_${e > 0 ? 'p' : 'n'}`, 'WOOD_PLANK', geo,
          cx, eaveY, cz + e * ridgeLen / 2 - T.PANBYEOK_T / 2);
      }
    }
  }
}
