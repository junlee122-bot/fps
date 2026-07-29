/**
 * src/fx/muzzleflash.js — 총구화염 지오메트리 + 트랜지언트 라이트 (P2B §4).
 *
 * 소유권 분리: P2B는 light:transient **발행**, 라이트 프리미티브 생성·수명,
 * 렌더 배선까지. 강도 곡선·색온도·감쇠 튜닝은 P3 소유 — 여기는 회색·
 * 고정 강도 + 선형 감쇠 훅만 둔다.
 *
 * 셰이더 순열 고정: 라이트 개수가 변하면 프로그램이 갈라진다(P0 원칙).
 * 트랜지언트 라이트는 **상시 상주 풀 2개**(강도 0)로 두고 강도만 애니메이션.
 *
 * 화염 지오메트리: 십자 쿼드 2장 + 축방향 콘 근사 — 절차 생성, 수명 0.1s,
 * 크기는 수명에 따라 축소. 난수 없음 (기하는 발사 입력에 결정적).
 */

import * as THREE from 'three';
import { bus } from '../core/events.js';

export const TRANSIENT_LIGHT_POOL = 2;
const FLASH_LIFE = 0.1;          // s — muzzle_interior 캡처 프레임에 걸리는 수명
const FLASH_SIZE = 0.22;         // m
const LIGHT_INTENSITY = 6;       // P3 튜닝 훅 (고정값)
const LIGHT_DECAY_MS = 150;
const LIGHT_DISTANCE = 9;

export class MuzzleFlash {
  constructor(scene) {
    // 화염 지오메트리 — 십자 쿼드 (단일 메시, 평면 2장 병합)
    const g1 = new THREE.PlaneGeometry(1, 1);
    const g2 = new THREE.PlaneGeometry(1, 1);
    g2.rotateY(Math.PI / 2);
    const geo = mergePlanes(g1, g2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8e5dc, side: THREE.DoubleSide });
    mat.name = 'FX_FLASH';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'fx_muzzleflash';
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.flashLife = 0;

    // 상시 상주 트랜지언트 라이트 풀 — 개수 불변 (프로그램 순열 고정)
    this.lights = [];
    for (let i = 0; i < TRANSIENT_LIGHT_POOL; i++) {
      const L = new THREE.PointLight(0xffffff, 0, LIGHT_DISTANCE);
      L.name = `fx_transient_${i}`;
      L.castShadow = false;
      scene.add(L);
      this.lights.push({ light: L, remainMs: 0, initial: 0 });
    }
    this._nextLight = 0; // 라운드로빈 — 결정적
  }

  /** 발사 1회 — 화염 표시 + light:transient 발행 + 풀 라이트 점화 */
  fire(x, y, z, dx, dy, dz) {
    this.mesh.position.set(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12);
    this.mesh.lookAt(x + dx * 2, y + dy * 2, z + dz * 2);
    this.flashLife = FLASH_LIFE;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(FLASH_SIZE);

    bus.emit('light:transient', {
      worldPos: [x, y, z],
      intensity: LIGHT_INTENSITY,
      colorK: 6500,             // P3 튜닝 훅 — P2B는 무채색 고정
      decayMs: LIGHT_DECAY_MS,
    });
    const slot = this.lights[this._nextLight];
    this._nextLight = (this._nextLight + 1) % TRANSIENT_LIGHT_POOL;
    slot.light.position.set(x, y, z);
    slot.light.intensity = LIGHT_INTENSITY;
    slot.initial = LIGHT_INTENSITY;
    slot.remainMs = LIGHT_DECAY_MS;
  }

  update(dt) {
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.mesh.visible = false;
      } else {
        // 수명따라 축소 (P3가 강도 곡선으로 대체할 훅)
        this.mesh.scale.setScalar(FLASH_SIZE * (0.4 + 0.6 * this.flashLife / FLASH_LIFE));
      }
    }
    for (const s of this.lights) {
      if (s.remainMs <= 0) continue;
      s.remainMs -= dt * 1000;
      s.light.intensity = s.remainMs <= 0 ? 0 : s.initial * (s.remainMs / LIGHT_DECAY_MS);
    }
  }

  reset() {
    this.flashLife = 0;
    this.mesh.visible = false;
    for (const s of this.lights) {
      s.remainMs = 0;
      s.initial = 0;
      s.light.intensity = 0;
      s.light.position.set(0, -50, 0);
    }
    this._nextLight = 0;
  }

  snapshot() {
    return {
      flashLife: +this.flashLife.toFixed(5),
      lights: this.lights.map((s) => +s.light.intensity.toFixed(5)),
      next: this._nextLight,
    };
  }
}

/** 평면 2장 병합 (비인덱스 변환 없이 인덱스 유지) */
function mergePlanes(a, b) {
  const pos = new Float32Array(a.attributes.position.count * 3 + b.attributes.position.count * 3);
  const nor = new Float32Array(pos.length);
  const uv = new Float32Array((a.attributes.position.count + b.attributes.position.count) * 2);
  pos.set(a.attributes.position.array, 0);
  pos.set(b.attributes.position.array, a.attributes.position.count * 3);
  nor.set(a.attributes.normal.array, 0);
  nor.set(b.attributes.normal.array, a.attributes.position.count * 3);
  uv.set(a.attributes.uv.array, 0);
  uv.set(b.attributes.uv.array, a.attributes.position.count * 2);
  const idx = [];
  for (let i = 0; i < a.index.count; i++) idx.push(a.index.array[i]);
  for (let i = 0; i < b.index.count; i++) idx.push(b.index.array[i] + a.attributes.position.count);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  a.dispose(); b.dispose();
  return g;
}
