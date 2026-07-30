/**
 * src/weapons/viewmodel.js — 뷰모델 리그 (P2A-BRIEF §3).
 *
 * 핵심 요구: 뷰모델은 월드와 **동일한 조도 단위**를 사용한다.
 * 구현 원칙: 뷰모델 메시를 **카메라의 자식으로 월드 씬에 그대로** 둔다.
 * 별도 씬·별도 광원·별도 노출·알베도 보정이 구조적으로 존재하지 않으므로
 * 참조 레포의 20× 조도 사고(월드와 다른 광원 리그)가 원천 봉쇄된다.
 * viewmodelaudit.mjs가 이 성질을 게이트한다.
 *
 * 회색 규율: 킷과 동일 파라미터의 MeshStandardMaterial 회색 2단계만 —
 * 셰이더 순열이 갈라지지 않아 프리웜 커버리지가 유지된다.
 * castShadow=false: 뷰모델이 월드에 그림자를 드리우면 카메라 위치가
 * 조명 결과를 바꿔 샷 결정성 외 요인이 생긴다.
 */

import * as THREE from 'three';
import { WEAPON_ORDER } from './weapon.js';

const GREY_MID = 0x7b766f;
const GREY_DARK = 0x585b5f;

/** 힙/ADS 포즈 (카메라 로컬, m) */
const POSE_HIP = Object.freeze({ x: 0.17, y: -0.15, z: -0.34, pitch: 0.0, yaw: -0.06 });
const POSE_ADS = Object.freeze({ x: 0.0, y: -0.108, z: -0.24, pitch: 0.0, yaw: 0.0 });
/** 반동 시각 반영 계수 */
const KICK_BACK_M = 0.05;   // recoilPitch(라디안)당 후퇴
const KICK_PITCH = 0.9;     // recoilPitch → 뷰모델 회전 배율

function mat(color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  m.name = color === GREY_MID ? 'VM_GREY_MID' : 'VM_GREY_DARK'; // albedoaudit 매니페스트 대조 대상
  return m;
}

/** 무기별 실루엣 — 전부 절차 지오메트리 (에셋 0 규칙) */
function buildRig(id) {
  const g = new THREE.Group();
  g.name = `vm_${id}`;
  const mid = mat(GREY_MID);
  const dark = mat(GREY_DARK);
  const add = (geo, m, x, y, z, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = `${g.name}_${geo.type}_${g.children.length}`;
    g.add(mesh);
    return mesh;
  };

  if (id === 'CARBINE') {
    add(new THREE.BoxGeometry(0.055, 0.09, 0.30), dark, 0, 0, -0.05);          // 몸통
    add(new THREE.BoxGeometry(0.045, 0.055, 0.22), mid, 0, 0.005, -0.30);      // 핸드가드
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 10), dark, 0, 0.01, -0.48, Math.PI / 2); // 총열
    add(new THREE.BoxGeometry(0.035, 0.14, 0.075), mid, 0, -0.105, 0.015, 0.22);// 탄창 (전방 경사)
    add(new THREE.BoxGeometry(0.05, 0.065, 0.16), mid, 0, -0.01, 0.16);        // 개머리 연결부
  } else if (id === 'SHOTGUN') {
    add(new THREE.BoxGeometry(0.06, 0.085, 0.26), mid, 0, 0, -0.02);           // 기관부
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.44, 12), dark, 0, 0.02, -0.36, Math.PI / 2); // 총열
    add(new THREE.CylinderGeometry(0.013, 0.013, 0.36, 10), dark, 0, -0.025, -0.33, Math.PI / 2); // 관형 탄창
    add(new THREE.BoxGeometry(0.05, 0.05, 0.13), dark, 0, -0.02, -0.30);       // 펌프
  } else if (id === 'DMR') {
    add(new THREE.BoxGeometry(0.05, 0.095, 0.34), mid, 0, 0, -0.03);           // 몸통(목재조)
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.40, 12), dark, 0, 0.012, -0.52, Math.PI / 2); // 장총열
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 12), dark, 0, 0.075, -0.06, Math.PI / 2); // 조준경
    add(new THREE.BoxGeometry(0.03, 0.11, 0.06), dark, 0, -0.095, 0.03);       // 탄창
  } else {
    throw new Error(`unknown viewmodel rig: ${id}`);
  }
  return g;
}

