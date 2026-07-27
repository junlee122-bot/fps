/**
 * src/world/greybox.js — P0 회색 박스 월드.
 *
 * 90×90m 관아 경내의 공간 문법(ARCHITECTURE §5)을 회색 프리미티브로 배치한다:
 * 마당 / 대청 / 방×2 / 회랑 / 담장 / 누각 / 연못 / 석등 / 범종 / 등롱.
 * 모든 정적 메시는 표면 타입 태그를 달고 물리 BVH에 등록된다.
 * 색·머티리얼 작업은 P3 — 여기서는 회색 계열만 (P1 지시 준수).
 *
 * 좌표: 원점 = 마당 중심, 북 = -Z. 담장 중심선 ±44m.
 */

import * as THREE from 'three';
// 주의: physics를 직접 import하지 않는다 (ARCHITECTURE §3).
// 물리 접근은 전부 buildGreybox(scene, physics)로 주입받은 파사드를 통한다.

// ---------------------------------------------------------------- 상수
const WALL_HALF = 44;          // 담장 중심선
const GATE_HALF_W = 3.2;       // 남문 개구 절반 폭
const HALL_KIDAN_TOP = 0.7;    // 대청 기단 상단
const HALL_FLOOR_TOP = 0.86;   // 대청 마루 상단
const PAVILION_DECK_TOP = 3.08;
const CRATE_HALF = 0.35;
const CRATE_MASS = 14;

/** P0 회색 팔레트 — 표면 구분용 미세 톤 차이만 */
const GREY = Object.freeze({
  PACKED_DIRT: 0x8f8c88,
  GRANITE: 0x9e9e9c,
  WOOD_COLUMN: 0x6e6a64,
  WOOD_PLANK: 0x7d7871,
  WOOD_LATTICE: 0x615d56,
  HANJI: 0xe3e0d8,
  EARTH_WALL: 0x87847e,
  ROOF_TILE: 0x5f6266,
  WATER: 0x6e7a80,
  BRONZE: 0x6f6d62,
  FABRIC: 0xc9c4ba,
  THATCH: 0x93897a,
});

function makeMaterials() {
  const m = {};
  for (const [key, color] of Object.entries(GREY)) {
    const opts = { color, roughness: 0.92, metalness: 0.0 };
    if (key === 'BRONZE') { opts.roughness = 0.5; opts.metalness = 0.55; }
    if (key === 'ROOF_TILE') opts.roughness = 0.8;
    const mat = new THREE.MeshStandardMaterial(opts);
    if (key === 'HANJI') {
      mat.transparent = true;
      mat.opacity = 0.62;
      mat.side = THREE.DoubleSide;
    }
    if (key === 'WATER') {
      mat.transparent = true;
      mat.opacity = 0.85;
      mat.roughness = 0.25;
    }
    mat.name = key;
    m[key] = mat;
  }
  // 등롱 갓 — 자발광 (야간 샷용). 표면 태그는 FABRIC(발/천 계열)
  m.LANTERN = new THREE.MeshStandardMaterial({
    color: 0xd8cba8,
    emissive: 0xffcf9e,
    emissiveIntensity: 1.1,
    roughness: 0.9,
  });
  m.LANTERN.name = 'LANTERN';
  return m;
}

