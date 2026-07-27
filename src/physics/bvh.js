/**
 * 정적 월드: 삼각형 수프 + binned-SAH BVH.
 *
 * 참조 레포(Claude of Duty)의 검증된 구현을 이식. 변경점:
 *  - 표면 매핑을 동결 계약 어댑터(surface-registry.js)로 교체
 *  - 표면 추정(guessSurface) 제거 — 표면 타입은 게임플레이 계약이므로
 *    명시되지 않으면 즉시 throw (조용한 오태깅이 관통 버그가 된다)
 *  - 빌드 시간 계측을 core/clock 경유로 (단일 시간 소스 규칙)
 *
 * 레이아웃
 *   pos      Float32Array, 삼각형당 9 float (a.xyz b.xyz c.xyz), 월드 공간
 *   nrm      Float32Array, 삼각형당 3 float (단위 기하 노멀)
 *   surface  Uint8Array,   삼각형당 표면 enum 인덱스
 *   mask     Uint16Array,  삼각형당 충돌 레이어 비트
 *   object   Int32Array,   삼각형당 소유 오브젝트 id
 *
 * 노드
 *   nodeBounds Float32Array, 노드당 6
 *   nodeMeta   Int32Array,   노드당 2 — [leftFirst, count]
 *                            count > 0 : 리프, triIndex[leftFirst .. +count)
 *                            count = 0 : 내부, 자식은 leftFirst, +1
 */

import * as THREE from 'three';
import {
  rayAabb,
  rayTriangle,
  segTriangleClosest,
  makeClosest,
  EPS,
} from './math.js';
import { surfaceIndex, LAYER } from './surface-registry.js';
import { clock } from '../core/clock.js';

const BINS = 12;
const LEAF_SIZE = 6;
const TRAV_COST = 1.0;
const TRI_COST = 1.35;
/** 보존적 전진(conservative advancement) 허용 오차, m */
const CA_TOL = 1e-4;
const CA_ITERS = 48;

const _m4 = new THREE.Matrix4();

export class StaticWorld {
  constructor() {
    this.objects = []; // { id, name, mesh, surface, mask, tris, triCount, alive }
    this._freeIds = [];

    this.triCount = 0;
    this.pos = new Float32Array(0);
    this.nrm = new Float32Array(0);
    this.surface = new Uint8Array(0);
    this.mask = new Uint16Array(0);
    this.object = new Int32Array(0);

    this.triIndex = new Uint32Array(0);
    this.nodeBounds = new Float32Array(0);
    this.nodeMeta = new Int32Array(0);
    this.nodeCount = 0;
    this.maxDepth = 0;

    this.dirty = false;
    this.buildMs = 0;
    this.version = 0;

    // scratch
    this._cent = new Float32Array(0);
    this._taabb = new Float32Array(0);
    this._stackNode = new Int32Array(128);
    this._stackT = new Float32Array(128);
    this._buildStack = new Int32Array(3 * 4096);
    this._cl = makeClosest();
    this._cl2 = makeClosest();
    this._cand = new Int32Array(4096);
    this._candCount = 0;

    // 오버랩 질의가 공유하는 접촉 버퍼
    this.contacts = {
      count: 0,
      capacity: 256,
      nx: new Float32Array(256),
      ny: new Float32Array(256),
      nz: new Float32Array(256),
      px: new Float32Array(256),
      py: new Float32Array(256),
      pz: new Float32Array(256),
      depth: new Float32Array(256),
      /** 질의 선분 위 파라미터 0..1 */
      s: new Float32Array(256),
      tri: new Int32Array(256),
    };

    this.aabb = { minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0 };
  }

  /* ---------------------------------------------------------------- */
  /* 등록                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 메시(또는 InstancedMesh)를 월드 공간 삼각형으로 굽는다.
   * 표면은 surfaceOverride 또는 mesh.userData.surface로 명시해야 한다.
   */
  addMesh(mesh, surface, mask = LAYER.STATIC, opts = {}) {
    if (!mesh) return -1;
    const baked = bakeMesh(mesh, surface ?? mesh.userData?.surface);
    if (!baked || baked.count === 0) return -1;

    const id = this._freeIds.length ? this._freeIds.pop() : this.objects.length;
    this.objects[id] = {
      id,
      name: mesh.name || mesh.type,
      mesh,
      surface: baked.uniformSurface,
      surfaces: baked.surfaces,
      mask,
      tris: baked.pos,
      triCount: baked.count,
      alive: true,
      userData: opts.userData ?? null,
    };
    this.dirty = true;
    return id;
  }

