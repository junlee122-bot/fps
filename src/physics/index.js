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
}
