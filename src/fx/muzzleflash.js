/**
 * src/fx/muzzleflash.js — 총구화염 지오메트리 + 트랜지언트 라이트 (P2B §4).
 *
 * 소유권 분리: P2B는 light:transient **발행**, 라이트 프리미티브 생성·수명,
 * 렌더 배선까지. 강도 곡선·색온도·감쇠 튜닝은 P3 소유 — 값은 전부
 * src/materials/fx-look.js 의 FLASH_LOOK 이 가진다 (R4 작업 3에서 배선 완료:
 * P2B가 발행만 하고 아무도 읽지 않던 colorK 훅이 이제 실제 라이트 색이 된다).
 *
 * 셰이더 순열 고정: 라이트 개수가 변하면 프로그램이 갈라진다(P0 원칙).
 * 트랜지언트 라이트는 **상시 상주 풀 2개**(강도 0)로 두고 강도만 애니메이션.
 *
 * 화염 지오메트리: 십자 쿼드 2장 + 축방향 콘 근사 — 절차 생성, 수명 0.1s,
 * 크기는 수명에 따라 축소. 난수 없음 (기하는 발사 입력에 결정적).
 */

import * as THREE from 'three';
import { bus } from '../core/events.js';
import { FLASH_LOOK, kelvinToRgb } from '../materials/fx-look.js';
import { buildFlashTexture } from '../materials/fx-alpha-atlas.js';

export const TRANSIENT_LIGHT_POOL = 2;
const FLASH_LIFE = 0.1;          // s — muzzle_interior 캡처 프레임에 걸리는 수명 (P2B 계약값, 불변)
const FLASH_SIZE = FLASH_LOOK.size;
const LIGHT_INTENSITY = FLASH_LOOK.lightPeak;
const LIGHT_DECAY_MS = FLASH_LOOK.lightDecayMs;
const LIGHT_DISTANCE = 9;
const LIGHT_RGB = kelvinToRgb(FLASH_LOOK.lightK);

/**
 * 수명 정규화 t(1=방금, 0=소멸) → [크기 배수, 밝기 배수].
 * P2B는 크기만 선형(0.4+0.6t)이었다. 화약 화염은 처음 한 프레임에 부풀었다가
 * 훨씬 빨리 죽는다 — 팽창 구간(riseFrac)과 지수 감쇠(decayCurve)로 나눈다.
 */
function flashCurve(t) {
  const rise = FLASH_LOOK.riseFrac;
  if (t > 1 - rise) {
    const u = (1 - t) / rise;            // 0 → 1 (팽창)
    return [0.55 + 0.45 * u, 1.0];
  }
  const u = t / (1 - rise);              // 1 → 0 (감쇠)
  const d = Math.pow(Math.max(0, u), FLASH_LOOK.decayCurve);
  return [0.55 + 0.45 * u, d];
}

export class MuzzleFlash {
  constructor(scene) {
    // 화염 지오메트리 — 십자 쿼드 (단일 메시, 평면 2장 병합)
    const g1 = new THREE.PlaneGeometry(1, 1);
    const g2 = new THREE.PlaneGeometry(1, 1);
    g2.rotateY(Math.PI / 2);
    const geo = mergePlanes(g1, g2);
    // 실루엣·색온도는 구운 텍스처가 싣고, 재질 색은 프레임별 밝기 곡선만 싣는다.
    // 가산 합성 — 화염은 뒤를 가리는 물체가 아니라 더해지는 빛이다.
    this.tex = buildFlashTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, color: 0xffffff, side: THREE.DoubleSide,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: true,
    });
    mat.name = 'FX_FLASH';
    this.mat = mat;
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
    this._applyCurve(1);

    bus.emit('light:transient', {
      worldPos: [x, y, z],
      intensity: LIGHT_INTENSITY,
      colorK: FLASH_LOOK.lightK, // P3가 소유하는 색온도 — 아래 풀 라이트 색과 같은 값
      decayMs: LIGHT_DECAY_MS,
    });
    const slot = this.lights[this._nextLight];
    this._nextLight = (this._nextLight + 1) % TRANSIENT_LIGHT_POOL;
    slot.light.color.setRGB(LIGHT_RGB[0], LIGHT_RGB[1], LIGHT_RGB[2], THREE.SRGBColorSpace);
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
        this._applyCurve(this.flashLife / FLASH_LIFE);
      }
    }
    for (const s of this.lights) {
      if (s.remainMs <= 0) continue;
      s.remainMs -= dt * 1000;
      // 선형 감쇠(P2B) → 지수 감쇠: 섬광은 앞이 밝고 뒤가 빨리 죽는다
      s.light.intensity = s.remainMs <= 0
        ? 0
        : s.initial * Math.pow(s.remainMs / LIGHT_DECAY_MS, FLASH_LOOK.lightCurve);
    }
  }

  /** 수명 t(1→0)에 따른 크기·밝기 적용 */
  _applyCurve(t) {
    const [sz, gain] = flashCurve(t);
    this.mesh.scale.setScalar(FLASH_SIZE * sz);
    const g = FLASH_LOOK.peakGain * gain;
    this.mat.color.setRGB(g, g, g);
  }

  reset() {
    this.flashLife = 0;
    this.mesh.visible = false;
    this.mat.color.setRGB(FLASH_LOOK.peakGain, FLASH_LOOK.peakGain, FLASH_LOOK.peakGain);
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
