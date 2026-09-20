/**
 * src/fx/tracers.js — 예광 풀 (P2B-BRIEF §1).
 *
 * 총구→최종 도달점 얇은 사각기둥 스트릭. 수명 동안 두께가 줄며 소멸
 * (투명도 없이 — 블렌드 순서 문제 회피). 색·색온도는 P3 소유:
 * src/materials/fx-look.js 의 TRACER_LOOK 을 읽어 인스턴스마다 나이에 따라
 * 식는 색(headK→tailK)과 감광 곡선을 싣는다 (R4 작업 3).
 * 시간은 update(dt) 누적만, 난수 미사용 — 기하는 입력에 결정적.
 */

import * as THREE from 'three';
import { TRACER_LOOK, kelvinToRgb } from '../materials/fx-look.js';

const TRACER_CAPACITY = 64;
const TRACER_LIFE = 0.09;      // s
const TRACER_THICK = 0.012;    // m (시작 두께)
const HEAD_RGB = kelvinToRgb(TRACER_LOOK.headK);
const TAIL_RGB = kelvinToRgb(TRACER_LOOK.tailK);

export class TracerPool {
  constructor(scene) {
    this.capacity = TRACER_CAPACITY;
    this.active = 0;
    this.from = new Float32Array(TRACER_CAPACITY * 3);
    this.to = new Float32Array(TRACER_CAPACITY * 3);
    this.life = new Float32Array(TRACER_CAPACITY);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, -0.5); // 원점=시작점, -z로 길이 1
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.name = 'FX_TRACER';
    this.mesh = new THREE.InstancedMesh(geo, mat, TRACER_CAPACITY);
    this.mesh.name = 'fx_tracers';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // instanceColor 버퍼 확보
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this._c = new THREE.Color();

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._look = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  spawn(fx, fy, fz, tx, ty, tz) {
    let i;
    if (this.active < this.capacity) i = this.active++;
    else i = 0; // 포화 시 최고령(0) 재사용 — swap-remove 순서상 0이 최고령 근사, 규칙 고정
    this.from[i * 3] = fx; this.from[i * 3 + 1] = fy; this.from[i * 3 + 2] = fz;
    this.to[i * 3] = tx; this.to[i * 3 + 1] = ty; this.to[i * 3 + 2] = tz;
    this.life[i] = TRACER_LIFE;
  }

  update(dt) {
    let i = 0;
    while (i < this.active) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.active;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.from[i * 3 + k] = this.from[last * 3 + k];
            this.to[i * 3 + k] = this.to[last * 3 + k];
          }
          this.life[i] = this.life[last];
        }
        continue;
      }
      i++;
    }
  }

  writeInstances() {
    for (let i = 0; i < this.active; i++) {
      this._p.set(this.from[i * 3], this.from[i * 3 + 1], this.from[i * 3 + 2]);
      this._t.set(this.to[i * 3], this.to[i * 3 + 1], this.to[i * 3 + 2]);
      const len = this._p.distanceTo(this._t);
      this._look.lookAt(this._p, this._t, this._up);
      this._q.setFromRotationMatrix(this._look);
      const t = this.life[i] / TRACER_LIFE;                   // 1(방금) → 0(소멸)
      const th = TRACER_THICK * t;                            // 수명따라 얇아짐
      this._s.set(th, th, len);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      // 나이 들수록 식는다: 색온도 headK→tailK, 밝기는 지수 감쇠 (선형 색 배수)
      const g = TRACER_LOOK.peakGain * Math.pow(t, TRACER_LOOK.decayCurve);
      this._c.setRGB(
        HEAD_RGB[0] * t + TAIL_RGB[0] * (1 - t),
        HEAD_RGB[1] * t + TAIL_RGB[1] * (1 - t),
        HEAD_RGB[2] * t + TAIL_RGB[2] * (1 - t),
        THREE.SRGBColorSpace,
      );
      this._c.multiplyScalar(g);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  reset() {
    this.active = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return { active: this.active };
  }
}
