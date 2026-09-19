/**
 * src/materials/hanji-occluders.js — 창호지 점광 투과의 해석적 캡슐 차폐 (PATCH-008-B).
 *
 * 야간 실루엣은 "인물이 실내 광원을 가리는" 현상이다(주간 그림자 실루엣과 다른 기전 — CONTRACT-NOTES 008-C). 점광은 그림자맵이 없으므로
 * (castShadow=false, 순열·비용 고정) 판 셰이더가 **등록된 캡슐**(더미·적)에 대해 판 프래그먼트→점광 선분과 캡슐 축의 최근접 거리로 차폐를
 * 해석적으로 계산한다. 유니폼만 쓰므로 프로그램 순열 불변, 텍스처 샘플 없음(결정성). 등록되지 않은 물체는 점광을 가리지 않는다(설계 한계 — 기록).
 * 캡슐은 월드 좌표로 등록하고 프레임마다 뷰 공간으로 변환한다(점광 위치도 뷰 공간 — three pointLights 규약). 최대 HANJI_OCC_MAX 개.
 */

import * as THREE from 'three';

export const HANJI_OCC_MAX = 4;

const _v = new THREE.Vector3();

export class HanjiOccluders {
  constructor(max = HANJI_OCC_MAX) {
    this.max = max;
    this.items = new Map(); // id → { a: Vector3, b: Vector3, r }
    this.a = Array.from({ length: max }, () => new THREE.Vector4(0, 0, 0, 0));
    this.b = Array.from({ length: max }, () => new THREE.Vector4(0, 0, 0, 0));
    /** 공유 유니폼 객체 — 전 HANJI 재질(원본·판별 클론)이 같은 객체를 참조한다 (프레임당 1회 갱신) */
    this.uA = { value: this.a };
    this.uB = { value: this.b };
    this.uCount = { value: 0 };
  }

  /** 월드 좌표 캡슐 등록 (a·b 축 끝점, r 반지름) */
  set(id, { a, b, r }) {
    this.items.set(id, { a: a.clone(), b: b.clone(), r });
    return this;
  }

  /** CapsuleGeometry 메시(radius·height 파라미터, 축 = 로컬 y)에서 등록 — 이동 후 재호출 */
  setFromMesh(id, mesh) {
    const p = mesh.geometry?.parameters ?? {};
    const r = p.radius ?? 0.3, h = p.height ?? 1.0; // three CapsuleGeometry: height = 중간 원통 길이
    mesh.updateMatrixWorld(true);
    const a = mesh.localToWorld(new THREE.Vector3(0, -h / 2, 0));
    const b = mesh.localToWorld(new THREE.Vector3(0, h / 2, 0));
    return this.set(id, { a, b, r: r * Math.max(mesh.scale.x, mesh.scale.z) });
  }

  delete(id) { this.items.delete(id); }

  /** 프레임당 1회 — 뷰 행렬(camera.matrixWorldInverse)로 변환해 유니폼 갱신 */
  update(viewMatrix) {
    let i = 0;
    for (const it of this.items.values()) {
      if (i >= this.max) break;
      _v.copy(it.a).applyMatrix4(viewMatrix); this.a[i].set(_v.x, _v.y, _v.z, it.r);
      _v.copy(it.b).applyMatrix4(viewMatrix); this.b[i].set(_v.x, _v.y, _v.z, 0);
      i++;
    }
    this.uCount.value = i;
  }
}