export function buildGreybox(scene, physics) {
  const group = new THREE.Group();
  group.name = 'greybox';
  const mats = makeMaterials();
  const LAYER_STATIC = physics.layers.STATIC;
  const LAYER_DEBRIS_ONLY = physics.layers.DEBRIS_ONLY;

  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    let g = geoCache.get(key);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(key, g); }
    return g;
  }

  function addBox(name, surface, w, h, d, x, y, z, { rx = 0, ry = 0, layer = LAYER_STATIC, mat = null, collide = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), mat ?? mats[surface]);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.y = ry;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.userData.surface = surface;
    group.add(mesh);
    if (collide) physics.addStaticMesh(mesh, surface, layer);
    return mesh;
  }

  function addCylinder(name, surface, r, h, x, y, z, segments = 12) {
    const key = `cyl|${r}|${h}|${segments}`;
    let g = geoCache.get(key);
    if (!g) { g = new THREE.CylinderGeometry(r, r, h, segments); geoCache.set(key, g); }
    const mesh = new THREE.Mesh(g, mats[surface]);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.surface = surface;
    group.add(mesh);
    physics.addStaticMesh(mesh, surface, LAYER_STATIC);
    return mesh;
  }

  /* ------------------------------------------------------------ 지면 */
  addBox('ground', 'PACKED_DIRT', 90, 1, 90, 0, -0.5, 0, { shadow: false });

  /* ------------------------------------------------------------ 담장 (하부 화강암 / 상부 흙벽 / 기와 갓) */
  const wallRuns = [
    // [중심 x, 중심 z, 길이, 축('x'|'z')]
    [0, -WALL_HALF, 88.7, 'x'],                     // 북
    [-WALL_HALF, 0, 88.7, 'z'],                     // 서
    [WALL_HALF, 0, 88.7, 'z'],                      // 동
    // 남벽은 문 개구로 2분할
    [-(GATE_HALF_W + (WALL_HALF - GATE_HALF_W) / 2) - 0.35, WALL_HALF, WALL_HALF - GATE_HALF_W + 0.7, 'x'],
    [GATE_HALF_W + (WALL_HALF - GATE_HALF_W) / 2 + 0.35, WALL_HALF, WALL_HALF - GATE_HALF_W + 0.7, 'x'],
  ];
  let wi = 0;
  for (const [cx, cz, len, axis] of wallRuns) {
    const alongX = axis === 'x';
    const w = alongX ? len : 0.7;
    const d = alongX ? 0.7 : len;
    const wu = alongX ? len : 0.5;
    const du = alongX ? 0.5 : len;
    const wc = alongX ? len : 0.85;
    const dc = alongX ? 0.85 : len;
    addBox(`wall_base_${wi}`, 'GRANITE', w, 0.9, d, cx, 0.45, cz);
    addBox(`wall_earth_${wi}`, 'EARTH_WALL', wu, 1.5, du, cx, 1.65, cz);
    addBox(`wall_coping_${wi}`, 'ROOF_TILE', wc, 0.25, dc, cx, 2.525, cz);
    wi++;
  }
  // 남문 (문루): 기둥 + 인방 + 지붕
  addBox('gate_pillar_w', 'GRANITE', 0.9, 3.0, 0.9, -GATE_HALF_W - 0.45, 1.5, WALL_HALF);
  addBox('gate_pillar_e', 'GRANITE', 0.9, 3.0, 0.9, GATE_HALF_W + 0.45, 1.5, WALL_HALF);
  addBox('gate_lintel', 'WOOD_PLANK', 8.4, 0.5, 1.0, 0, 3.25, WALL_HALF);
  addBox('gate_roof', 'ROOF_TILE', 9.6, 0.35, 2.6, 0, 3.68, WALL_HALF);

  /* ------------------------------------------------------------ 대청 (북) */
  // 기단 x[-10,10] z[-30,-18]
  addBox('hall_kidan', 'GRANITE', 20, HALL_KIDAN_TOP, 12, 0, HALL_KIDAN_TOP / 2, -24);
  // 진입 경사(P0 계단 대용 — 실제 계단은 P1 한옥 킷에서)
  const rampLen = Math.hypot(3.0, HALL_KIDAN_TOP);
  addBox('hall_ramp', 'GRANITE', 3.0, 0.12, rampLen, 0, HALL_KIDAN_TOP / 2 - 0.03, -18 + 1.5, {
    rx: Math.atan2(HALL_KIDAN_TOP, 3.0),
  });
  // 마루
  addBox('hall_floor', 'WOOD_PLANK', 19, 0.16, 11, 0, HALL_FLOOR_TOP - 0.08, -24);
  // 기둥 2×5
  for (const zRow of [-19.3, -28.7]) {
    for (const xc of [-8, -4, 0, 4, 8]) {
      addCylinder(`hall_col_${xc}_${zRow}`, 'WOOD_COLUMN', 0.22, 3.3, xc, HALL_FLOOR_TOP + 1.65, zRow);
    }
  }
  // 지붕
  addBox('hall_roof', 'ROOF_TILE', 22, 0.5, 14, 0, 4.41, -24);
  // 후면 판벽 / 측면 흙벽
  addBox('hall_back', 'WOOD_PLANK', 19, 3.3, 0.15, 0, HALL_FLOOR_TOP + 1.65, -29.3);
  addBox('hall_side_w', 'EARTH_WALL', 0.35, 3.3, 11, -9.4, HALL_FLOOR_TOP + 1.65, -24);
  addBox('hall_side_e', 'EARTH_WALL', 0.35, 3.3, 11, 9.4, HALL_FLOOR_TOP + 1.65, -24);
  // 전면 창호 (중앙 2베이 개방, 좌우 베이 창호지 + 창살)
  for (const bayX of [-6, 6]) {
    addBox(`hall_hanji_${bayX}`, 'HANJI', 3.55, 2.6, 0.03, bayX, HALL_FLOOR_TOP + 1.3, -19.3);
    for (const off of [-1.1, 0, 1.1]) {
      addBox(`hall_lattice_${bayX}_${off}`, 'WOOD_LATTICE', 0.06, 2.6, 0.06, bayX + off, HALL_FLOOR_TOP + 1.3, -19.24);
    }
    addBox(`hall_lattice_h_${bayX}`, 'WOOD_LATTICE', 3.55, 0.06, 0.06, bayX, HALL_FLOOR_TOP + 1.3, -19.24);
  }

  /* ------------------------------------------------------------ 방 ×2 (서/동) — 4면 관통되는 좁은 실내 */
  function buildRoom(cx, cz, doorSide, withDummy) {
    const tag = doorSide === 'e' ? 'w' : 'e';
    addBox(`room_${tag}_base`, 'GRANITE', 9, 0.35, 9, cx, 0.175, cz);
    addBox(`room_${tag}_floor`, 'WOOD_PLANK', 8.4, 0.14, 8.4, cx, 0.49, cz);
    for (const [ox, oz] of [[-3.9, -3.9], [3.9, -3.9], [-3.9, 3.9], [3.9, 3.9]]) {
      addCylinder(`room_${tag}_col_${ox}_${oz}`, 'WOOD_COLUMN', 0.16, 2.7, cx + ox, 0.56 + 1.35, cz + oz);
    }
    const wallY = 0.56 + 1.1;
    // 남/북 벽 (x축 패널)
    addBox(`room_${tag}_hanji_n`, 'HANJI', 7.6, 2.2, 0.03, cx, wallY, cz - 3.95);
    addBox(`room_${tag}_hanji_s`, 'HANJI', 7.6, 2.2, 0.03, cx, wallY, cz + 3.95);
    // 문 반대쪽 벽 (통짜)
    const solidX = doorSide === 'e' ? cx - 3.95 : cx + 3.95;
    addBox(`room_${tag}_hanji_solid`, 'HANJI', 0.03, 2.2, 7.6, solidX, wallY, cz);
    // 문 쪽 벽 (개구 1.5m)
    const doorX = doorSide === 'e' ? cx + 3.95 : cx - 3.95;
    addBox(`room_${tag}_hanji_d1`, 'HANJI', 0.03, 2.2, 3.05, doorX, wallY, cz - 2.275);
    addBox(`room_${tag}_hanji_d2`, 'HANJI', 0.03, 2.2, 3.05, doorX, wallY, cz + 2.275);
    // 창살 몇 가닥 (남벽)
    for (const off of [-2.5, -1.25, 0, 1.25, 2.5]) {
      addBox(`room_${tag}_lat_${off}`, 'WOOD_LATTICE', 0.05, 2.2, 0.05, cx + off, wallY, cz + 3.9);
    }
    addBox(`room_${tag}_roof`, 'ROOF_TILE', 10, 0.4, 10, cx, 3.1, cz);
    if (withDummy) {
      // 창호지 너머 실루엣 더미 (hanji_silhouette 샷)
      const g = new THREE.CapsuleGeometry(0.28, 1.1, 4, 12);
      const dummy = new THREE.Mesh(g, mats.FABRIC);
      dummy.name = 'silhouette_dummy';
      dummy.position.set(cx - 1.5, 0.56 + 0.83, cz);
      dummy.castShadow = true;
      dummy.receiveShadow = true;
      dummy.userData.surface = 'FABRIC';
      group.add(dummy);
      physics.addStaticMesh(dummy, 'FABRIC', LAYER_STATIC);
    }
  }
  buildRoom(-28, -8, 'e', true);   // 서방 — 문은 동쪽, 더미 있음
  buildRoom(28, -8, 'w', false);   // 동방 — 문은 서쪽 (muzzle_interior 무대)

  /* ------------------------------------------------------------ 회랑 (동) — 기둥 리듬 */
  for (let i = 0; i < 13; i++) {
    const z = -30 + i * 4;
    addBox(`corr_footing_${i}`, 'GRANITE', 0.55, 0.35, 0.55, 38, 0.175, z);
    addCylinder(`corr_col_${i}`, 'WOOD_COLUMN', 0.2, 3.0, 38, 0.35 + 1.5, z);
  }
  addBox('corr_floor', 'WOOD_PLANK', 2.6, 0.18, 50, 38, 0.26, -6);
  addBox('corr_roof', 'ROOF_TILE', 3.6, 0.35, 52, 38, 3.2, -6);

  /* ------------------------------------------------------------ 누각 (남서) — 고지대, 마루 관통 가능 */
  for (const [ox, oz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
    addCylinder(`pav_col_${ox}_${oz}`, 'WOOD_COLUMN', 0.26, 3.2, -30 + ox, 1.6, 28 + oz);
  }
  addBox('pav_deck', 'WOOD_PLANK', 6, 0.28, 6, -30, PAVILION_DECK_TOP - 0.14, 28);
  addBox('pav_roof', 'ROOF_TILE', 7, 0.4, 7, -30, 5.6, 28);
  for (const side of [-1, 1]) {
    addBox(`pav_rail_${side}`, 'WOOD_PLANK', 0.07, 0.85, 6, -30 + side * 2.97, PAVILION_DECK_TOP + 0.42, 28);
  }
  addBox('pav_rail_s', 'WOOD_PLANK', 6, 0.85, 0.07, -30, PAVILION_DECK_TOP + 0.42, 30.97);
  // 진입 경사 (북측)
  const pavRun = 7.0;
  const pavRampLen = Math.hypot(pavRun, PAVILION_DECK_TOP);
  addBox('pav_ramp', 'WOOD_PLANK', 1.6, 0.12, pavRampLen, -30, PAVILION_DECK_TOP / 2, 25 - pavRun / 2, {
    rx: -Math.atan2(PAVILION_DECK_TOP, pavRun),
  });

  /* ------------------------------------------------------------ 연못 (남동) — 석지 */
  addBox('pond_rim_n', 'GRANITE', 11.0, 0.55, 0.8, 28, 0.275, 28 - 5.1);
  addBox('pond_rim_s', 'GRANITE', 11.0, 0.55, 0.8, 28, 0.275, 28 + 5.1);
  addBox('pond_rim_w', 'GRANITE', 0.8, 0.55, 9.4, 28 - 5.1, 0.275, 28);
  addBox('pond_rim_e', 'GRANITE', 0.8, 0.55, 9.4, 28 + 5.1, 0.275, 28);
  // 물 — 캐릭터는 통과(빠져서 헤엄 아님 도섭), 탄·파편만 충돌
  addBox('pond_water', 'WATER', 9.6, 0.45, 9.6, 28, 0.175, 28, { layer: LAYER_DEBRIS_ONLY, shadow: false });

  /* ------------------------------------------------------------ 석등 ×3 — 마당의 유일 엄폐 */
  function stoneLantern(i, x, z) {
    addBox(`slantern_${i}_base`, 'GRANITE', 0.95, 0.28, 0.95, x, 0.14, z);
    addBox(`slantern_${i}_shaft`, 'GRANITE', 0.3, 0.85, 0.3, x, 0.28 + 0.425, z);
    addBox(`slantern_${i}_lamp`, 'GRANITE', 0.62, 0.5, 0.62, x, 1.13 + 0.25, z);
    addBox(`slantern_${i}_cap`, 'GRANITE', 0.85, 0.22, 0.85, x, 1.63 + 0.11, z);
  }
  stoneLantern(0, -10, 6);
  stoneLantern(1, 10, 6);
  stoneLantern(2, 0, 16);
  // 초석 더미 (엄폐 보조)
  addBox('block_a', 'GRANITE', 0.85, 0.55, 0.85, -8, 0.275, 14);
  addBox('block_b', 'GRANITE', 0.85, 0.55, 0.85, -7, 0.275, 14.9);

  /* ------------------------------------------------------------ 범종 (북동) — BRONZE 시그니처 */
  addBox('bell_plinth', 'GRANITE', 2.4, 0.35, 2.4, 34, 0.175, -34);
  addCylinder('bell', 'BRONZE', 0.8, 1.5, 34, 0.35 + 0.75, -34, 16);
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    addCylinder(`bell_col_${ox}_${oz}`, 'WOOD_COLUMN', 0.18, 3.2, 34 + ox, 1.6, -34 + oz);
  }
  addBox('bell_roof', 'ROOF_TILE', 4.2, 0.4, 4.2, 34, 3.4, -34);

  /* ------------------------------------------------------------ 등롱 ×2 (남문 안쪽) — 자발광 + 포인트라이트 */
  const lanternLights = [];
  for (const side of [-1, 1]) {
    const x = side * 5, z = 40;
    addCylinder(`lantern_post_${side}`, 'WOOD_COLUMN', 0.09, 2.3, x, 1.15, z);
    addBox(`lantern_head_${side}`, 'FABRIC', 0.36, 0.36, 0.36, x, 2.35, z, { mat: mats.LANTERN });
    const light = new THREE.PointLight(0xffcf9e, 0, 18, 2);
    light.name = `lantern_light_${side}`;
    light.position.set(x, 2.45, z);
    group.add(light);
    lanternLights.push(light);
  }

  /* ------------------------------------------------------------ 동적 상자 ×3 (강체 검증) */
  const crateGeo = new THREE.BoxGeometry(CRATE_HALF * 2, CRATE_HALF * 2, CRATE_HALF * 2);
  const crateSpecs = [
    { pos: [2, 1.0, 6], yaw: 0 },
    { pos: [2.85, 1.85, 6.3], yaw: 0.5 },
    { pos: [1.35, 2.65, 5.8], yaw: 1.1 },
  ];
  const crates = [];
  crateSpecs.forEach((spec, i) => {
    const mesh = new THREE.Mesh(crateGeo, mats.WOOD_PLANK);
    mesh.name = `crate_${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
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
    crates.push({
      body,
      mesh,
      initPos: new THREE.Vector3(...spec.pos),
      initQuat: quat.clone(),
    });
  });

  scene.add(group);

  /** 동적 상태 초기화 — resetState() 경로. 비트 동일 재현의 핵심 */
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

  return { group, crates, lanternLights, resetDynamic };
}