  /** 월드 공간 원시 삼각형 등록 (Float32Array, 9 float/tri) */
  addTriangles(positions, count, surface, mask = LAYER.STATIC, name = 'raw') {
    const id = this._freeIds.length ? this._freeIds.pop() : this.objects.length;
    const s = surfaceIndex(surface);
    const surfaces = new Uint8Array(count);
    surfaces.fill(s);
    this.objects[id] = {
      id, name, mesh: null, surface: s, surfaces, mask,
      tris: positions, triCount: count, alive: true, userData: null,
    };
    this.dirty = true;
    return id;
  }

  removeObject(id) {
    const o = this.objects[id];
    if (!o || !o.alive) return false;
    o.alive = false;
    o.tris = null;
    o.surfaces = null;
    this.objects[id] = null;
    this._freeIds.push(id);
    this.dirty = true;
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* 빌드                                                              */
  /* ---------------------------------------------------------------- */

  build() {
    const t0 = clock.wallNowMs();
    let total = 0;
    for (const o of this.objects) if (o && o.alive) total += o.triCount;

    if (total === 0) {
      this.triCount = 0;
      this.nodeCount = 0;
      this.dirty = false;
      this.version++;
      return;
    }

    if (this.pos.length < total * 9) {
      this.pos = new Float32Array(total * 9);
      this.nrm = new Float32Array(total * 3);
      this.surface = new Uint8Array(total);
      this.mask = new Uint16Array(total);
      this.object = new Int32Array(total);
      this.triIndex = new Uint32Array(total);
      this._cent = new Float32Array(total * 3);
      this._taabb = new Float32Array(total * 6);
      const maxNodes = 2 * total + 8;
      this.nodeBounds = new Float32Array(maxNodes * 6);
      this.nodeMeta = new Int32Array(maxNodes * 2);
    }

    const pos = this.pos;
    let w = 0;
    for (const o of this.objects) {
      if (!o || !o.alive) continue;
      pos.set(o.tris.subarray(0, o.triCount * 9), w * 9);
      for (let i = 0; i < o.triCount; i++) {
        this.surface[w + i] = o.surfaces ? o.surfaces[i] : o.surface;
        this.mask[w + i] = o.mask;
        this.object[w + i] = o.id;
      }
      w += o.triCount;
    }
    this.triCount = total;

    // 삼각형별 노멀, 센트로이드, 바운즈
    const cent = this._cent;
    const ta = this._taabb;
    const nrm = this.nrm;
    let gminx = Infinity, gminy = Infinity, gminz = Infinity;
    let gmaxx = -Infinity, gmaxy = -Infinity, gmaxz = -Infinity;
    for (let i = 0; i < total; i++) {
      const p = i * 9;
      const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
      const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5];
      const cx = pos[p + 6], cy = pos[p + 7], cz = pos[p + 8];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz);
      if (l > EPS) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
      nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;

      const mnx = Math.min(ax, bx, cx), mny = Math.min(ay, by, cy), mnz = Math.min(az, bz, cz);
      const mxx = Math.max(ax, bx, cx), mxy = Math.max(ay, by, cy), mxz = Math.max(az, bz, cz);
      const b = i * 6;
      ta[b] = mnx; ta[b + 1] = mny; ta[b + 2] = mnz;
      ta[b + 3] = mxx; ta[b + 4] = mxy; ta[b + 5] = mxz;
      cent[i * 3] = (mnx + mxx) * 0.5;
      cent[i * 3 + 1] = (mny + mxy) * 0.5;
      cent[i * 3 + 2] = (mnz + mxz) * 0.5;
      this.triIndex[i] = i;
      if (mnx < gminx) gminx = mnx;
      if (mny < gminy) gminy = mny;
      if (mnz < gminz) gminz = mnz;
      if (mxx > gmaxx) gmaxx = mxx;
      if (mxy > gmaxy) gmaxy = mxy;
      if (mxz > gmaxz) gmaxz = mxz;
    }
    this.aabb.minx = gminx; this.aabb.miny = gminy; this.aabb.minz = gminz;
    this.aabb.maxx = gmaxx; this.aabb.maxy = gmaxy; this.aabb.maxz = gmaxz;

