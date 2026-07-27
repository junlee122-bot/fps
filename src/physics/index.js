/**
 * src/physics/index.js — 물리 파사드 (P0 범위).
 *
 * 정적 BVH 월드 + 임펄스 강체 월드 + 캐릭터 컨트롤러 팩토리.
 * P2에서 다층 관통(core/surfaces.js computePenetration 배선)이 추가된다.
 */

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

  addRigidBody(opts) {
    return this.rigid.add(new RigidBody(opts));
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
}
