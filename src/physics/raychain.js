/**
 * src/physics/raychain.js — 탄도 레이 → 관통 레이어 체인 수집 (P2A §4-1 / P2B 강화).
 *
 * 레이를 히트마다 전진시키며 각 표면의 **지오메트리 실측 두께**를 산출한다.
 *
 * [P2B 정정] 진입/출구 판정은 삼각형 와인딩(frontFace)을 쓰지 않는다 —
 * 파라메트릭 셸의 거울 대칭면(합각하부면·경사면 일부)에서 와인딩이 뒤집혀
 * 있어(렌더는 양면이라 무해) frontFace 기반 페어링이 "진입 없는 출구"를
 * 만들고, 그 폴백이 수십 m를 재질로 오기입했다. 대신 **오브젝트별 교차
 * 패리티**를 쓴다: 닫힌 볼륨을 지나는 레이의 교차 횟수는 짝수이고(조르당),
 * 홀수 번째 교차 = 진입, 짝수 번째 = 출구다. 와인딩과 무관하게 정확하다.
 *
 * 규칙:
 *  - 오브젝트 교차 쌍이 재질 구간을 만들고, 같은 표면의 겹침 구간(결구 등
 *    상호 관입 부재)은 표면별 열림 카운트로 합집합 처리한다.
 *  - 표면 카운트가 0으로 닫힐 때마다 레이어 1개가 확정된다. 같은 표면이
 *    나중에 다시 나타나면 새 레이어다 (창호지 앞뒷면 = 2레이어 계약).
 *  - BLOCK 오브젝트는 첫 교차(진입)에서 체인이 끝난다.
 *  - 레이가 열린 구간 안에서 끝나면 그 지점까지를 두께로 닫는다.
 *  - 미매핑 표면은 BVH 등록 단계에서 이미 throw (PATCH-001-D).
 *
 * 한계(정직): 레이 원점이 부재 내부인 경우 패리티가 반 주기 어긋나
 * 그 부재의 첫 구간 두께가 다음 교차까지로 계산된다 — 총구가 벽 속에
 * 있는 퇴화 상황에 한정되며, 구간은 해당 부재 스케일로 유계다.
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
  /** objectId → { entryT, entry, normal } — 교차 패리티 (홀수 번째 = 진입) */
  const objOpen = new Map();
  /** surfaceIdx → { depth, entryT, objectId, objectName, entry, normal } — 합집합 */
  const surfOpen = new Map();
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

  /** 오브젝트 재질 구간 진입 → 표면 열림 카운트 반영 */
  const surfEnter = (sIdx, t, objectId, objectName, entry, normal) => {
    const o = surfOpen.get(sIdx);
    if (!o) {
      surfOpen.set(sIdx, { depth: 1, entryT: t, objectId, objectName, entry, normal });
    } else {
      o.depth++;
    }
  };
  /** 오브젝트 재질 구간 출구 → 카운트 0이면 레이어 확정 */
  const surfExit = (sIdx, t) => {
    const o = surfOpen.get(sIdx);
    if (!o) return; // 시점 내부 퇴화 케이스 — 열림 없이 출구
    if (--o.depth === 0) {
      closeLayer(sIdx, o, t);
      surfOpen.delete(sIdx);
    }
  };

  /** 교차 1건 처리 (패리티). 반환 true = BLOCK 진입 — 체인 종료 */
  const processCrossing = (h, t) => {
    const sIdx = h.surface;
    const def = surfaceDef(sIdx);
    const objName = staticWorld.objects[h.object]?.name ?? '(unknown)';
    const open = objOpen.get(h.object);
    if (!open) {
      // 홀수 번째 교차 — 진입 (와인딩 무관)
      if (def.penClass === PenClass.BLOCK) {
        for (const [k, so] of surfOpen) closeLayer(k, so, t);
        surfOpen.clear();
        layers.push({
          surface: surfaceName(sIdx),
          thicknessCm: 0, // BLOCK은 두께 무관 — 함수가 진입 즉시 정지
          entryT: t, exitT: t,
          objectId: h.object, objectName: objName,
          entry: [h.px, h.py, h.pz],
          normal: [h.nx, h.ny, h.nz],
        });
        blocked = true;
        endT = t;
        return true;
      }
      objOpen.set(h.object, { entryT: t });
      surfEnter(sIdx, t, h.object, objName, [h.px, h.py, h.pz], [h.nx, h.ny, h.nz]);
    } else {
      // 짝수 번째 교차 — 출구
      objOpen.delete(h.object);
      surfExit(sIdx, t);
    }
    return false;
  };

  const hit2 = makeHitRecord();
  /** 공면 허용 창 — 이보다 가까운 서로 다른 오브젝트의 면은 같은 지점으로 본다 */
  const COINCIDENT_EPS = 2e-4;

  for (let n = 0; n < MAX_HITS; n++) {
    if (t0 >= maxDist) break;
    const ok = staticWorld.raycast(
      ox + dx * t0, oy + dy * t0, oz + dz * t0,
      dx, dy, dz, maxDist - t0, mask, hit
    );
    if (!ok) break;
    const t = t0 + hit.t;
    if (processCrossing(hit, t)) break;

    // [P2B] 공면 스윕: 지붕 기와 하면 = 보토 상면처럼 **정확히 겹친 면**은
    // 전진 EPS에 함께 건너뛰어져 패리티가 어긋난다(보토 5.8m 오기입 실측).
    // 방금 맞힌 오브젝트를 제외하고 같은 창(2e-4m) 안의 면을 한 번 더 처리한다.
    let advance = t;
    const ok2 = staticWorld.raycast(
      ox + dx * t0, oy + dy * t0, oz + dz * t0,
      dx, dy, dz, Math.min(maxDist - t0, hit.t + COINCIDENT_EPS), mask, hit2, hit.object
    );
    if (ok2 && hit2.t <= hit.t + COINCIDENT_EPS) {
      const t2 = t0 + hit2.t;
      if (processCrossing(hit2, t2)) break;
      advance = Math.max(advance, t2);
    }

    t0 = advance + EPS_ADVANCE;
  }

  // 최대 사거리(또는 히트 소진)에서 열린 채 끝난 표면 — 그 지점까지 두께 인정
  for (const [k, so] of surfOpen) closeLayer(k, so, Math.min(t0, maxDist));

  layers.sort((a, b) => a.entryT - b.entryT);
  return { layers, blocked, endT };
}