    this._buildNodes(total);
    this.dirty = false;
    this.version++;
    this.buildMs = clock.wallNowMs() - t0;
  }

  _buildNodes(total) {
    const meta = this.nodeMeta;
    const bounds = this.nodeBounds;
    const idx = this.triIndex;
    const ta = this._taabb;
    const cent = this._cent;

    this.nodeCount = 1;
    meta[0] = 0;
    meta[1] = total;
    this._nodeBoundsFromRange(0, 0, total);

    const need = 4 * (2 * Math.ceil(total / LEAF_SIZE) + 64);
    if (this._buildStack.length < need) this._buildStack = new Int32Array(need);
    const stack = this._buildStack;
    let sp = 0;
    stack[sp++] = 0; stack[sp++] = 0; stack[sp++] = total; stack[sp++] = 0;

    const binCount = new Int32Array(BINS);
    const binB = new Float32Array(BINS * 6);
    const leftArea = new Float32Array(BINS);
    const leftCnt = new Int32Array(BINS);
    let maxDepth = 0;

    while (sp > 0) {
      const depth = stack[--sp];
      const count = stack[--sp];
      const start = stack[--sp];
      const node = stack[--sp];
      if (depth > maxDepth) maxDepth = depth;
      if (count <= LEAF_SIZE || depth > 60) continue;

      const nb = node * 6;
      let cminx = Infinity, cminy = Infinity, cminz = Infinity;
      let cmaxx = -Infinity, cmaxy = -Infinity, cmaxz = -Infinity;
      for (let i = start; i < start + count; i++) {
        const t = idx[i] * 3;
        const x = cent[t], y = cent[t + 1], z = cent[t + 2];
        if (x < cminx) cminx = x; if (x > cmaxx) cmaxx = x;
        if (y < cminy) cminy = y; if (y > cmaxy) cmaxy = y;
        if (z < cminz) cminz = z; if (z > cmaxz) cmaxz = z;
      }
      const ex = cmaxx - cminx, ey = cmaxy - cminy, ez = cmaxz - cminz;
      let axis = 0, extent = ex, cmin = cminx;
      if (ey > extent) { axis = 1; extent = ey; cmin = cminy; }
      if (ez > extent) { axis = 2; extent = ez; cmin = cminz; }
      if (extent < 1e-7) continue;

      const scale = BINS / extent;
      binCount.fill(0);
      for (let b = 0; b < BINS; b++) {
        const o = b * 6;
        binB[o] = binB[o + 1] = binB[o + 2] = Infinity;
        binB[o + 3] = binB[o + 4] = binB[o + 5] = -Infinity;
      }
      for (let i = start; i < start + count; i++) {
        const tri = idx[i];
        let b = ((cent[tri * 3 + axis] - cmin) * scale) | 0;
        if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
        binCount[b]++;
        const o = b * 6, tb = tri * 6;
        if (ta[tb] < binB[o]) binB[o] = ta[tb];
        if (ta[tb + 1] < binB[o + 1]) binB[o + 1] = ta[tb + 1];
        if (ta[tb + 2] < binB[o + 2]) binB[o + 2] = ta[tb + 2];
        if (ta[tb + 3] > binB[o + 3]) binB[o + 3] = ta[tb + 3];
        if (ta[tb + 4] > binB[o + 4]) binB[o + 4] = ta[tb + 4];
        if (ta[tb + 5] > binB[o + 5]) binB[o + 5] = ta[tb + 5];
      }

      // 좌측 스윕
      let axmin = Infinity, aymin = Infinity, azmin = Infinity;
      let axmax = -Infinity, aymax = -Infinity, azmax = -Infinity;
      let acc = 0;
      for (let b = 0; b < BINS - 1; b++) {
        const o = b * 6;
        if (binCount[b] > 0) {
          if (binB[o] < axmin) axmin = binB[o];
          if (binB[o + 1] < aymin) aymin = binB[o + 1];
          if (binB[o + 2] < azmin) azmin = binB[o + 2];
          if (binB[o + 3] > axmax) axmax = binB[o + 3];
          if (binB[o + 4] > aymax) aymax = binB[o + 4];
          if (binB[o + 5] > azmax) azmax = binB[o + 5];
        }
        acc += binCount[b];
        leftCnt[b] = acc;
        leftArea[b] = acc > 0 ? surfaceArea(axmin, aymin, azmin, axmax, aymax, azmax) : 0;
      }
      // 우측 스윕 + 선택
      axmin = aymin = azmin = Infinity;
      axmax = aymax = azmax = -Infinity;
      let rAcc = 0;
      let bestCost = TRI_COST * count;
      let bestSplit = -1;
      const parentArea = surfaceArea(
        bounds[nb], bounds[nb + 1], bounds[nb + 2],
        bounds[nb + 3], bounds[nb + 4], bounds[nb + 5]
      );
      const invParent = parentArea > 0 ? 1 / parentArea : 0;
      for (let b = BINS - 1; b > 0; b--) {
        const o = b * 6;
        if (binCount[b] > 0) {
          if (binB[o] < axmin) axmin = binB[o];
          if (binB[o + 1] < aymin) aymin = binB[o + 1];
          if (binB[o + 2] < azmin) azmin = binB[o + 2];
          if (binB[o + 3] > axmax) axmax = binB[o + 3];
          if (binB[o + 4] > aymax) aymax = binB[o + 4];
          if (binB[o + 5] > azmax) azmax = binB[o + 5];
        }
        rAcc += binCount[b];
        const lc = leftCnt[b - 1];
        if (lc === 0 || rAcc === 0) continue;
        const rArea = surfaceArea(axmin, aymin, azmin, axmax, aymax, azmax);
        const cost = TRAV_COST + TRI_COST * invParent * (leftArea[b - 1] * lc + rArea * rAcc);
        if (cost < bestCost) {
          bestCost = cost;
          bestSplit = b;
        }
      }
      if (bestSplit < 0) continue;

      const splitPos = cmin + extent * (bestSplit / BINS);
      let i = start, j = start + count - 1;
      while (i <= j) {
        const tri = idx[i];
        if (cent[tri * 3 + axis] < splitPos) i++;
        else { idx[i] = idx[j]; idx[j] = tri; j--; }
      }
      const leftCount = i - start;
      if (leftCount === 0 || leftCount === count) continue;

      const l = this.nodeCount;
      this.nodeCount += 2;
      meta[node * 2] = l;
      meta[node * 2 + 1] = 0;
      meta[l * 2] = start; meta[l * 2 + 1] = leftCount;
      meta[(l + 1) * 2] = i; meta[(l + 1) * 2 + 1] = count - leftCount;
      this._nodeBoundsFromRange(l, start, leftCount);
      this._nodeBoundsFromRange(l + 1, i, count - leftCount);

      stack[sp++] = l; stack[sp++] = start; stack[sp++] = leftCount; stack[sp++] = depth + 1;
      stack[sp++] = l + 1; stack[sp++] = i; stack[sp++] = count - leftCount; stack[sp++] = depth + 1;
    }
    this.maxDepth = maxDepth;
    const needStack = Math.max(64, maxDepth * 2 + 8);
    if (this._stackNode.length < needStack) {
      this._stackNode = new Int32Array(needStack);
      this._stackT = new Float32Array(needStack);
    }
  }

  _nodeBoundsFromRange(node, start, count) {
    const ta = this._taabb;
    const idx = this.triIndex;
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = start; i < start + count; i++) {
      const b = idx[i] * 6;
      if (ta[b] < mnx) mnx = ta[b];
      if (ta[b + 1] < mny) mny = ta[b + 1];
      if (ta[b + 2] < mnz) mnz = ta[b + 2];
      if (ta[b + 3] > mxx) mxx = ta[b + 3];
      if (ta[b + 4] > mxy) mxy = ta[b + 4];
      if (ta[b + 5] > mxz) mxz = ta[b + 5];
    }
    // Float32 저장이 경계를 안쪽으로 반올림할 수 있어 미세 패딩
    const p = 1e-5;
    const o = node * 6;
    this.nodeBounds[o] = mnx - p;
    this.nodeBounds[o + 1] = mny - p;
    this.nodeBounds[o + 2] = mnz - p;
    this.nodeBounds[o + 3] = mxx + p;
    this.nodeBounds[o + 4] = mxy + p;
    this.nodeBounds[o + 5] = mxz + p;
  }

  /* ---------------------------------------------------------------- */
  /* 질의                                                              */
  /* ---------------------------------------------------------------- */

  /** 최근접 히트 레이 질의. 양면 테스트 — 관통 계산이 배면 히트를 요구한다 */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask, out, ignoreObject = -1) {
    out.hit = false;
    if (this.nodeCount === 0 || this.triCount === 0) return false;
    const ix = 1 / (dx !== 0 ? dx : 1e-30);
    const iy = 1 / (dy !== 0 ? dy : 1e-30);
    const iz = 1 / (dz !== 0 ? dz : 1e-30);
    const nb = this.nodeBounds;
    const meta = this.nodeMeta;
    const idx = this.triIndex;
    const pos = this.pos;
    const stackNode = this._stackNode;
    const stackT = this._stackT;

    let best = maxDist;
    let bestTri = -1;
    let bestFront = true;

    if (rayAabb(ox, oy, oz, ix, iy, iz, nb[0], nb[1], nb[2], nb[3], nb[4], nb[5], best) === Infinity)
      return false;

    let sp = 0;
    stackNode[sp] = 0;
    stackT[sp] = 0;
    sp++;

    while (sp > 0) {
      sp--;
      if (stackT[sp] >= best) continue;
      let node = stackNode[sp];
      for (;;) {
        const count = meta[node * 2 + 1];
        if (count > 0) {
          const start = meta[node * 2];
          for (let i = start; i < start + count; i++) {
            const tri = idx[i];
            if ((this.mask[tri] & mask) === 0) continue;
            if (ignoreObject >= 0 && this.object[tri] === ignoreObject) continue;
            const p = tri * 9;
            const t = rayTriangle(
              ox, oy, oz, dx, dy, dz,
              pos[p], pos[p + 1], pos[p + 2],
              pos[p + 3], pos[p + 4], pos[p + 5],
              pos[p + 6], pos[p + 7], pos[p + 8],
              out
            );
            if (t >= 0 && t < best) {
              best = t;
              bestTri = tri;
              bestFront = out.frontFace;
            }
          }
          break;
        }
        const l = meta[node * 2];
        const r = l + 1;
        const lo = l * 6, ro = r * 6;
        const tl = rayAabb(ox, oy, oz, ix, iy, iz, nb[lo], nb[lo + 1], nb[lo + 2], nb[lo + 3], nb[lo + 4], nb[lo + 5], best);
        const tr = rayAabb(ox, oy, oz, ix, iy, iz, nb[ro], nb[ro + 1], nb[ro + 2], nb[ro + 3], nb[ro + 4], nb[ro + 5], best);
        if (tl === Infinity && tr === Infinity) break;
        if (tl <= tr) {
          if (tr !== Infinity) { stackNode[sp] = r; stackT[sp] = tr; sp++; }
          node = l;
        } else {
          if (tl !== Infinity) { stackNode[sp] = l; stackT[sp] = tl; sp++; }
          node = r;
        }
      }
    }

    if (bestTri < 0) return false;
    this._fillHit(out, bestTri, best, ox, oy, oz, dx, dy, dz);
    out.frontFace = bestFront;
    // 노멀은 항상 입사 반대 방향 — 반사·데칼이 바로 쓸 수 있게
    if (out.nx * dx + out.ny * dy + out.nz * dz > 0) {
      out.nx = -out.nx; out.ny = -out.ny; out.nz = -out.nz;
    }
    return true;
  }

  _fillHit(out, tri, t, ox, oy, oz, dx, dy, dz) {
    out.hit = true;
    out.t = t;
    out.px = ox + dx * t;
    out.py = oy + dy * t;
    out.pz = oz + dz * t;
    out.nx = this.nrm[tri * 3];
    out.ny = this.nrm[tri * 3 + 1];
    out.nz = this.nrm[tri * 3 + 2];
    out.tri = tri;
    out.surface = this.surface[tri];
    out.object = this.object[tri];
    out.body = null;
  }

  /** any-hit 가시성 레이. 정렬 없음, 첫 히트에서 종료 */
  raycastAny(ox, oy, oz, dx, dy, dz, maxDist, mask) {
    if (this.nodeCount === 0) return false;
    const ix = 1 / (dx !== 0 ? dx : 1e-30);
    const iy = 1 / (dy !== 0 ? dy : 1e-30);
    const iz = 1 / (dz !== 0 ? dz : 1e-30);
    const nb = this.nodeBounds;
    const meta = this.nodeMeta;
    const idx = this.triIndex;
    const pos = this.pos;
    const stack = this._stackNode;
    let sp = 0;
    if (rayAabb(ox, oy, oz, ix, iy, iz, nb[0], nb[1], nb[2], nb[3], nb[4], nb[5], maxDist) === Infinity)
      return false;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const count = meta[node * 2 + 1];
      if (count > 0) {
        const start = meta[node * 2];
        for (let i = start; i < start + count; i++) {
          const tri = idx[i];
          if ((this.mask[tri] & mask) === 0) continue;
          const p = tri * 9;
          const t = rayTriangle(
            ox, oy, oz, dx, dy, dz,
            pos[p], pos[p + 1], pos[p + 2],
            pos[p + 3], pos[p + 4], pos[p + 5],
            pos[p + 6], pos[p + 7], pos[p + 8],
            null
          );
          if (t >= 0 && t < maxDist) return true;
        }
        continue;
      }
      const l = meta[node * 2];
      const r = l + 1;
      const lo = l * 6, ro = r * 6;
      if (rayAabb(ox, oy, oz, ix, iy, iz, nb[lo], nb[lo + 1], nb[lo + 2], nb[lo + 3], nb[lo + 4], nb[lo + 5], maxDist) !== Infinity)
        stack[sp++] = l;
      if (rayAabb(ox, oy, oz, ix, iy, iz, nb[ro], nb[ro + 1], nb[ro + 2], nb[ro + 3], nb[ro + 4], nb[ro + 5], maxDist) !== Infinity)
        stack[sp++] = r;
    }
    return false;
  }

  /** 질의 박스와 AABB가 겹치는 삼각형 인덱스 수집 */
  queryAabb(minx, miny, minz, maxx, maxy, maxz, mask) {
    this._candCount = 0;
    if (this.nodeCount === 0) return 0;
    const nb = this.nodeBounds;
    const meta = this.nodeMeta;
    const idx = this.triIndex;
    const ta = this._taabb;
    const stack = this._stackNode;
    let sp = 0;
    if (nb[0] > maxx || nb[3] < minx || nb[1] > maxy || nb[4] < miny || nb[2] > maxz || nb[5] < minz)
      return 0;
    stack[sp++] = 0;
    let n = 0;
    let cand = this._cand;
    while (sp > 0) {
      const node = stack[--sp];
      const count = meta[node * 2 + 1];
      if (count > 0) {
        const start = meta[node * 2];
        for (let i = start; i < start + count; i++) {
          const tri = idx[i];
          if ((this.mask[tri] & mask) === 0) continue;
          const b = tri * 6;
          if (ta[b] > maxx || ta[b + 3] < minx) continue;
          if (ta[b + 1] > maxy || ta[b + 4] < miny) continue;
          if (ta[b + 2] > maxz || ta[b + 5] < minz) continue;
          if (n >= cand.length) {
            const bigger = new Int32Array(cand.length * 2);
            bigger.set(cand);
            this._cand = cand = bigger;
          }
          cand[n++] = tri;
        }
        continue;
      }
      const l = meta[node * 2];
      const r = l + 1;
      const lo = l * 6, ro = r * 6;
      const hitL = !(nb[lo] > maxx || nb[lo + 3] < minx || nb[lo + 1] > maxy || nb[lo + 4] < miny || nb[lo + 2] > maxz || nb[lo + 5] < minz);
      const hitR = !(nb[ro] > maxx || nb[ro + 3] < minx || nb[ro + 1] > maxy || nb[ro + 4] < miny || nb[ro + 2] > maxz || nb[ro + 5] < minz);
      if (hitL) stack[sp++] = l;
      if (hitR) stack[sp++] = r;
      if (sp >= stack.length - 2) break; // 스택은 트리 깊이 기준 — 실전에서 도달 안 함
    }
    this._candCount = n;
    return n;
  }

  get candidates() {
    return this._cand;
  }
  get candidateCount() {
    return this._candCount;
  }

  /**
   * 정적 월드에 대한 스윕 캡슐. 선형 이동 하의 선분/삼각형 거리 함수는
   * 볼록이므로 보존적 전진이 참 TOI를 준다 — 어떤 속도에서도 터널링 없음.
   */
  sweepCapsule(p0x, p0y, p0z, p1x, p1y, p1z, radius, dx, dy, dz, maxDist, mask, out) {
    out.hit = false;
    if (this.nodeCount === 0) return false;
    const ex = dx * maxDist, ey = dy * maxDist, ez = dz * maxDist;
    const r = radius + 0.002;
    const minx = Math.min(p0x, p1x, p0x + ex, p1x + ex) - r;
    const miny = Math.min(p0y, p1y, p0y + ey, p1y + ey) - r;
    const minz = Math.min(p0z, p1z, p0z + ez, p1z + ez) - r;
    const maxx = Math.max(p0x, p1x, p0x + ex, p1x + ex) + r;
    const maxy = Math.max(p0y, p1y, p0y + ey, p1y + ey) + r;
    const maxz = Math.max(p0z, p1z, p0z + ez, p1z + ez) + r;
    const n = this.queryAabb(minx, miny, minz, maxx, maxy, maxz, mask);
    if (n === 0) return false;

    const cand = this._cand;
    const pos = this.pos;
    const nrm = this.nrm;
    const cl = this._cl;
    let best = maxDist;
    let bestTri = -1;
    let bnx = 0, bny = 1, bnz = 0;
    let bpx = 0, bpy = 0, bpz = 0;

    for (let c = 0; c < n; c++) {
      const tri = cand[c];
      const p = tri * 9;
      const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
      const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5];
      const cx = pos[p + 6], cy = pos[p + 7], cz = pos[p + 8];

      // 평면-슬래브 프리필터: 축 위 부호 거리 최솟값이 t에 선형이므로
      // 내적 두 번으로 스윕 전체를 기각할 수 있다.
      const tnx = nrm[tri * 3], tny = nrm[tri * 3 + 1], tnz = nrm[tri * 3 + 2];
      const sdA = (p0x - ax) * tnx + (p0y - ay) * tny + (p0z - az) * tnz;
      const sdB = (p1x - ax) * tnx + (p1y - ay) * tny + (p1z - az) * tnz;
      const vd = (dx * tnx + dy * tny + dz * tnz) * best;
      const lo = Math.min(sdA, sdB) + Math.min(0, vd);
      const hi = Math.max(sdA, sdB) + Math.max(0, vd);
      if (lo > radius || hi < -radius) continue;

      let t = 0;
      let hitT = -1;
      for (let iter = 0; iter < CA_ITERS; iter++) {
        const ox = dx * t, oy = dy * t, oz = dz * t;
        segTriangleClosest(
          p0x + ox, p0y + oy, p0z + oz,
          p1x + ox, p1y + oy, p1z + oz,
          ax, ay, az, bx, by, bz, cx, cy, cz,
          cl
        );
        const dist = Math.sqrt(cl.d2) - radius;
        let sx = cl.bx - cl.ax, sy = cl.by - cl.ay, sz = cl.bz - cl.az;
        const sl = Math.hypot(sx, sy, sz);
        if (sl < 1e-12) { hitT = t; break; } // 축이 면을 관통
        sx /= sl; sy /= sl; sz /= sl;
        const closing = dx * sx + dy * sy + dz * sz;
        if (dist <= CA_TOL) {
          // 이미 접촉. *막는* 접촉만 히트로 취급 — 바닥에 서 있는 캡슐이
          // 그대로 미끄러질 수 있어야 컨트롤러가 멎지 않는다.
          if (closing > 1e-6) hitT = t;
          break;
        }
        if (closing <= 1e-7) break; // 볼록 거리 비감소 → 미스
        const step = dist / closing;
        t += step > 1e-7 ? step : 1e-7;
        if (t >= best) break;
      }
      if (hitT < 0 || hitT >= best) continue;

      // 충돌 시점 구성에서 접촉 노멀 복원
      const ox = dx * hitT, oy = dy * hitT, oz = dz * hitT;
      segTriangleClosest(
        p0x + ox, p0y + oy, p0z + oz,
        p1x + ox, p1y + oy, p1z + oz,
        ax, ay, az, bx, by, bz, cx, cy, cz,
        cl
      );
      let nx = cl.ax - cl.bx, ny = cl.ay - cl.by, nz = cl.az - cl.bz;
      const nl = Math.hypot(nx, ny, nz);
      if (nl > 1e-7) { nx /= nl; ny /= nl; nz /= nl; }
      else { nx = tnx; ny = tny; nz = tnz; }
      // 진행 방향과 같은 쪽 노멀은 반환하지 않는다
      if (nx * dx + ny * dy + nz * dz > 0) {
        if (tnx * dx + tny * dy + tnz * dz < 0) { nx = tnx; ny = tny; nz = tnz; }
        else { nx = -tnx; ny = -tny; nz = -tnz; }
      }
      best = hitT;
      bestTri = tri;
      bnx = nx; bny = ny; bnz = nz;
      bpx = cl.bx; bpy = cl.by; bpz = cl.bz;
    }

    if (bestTri < 0) return false;
    out.hit = true;
    out.t = best;
    out.px = bpx; out.py = bpy; out.pz = bpz;
    out.nx = bnx; out.ny = bny; out.nz = bnz;
    out.tri = bestTri;
    out.surface = this.surface[bestTri];
    out.object = this.object[bestTri];
    out.frontFace = true;
    out.body = null;
    return true;
  }

  /**
   * 정지 상태 캡슐의 침투 접촉 수집. `this.contacts`를 채운다
   * (공유 버퍼 — 다음 오버랩 질의까지만 유효). 노멀은 표면 밖, 캡슐 쪽.
   */
  overlapCapsule(p0x, p0y, p0z, p1x, p1y, p1z, radius, mask, margin = 0) {
    const cts = this.contacts;
    cts.count = 0;
    if (this.nodeCount === 0) return 0;
    const r = radius + margin;
    const n = this.queryAabb(
      Math.min(p0x, p1x) - r, Math.min(p0y, p1y) - r, Math.min(p0z, p1z) - r,
      Math.max(p0x, p1x) + r, Math.max(p0y, p1y) + r, Math.max(p0z, p1z) + r,
      mask
    );
    if (n === 0) return 0;
    const cand = this._cand;
    const pos = this.pos;
    const nrm = this.nrm;
    const cl = this._cl2;
    const r2 = r * r;
    let k = 0;
    for (let c = 0; c < n && k < cts.capacity; c++) {
      const tri = cand[c];
      const p = tri * 9;
      const d2 = segTriangleClosest(
        p0x, p0y, p0z, p1x, p1y, p1z,
        pos[p], pos[p + 1], pos[p + 2],
        pos[p + 3], pos[p + 4], pos[p + 5],
        pos[p + 6], pos[p + 7], pos[p + 8],
        cl
      );
      if (d2 >= r2) continue;
      const d = Math.sqrt(d2);
      let nx, ny, nz;
      if (d > 1e-6) {
        nx = (cl.ax - cl.bx) / d;
        ny = (cl.ay - cl.by) / d;
        nz = (cl.az - cl.bz) / d;
        // 깊은 접촉은 고체 안쪽을 향하는 노멀을 뽑을 수 있다 — 면 노멀로 폴백
        const fn = nx * nrm[tri * 3] + ny * nrm[tri * 3 + 1] + nz * nrm[tri * 3 + 2];
        if (fn < 0.05) {
          nx = nrm[tri * 3]; ny = nrm[tri * 3 + 1]; nz = nrm[tri * 3 + 2];
        }
      } else {
        nx = nrm[tri * 3]; ny = nrm[tri * 3 + 1]; nz = nrm[tri * 3 + 2];
      }
      cts.nx[k] = nx; cts.ny[k] = ny; cts.nz[k] = nz;
      cts.px[k] = cl.bx; cts.py[k] = cl.by; cts.pz[k] = cl.bz;
      cts.depth[k] = r - d;
      cts.s[k] = cl.s;
      cts.tri[k] = tri;
      k++;
    }
    cts.count = k;
    return k;
  }

  surfaceOf(tri) {
    return this.surface[tri] ?? 0;
  }

  objectOf(tri) {
    return this.objects[this.object[tri]] ?? null;
  }

  dispose() {
    this.objects.length = 0;
    this.pos = new Float32Array(0);
    this.nodeCount = 0;
    this.triCount = 0;
  }
}

