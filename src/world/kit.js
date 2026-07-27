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
  BOTO_T: 0.08,        // 보토 80mm (EARTH_WALL 태그)
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

/** 공포 — 주심포(1출목) / 다포(2출목) 간이형. 원점이 조립 하단 중심 */
export function bracketGeometry(kind) {
  const specs = [
    // 주두
    [0.36, 0.2, 0.36, 0, 0.10, 0],
    // 1출목 첨차(도리 방향 x) + 살미(직교 z)
    [0.92, 0.16, 0.18, 0, 0.28, 0],
    [0.18, 0.16, 0.68, 0, 0.28, 0],
    // 소로 4
    [0.12, 0.12, 0.12, -0.36, 0.44, 0],
    [0.12, 0.12, 0.12, 0.36, 0.44, 0],
    [0.12, 0.12, 0.12, 0, 0.44, -0.24],
    [0.12, 0.12, 0.12, 0, 0.44, 0.24],
  ];
  if (kind === 'dapo') {
    specs.push(
      [1.24, 0.16, 0.18, 0, 0.56, 0],
      [0.18, 0.16, 0.96, 0, 0.56, 0],
      [0.12, 0.12, 0.12, -0.5, 0.72, 0],
      [0.12, 0.12, 0.12, 0.5, 0.72, 0],
      [0.12, 0.12, 0.12, 0, 0.72, -0.38],
      [0.12, 0.12, 0.12, 0, 0.72, 0.38],
    );
  }
  return mergeBoxes(specs);
}

/** 공포 조립 높이 (지붕 처마 산정용) */
export const BRACKET_H = Object.freeze({ jusimpo: 0.5, dapo: 0.78 });

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

  /** 모든 인스턴스 계열을 InstancedMesh로 확정 + 콜라이더 등록 */
  finalizeInstancing() {
    const created = [];
    for (const [key, rec] of this.inst) {
      if (rec.xforms.length === 0) continue;
      const im = new THREE.InstancedMesh(rec.geometry, this.mats[rec.matKey], rec.xforms.length);
      im.name = `inst_${key}`;
      for (let i = 0; i < rec.xforms.length; i++) im.setMatrixAt(i, rec.xforms[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = rec.shadow;
      im.receiveShadow = true;
      im.userData.surface = rec.surface;
      this.group.add(im);
      if (rec.collide) this.physics.addStaticMesh(im, rec.surface, rec.layer);
      created.push({ key, count: rec.xforms.length });
    }
    return created;
  }
}

/* ------------------------------------------------------------------ */
/* 맞배지붕 빌더                                                        */
/* ------------------------------------------------------------------ */

/**
 * 충돌 2레이어(기와 ROOF_TILE 30mm 위 / 보토 EARTH_WALL 80mm 아래 — 탄이 위에서
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
        { surface: 'EARTH_WALL', t: T.BOTO_T, collide: true },  // 보토 (아래)
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
