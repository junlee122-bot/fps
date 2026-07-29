/**
 * src/physics/index.js — 물리 파사드 (P0 범위).
 *
 * 정적 BVH 월드 + 임펄스 강체 월드 + 캐릭터 컨트롤러 팩토리.
 * P2에서 다층 관통(core/surfaces.js computePenetration 배선)이 추가된다.
 */

import * as THREE from 'three';
import { StaticWorld } from './bvh.js';
import { RigidBody, RigidBodyWorld } from './rigidbody.js';
import { CharacterController } from './character.js';
import { makeHitRecord } from './math.js';
import { MASK, LAYER, surfaceName, surfaceIndex, surfaceDef } from './surface-registry.js';

export { RigidBody, CharacterController, MASK, LAYER, surfaceName, surfaceIndex, surfaceDef, makeHitRecord };

export class PhysicsWorld {
  constructor() {
    this.static = new StaticWorld();
    this.rigid = new RigidBodyWorld(this.static);
    this._hit = makeHitRecord();
  }

  /**
   * 레이어 비트 노출 — world 등 소비자는 physics를 import하지 않고
   * 주입받은 파사드의 이 게터를 쓴다 (ARCHITECTURE §3 직접 import 금지).
   */
  get layers() {
    return LAYER;
  }

  /** 월드 지오메트리 등록. 표면 태그 필수 (bakeMesh가 강제) */
  addStaticMesh(mesh, surface, mask = LAYER.STATIC) {
    return this.static.addMesh(mesh, surface, mask);
  }

  /** 등록 완료 후 1회 — BVH 빌드 */
  build() {
    this.static.build();
    return { tris: this.static.triCount, nodes: this.static.nodeCount, buildMs: this.static.buildMs };
  }

  createCharacter(opts) {
    return new CharacterController(this.static, opts);
  }

  /**
   * 강체 추가. 표면 태그 필수 — 이름('WOOD_PLANK') 또는 인덱스.
   * 기본값에 기대면 인덱스 0(HANJI)으로 조용히 오태깅된다 (감사 발견 #5).
   */
  addRigidBody(opts) {
    if (opts.surface === undefined || opts.surface === null) {
      throw new Error('addRigidBody: surface tag is required');
    }
    return this.rigid.add(new RigidBody({ ...opts, surface: surfaceIndex(opts.surface) }));
  }

  /** 부팅 로스터 스냅샷 — 부팅 완료 시 1회 (감사 A1) */
  markBootBodies() {
    this._bootBodies = new Set(this.rigid.bodies);
  }

  /**
   * 부팅 로스터 밖 강체(런타임 스폰: P2 파편·탄피 등)를 전부 제거하고
   * 표시 메시도 씬에서 뗀다. resetState 경로 전용 (감사 A1 — 이게 없으면
   * 페이지 재사용 캡처에서 이전 세션 강체가 다음 캡처 픽셀에 유입된다).
   */
  pruneRuntimeBodies() {
    if (!this._bootBodies) return 0;
    let removed = 0;
    for (const b of this.rigid.bodies.slice()) {
      if (this._bootBodies.has(b)) continue;
      this.rigid.remove(b);
      b.object3D?.parent?.remove(b.object3D);
      removed++;
    }
    return removed;
  }

  /** 고정 스텝. 강체 적분 + 접촉 해석 + 표시 오브젝트 동기화 */
  step(dt) {
    this.rigid.step(dt);
    const bodies = this.rigid.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.object3D && !b.sleeping) {
        b.object3D.position.copy(b.position);
        b.object3D.quaternion.copy(b.quaternion);
      }
    }
  }

  /** 최근접 히트 레이캐스트. 히트 시 공유 히트 레코드 반환(다음 질의까지 유효) */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 200, mask = MASK.BULLET) {
    return this.static.raycast(ox, oy, oz, dx, dy, dz, maxDist, mask, this._hit) ? this._hit : null;
  }

  raycastAny(ox, oy, oz, dx, dy, dz, maxDist, mask = MASK.BULLET) {
    return this.static.raycastAny(ox, oy, oz, dx, dy, dz, maxDist, mask);
  }

  /**
   * 동적 강체 레이 질의 (P2B §8 — 탄자→강체 임펄스의 근거).
   * 박스 강체를 로컬 슬랩 테스트로 검사해 진입/출구 t와 진입면 노멀을 준다.
   * 반환은 tEnter 오름차순 — 순서 결정적 (bodies 배열 순회 + 정렬 키 고정).
   */
  raycastBodies(ox, oy, oz, dx, dy, dz, maxDist = 120) {
    const hits = [];
    const o = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion();
    for (const b of this.rigid.bodies) {
      if (b.shape !== 'box') continue;
      // 레이를 강체 로컬로
      q.copy(b.quaternion).invert();
      o.set(ox - b.position.x, oy - b.position.y, oz - b.position.z).applyQuaternion(q);
      d.set(dx, dy, dz).applyQuaternion(q);
      let tMin = 0, tMax = maxDist;
      let nAxis = -1, nSign = 1;
      let ok = true;
      const he = [b.hx, b.hy, b.hz];
      const oc = [o.x, o.y, o.z], dc = [d.x, d.y, d.z];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dc[a]) < 1e-9) {
          if (Math.abs(oc[a]) > he[a]) { ok = false; break; }
          continue;
        }
        const inv = 1 / dc[a];
        let t1 = (-he[a] - oc[a]) * inv;
        let t2 = (he[a] - oc[a]) * inv;
        let sign = -1; // t1이 -면(음의 면) 진입이면 노멀은 -축
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
        if (t1 > tMin) { tMin = t1; nAxis = a; nSign = sign; }
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) { ok = false; break; }
      }
      if (!ok || tMin <= 0 || tMin >= maxDist) continue;
      // 진입면 노멀 (로컬 → 월드)
      const n = new THREE.Vector3();
      if (nAxis >= 0) n.setComponent(nAxis, nSign);
      else n.set(0, 1, 0);
      n.applyQuaternion(b.quaternion);
      // 노멀은 입사 반대 방향으로 (BVH raycast 규약과 동일)
      if (n.x * dx + n.y * dy + n.z * dz > 0) n.multiplyScalar(-1);
      hits.push({
        body: b,
        tEnter: tMin,
        tExit: Math.min(tMax, maxDist),
        nx: n.x, ny: n.y, nz: n.z,
        surface: b.surface,
        surfaceName: surfaceName(b.surface),
      });
    }
    hits.sort((a, c) => a.tEnter - c.tEnter);
    return hits;
  }
}