function surfaceArea(minx, miny, minz, maxx, maxy, maxz) {
  const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz;
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  return 2 * (dx * dy + dy * dz + dz * dx);
}

/* ------------------------------------------------------------------ */
/* 메시 베이크                                                          */
/* ------------------------------------------------------------------ */

/**
 * Mesh / InstancedMesh를 월드 공간 삼각형으로 평탄화.
 * 표면 타입은 명시가 원칙 — surface 인자 또는 mesh.userData.surface.
 * 없으면 throw한다. 표면 오태깅은 조용한 관통 버그가 되기 때문이다.
 */
export function bakeMesh(mesh, surface) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes || !geo.attributes.position) return null;
  if (surface === undefined || surface === null) {
    throw new Error(`bakeMesh: mesh "${mesh.name || mesh.type}" has no surface tag`);
  }
  const baseSurface = surfaceIndex(surface);

  const posAttr = geo.attributes.position;
  const index = geo.index;
  const triPerInstance = ((index ? index.count : posAttr.count) / 3) | 0;
  if (triPerInstance === 0) return null;

  const isInstanced = mesh.isInstancedMesh === true && mesh.count > 0;
  const instances = isInstanced ? mesh.count : 1;
  const total = triPerInstance * instances;

  const out = new Float32Array(total * 9);
  const surfaces = new Uint8Array(total);
  surfaces.fill(baseSurface);

  mesh.updateWorldMatrix(true, false);

  const pos = posAttr.array;
  const stride = posAttr.itemSize;
  const idxArr = index ? index.array : null;

  for (let inst = 0; inst < instances; inst++) {
    if (isInstanced) {
      mesh.getMatrixAt(inst, _m4);
      _m4.premultiply(mesh.matrixWorld);
    } else {
      _m4.copy(mesh.matrixWorld);
    }
    const e = _m4.elements;
    const base = inst * triPerInstance;
    for (let t = 0; t < triPerInstance; t++) {
      const o = (base + t) * 9;
      for (let v = 0; v < 3; v++) {
        const vi = idxArr ? idxArr[t * 3 + v] : t * 3 + v;
        const px = pos[vi * stride];
        const py = pos[vi * stride + 1];
        const pz = pos[vi * stride + 2];
        out[o + v * 3] = e[0] * px + e[4] * py + e[8] * pz + e[12];
        out[o + v * 3 + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
        out[o + v * 3 + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
      }
    }
  }

  // 퇴화 삼각형(면적 0) 제거 — 노멀과 SAH 빈을 오염시킨다
  let w = 0;
  for (let t = 0; t < total; t++) {
    const p = t * 9;
    const e1x = out[p + 3] - out[p], e1y = out[p + 4] - out[p + 1], e1z = out[p + 5] - out[p + 2];
    const e2x = out[p + 6] - out[p], e2y = out[p + 7] - out[p + 1], e2z = out[p + 8] - out[p + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
    if (w !== t) {
      out.copyWithin(w * 9, p, p + 9);
      surfaces[w] = surfaces[t];
    }
    w++;
  }

  return { pos: out, count: w, surfaces, uniformSurface: baseSurface };
}