/**
 * viewmodelaudit 전용 카드 리그 (테스트 훅 — P1.5-4 규칙: 게이트 기본 경로 불변,
 * 사용 시 출력에 testOverride 표식).
 *
 * 알베도 0.18 카드 2장을 **같은 월드 위치·같은 법선**에 나란히 둔다:
 * 하나는 월드 공간, 하나는 카메라 자식(뷰모델 공간). 리그가 조도 단위를
 * 공유하면 두 카드의 렌더 휘도는 동일해야 한다. boost≠1이면 뷰모델 카드
 * 알베도를 boost배 — 리그 불일치와 등가인 휘도 편차를 주입하는 음성 훅.
 *
 * 반환 rects는 CSS px 화면 사각형 (카드 내접 60% 영역).
 */
export function setupViewmodelAudit({ scene, camera, applySun, patchMaterial = () => {}, boost = 1 }) {
  const DIST = 8;          // 카메라 전방 거리 (m)
  const SIZE = 0.6;        // 카드 한 변 (m)
  const GAP = 0.75;        // 카드 중심 간격 (m)

  // 결정적 고정 시점: 마당 남측에서 북향 (개활 — 정오 태양 무차폐)
  camera.position.set(0, 1.7, 14);
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.updateProjectionMatrix();
  applySun();

  const cardMat = (v) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    m.color.setRGB(v, v, v, THREE.LinearSRGBColorSpace);
    m.name = `audit_card_${v}`;
    patchMaterial(m); // CSM — 미패치 카드는 캐스케이드 3중 수광 (P3 C1)
    return m;
  };
  const geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const mk = (name, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };

  // 월드 카드: 월드 공간 (카메라 전방 8m, 좌측)
  const world = mk('audit_world', cardMat(0.18));
  world.position.set(-GAP, 1.7, 14 - DIST);
  scene.add(world);

  // 뷰모델 카드: 카메라 자식 — 동일 월드 위치(우측)·동일 법선(+Z)
  const vmMat = cardMat(0.18 * boost);
  const vm = mk('audit_vm', vmMat);
  vm.position.set(GAP, 0, -DIST);
  camera.add(vm);

  // 검정 카드: 카메라 자식, 알베도 0 (부스트 비적용 — 검정은 검정이어야 한다)
  const black = mk('audit_black', cardMat(0.0));
  black.position.set(0, -GAP, -DIST);
  camera.add(black);

  const nodes = [world, vm, black];

  // 화면 사각형 산출 (CSS px, 카드 내접 60%)
  camera.updateMatrixWorld(true);
  const rectOf = (mesh) => {
    const c = new THREE.Vector3();
    mesh.getWorldPosition(c);
    const half = (SIZE / 2) * 0.6;
    const corners = [
      [-half, -half], [half, -half], [-half, half], [half, half],
    ].map(([dx, dy]) => {
      const p = new THREE.Vector3(c.x + dx, c.y + dy, c.z).project(camera);
      return [(p.x * 0.5 + 0.5) * innerWidth, (1 - (p.y * 0.5 + 0.5)) * innerHeight];
    });
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...xs) - x), h: Math.round(Math.max(...ys) - y) };
  };
  const rects = {
    world: rectOf(world),
    vm: rectOf(vm),
    black: rectOf(black),
  };
  // 배경 샘플: 검정 카드 바로 옆(우측 한 칸) 동일 크기 영역
  rects.backdrop = { ...rects.black, x: rects.black.x + Math.round(rects.black.w * 1.6) };

  return {
    rects,
    boost,
    dispose() {
      for (const n of nodes) n.parent?.remove(n);
    },
  };
}

export class Viewmodel {
  /** @param {THREE.Camera} camera 씬에 add된 카메라 — 자식이 월드 조명으로 렌더된다 */
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.name = 'viewmodel_root';
    this.rigs = new Map();
    for (const id of WEAPON_ORDER) {
      const rig = buildRig(id);
      rig.visible = false;
      this.rigs.set(id, rig);
      this.root.add(rig);
    }
    camera.add(this.root);
    this.visible = true;
  }

  /** 하네스 샷 캡처용 — 샷 데이터가 명시하지 않으면 숨김 */
  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  /** 매 프레임 — 현재 무기 상태로 포즈 갱신 */
  update(weapon) {
    for (const [id, rig] of this.rigs) rig.visible = this.visible && id === weapon.id;
    if (!this.visible) return;
    const b = weapon.adsBlend;
    const x = POSE_HIP.x + (POSE_ADS.x - POSE_HIP.x) * b;
    const y = POSE_HIP.y + (POSE_ADS.y - POSE_HIP.y) * b;
    const z = POSE_HIP.z + (POSE_ADS.z - POSE_HIP.z) * b + weapon.recoilPitch * KICK_BACK_M;
    const yaw = POSE_HIP.yaw * (1 - b);
    this.root.position.set(x, y, z);
    this.root.rotation.set(weapon.recoilPitch * KICK_PITCH, yaw, 0);
  }
}
