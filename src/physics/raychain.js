/**
 * src/physics/raychain.js — 탄도 레이 → 관통 레이어 체인 수집 (P2A-BRIEF §4-1).
 *
 * 레이를 히트마다 전진시키며 진입(frontFace)/출구 쌍으로 각 표면의
 * **지오메트리 실측 두께**를 산출한다. 상수 두께 금지 조항의 구현부다.
 *
 * 규칙:
 *  - 같은 표면의 겹침 구간(결구 등 상호 관입 박스)은 열림 카운트로 합집합
 *    처리한다 — 겹친 두께를 이중 계산하지 않는다.
 *  - 카운트가 0으로 닫힐 때마다 레이어 1개가 확정된다. 같은 표면이 나중에
 *    다시 나타나면 새 레이어다 (창호지 앞뒷면 = 2레이어 계약).
 *  - BLOCK 표면 진입에서 체인이 끝난다 (computePenetration도 그 층에서 멈춘다).
 *  - 미매핑 표면은 BVH 등록 단계에서 이미 throw (PATCH-001-D) — 여기 도달한
 *    인덱스는 전부 유효하다.
 *  - 레이가 열린 표면 안에서 끝나면(최대 사거리) 그 지점까지를 두께로 닫는다.
 *
 * 전진 간격 EPS_ADVANCE는 0.1mm — 최박 부재(창호지 0.3mm)의 출구면을
 * 건너뛰지 않는 상한이다.
 */

import { makeHitRecord } from './math.js';
import { MASK, surfaceName, surfaceDef } from './surface-registry.js';
import { PenClass } from '../core/surfaces.js';

const EPS_ADVANCE = 1e-4; // m
const MAX_HITS = 96;      // 관아 전폭 횡단 상한의 2배 여유

/**
 * @returns {{
 *   layers: Array<{surface:string, thicknessCm:number, entryT:number, exitT:number,
 *                  objectId:number, objectName:string,
 *                  entry:[number,number,number], normal:[number,number,number]}>,
 *   blocked: boolean, endT: number
 * }}
 * layers는 진입 순서. thicknessCm은 레이 방향 실측(합집합) 두께 — cm.
 */
export function collectRayChain(staticWorld, ox, oy, oz, dx, dy, dz, maxDist = 120, mask = MASK.BULLET) {
  const hit = makeHitRecord();
  const layers = [];
  /** surfaceIdx → { depth, entryT, objectId, objectName, entry, normal } */
  const open = new Map();
  let t0 = 0;
  let blocked = false;
  let endT = maxDist;

  const closeLayer = (sIdx, o, exitT) => {
    layers.push({
      surface: surfaceName(sIdx),
      thicknessCm: (exitT - o.entryT) * 100,
      entryT: o.entryT,
      exitT,
      objectId: o.objectId,
      objectName: o.objectName,
      entry: o.entry,
      normal: o.normal,
    });
  };

  for (let n = 0; n < MAX_HITS; n++) {
    if (t0 >= maxDist) break;
    const ok = staticWorld.raycast(
      ox + dx * t0, oy + dy * t0, oz + dz * t0,
      dx, dy, dz, maxDist - t0, mask, hit
    );
    if (!ok) break;
    const t = t0 + hit.t;
    const sIdx = hit.surface;
    const def = surfaceDef(sIdx);
    const objName = staticWorld.objects[hit.object]?.name ?? '(unknown)';

    if (hit.frontFace) {
      // 진입
      if (def.penClass === PenClass.BLOCK) {
        // 차단 진입 — 열린 표면들을 이 지점까지로 닫고 체인 종료
        for (const [k, o] of open) closeLayer(k, o, t);
        open.clear();
        layers.push({
          surface: surfaceName(sIdx),
          thicknessCm: 0, // BLOCK은 두께 무관 — 함수가 진입 즉시 정지
          entryT: t, exitT: t,
          objectId: hit.object, objectName: objName,
          entry: [hit.px, hit.py, hit.pz],
          normal: [hit.nx, hit.ny, hit.nz],
        });
        blocked = true;
        endT = t;
        break;
      }
      const o = open.get(sIdx);
      if (!o) {
        open.set(sIdx, {
          depth: 1, entryT: t,
          objectId: hit.object, objectName: objName,
          entry: [hit.px, hit.py, hit.pz],
          normal: [hit.nx, hit.ny, hit.nz],
        });
      } else {
        o.depth++;
      }
    } else {
      // 출구
      const o = open.get(sIdx);
      if (!o) {
        // 진입 없이 출구 — 레이 시점이 부재 내부 (총구가 벽 안). t=0부터 두께 인정
        closeLayer(sIdx, {
          entryT: 0, objectId: hit.object, objectName: objName,
          entry: [ox, oy, oz], normal: [hit.nx, hit.ny, hit.nz],
        }, t);
      } else if (--o.depth === 0) {
        closeLayer(sIdx, o, t);
        open.delete(sIdx);
      }
    }
    t0 = t + EPS_ADVANCE;
  }

  // 최대 사거리에서 열린 채 끝난 표면 — 그 지점까지 두께 인정
  for (const [k, o] of open) closeLayer(k, o, Math.min(t0, maxDist));

  layers.sort((a, b) => a.entryT - b.entryT);
  return { layers, blocked, endT };
}
