/**
 * src/actors/data/geom.js — 데이터 묶음의 순수 기하 도우미(쿼터니언·오일러).
 *
 * three 를 쓰지 않는 시뮬 묶음(actors-data·actors-sim)과 three 무의존 meshgen 이 같은 규약을
 * 쓰도록 한 곳에 둔다. 규약: 쿼터니언은 xyzw, 행렬은 행 우선 3×3, 원시 `rotDeg` 는 three 의
 * Euler 기본 순서 'XYZ' 와 같은 R = Rx·Ry·Rz (원시 로컬 → 뼈 로컬).
 * 모든 함수는 out 인자에 쓰고 할당하지 않는다(매 프레임 경로에서 재사용 가능).
 */

const DEG = Math.PI / 180;

/** out[oi..] = a[ai..] ⊗ b[bi..] — out 이 a·b 와 같은 배열이어도 색인이 겹치지 않으면 안전 */
export function qmul(a, ai, b, bi, out, oi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[oi]     = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out[oi..oi+2] = q · v */
export function qrot(q, qi, v, vi, out, oi) {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const vx = v[vi], vy = v[vi + 1], vz = v[vi + 2];
  // t = 2 (q.xyz × v), v' = v + w t + q.xyz × t
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  out[oi]     = vx + w * tx + (y * tz - z * ty);
  out[oi + 1] = vy + w * ty + (z * tx - x * tz);
  out[oi + 2] = vz + w * tz + (x * ty - y * tx);
}

/** x축 회전 쿼터니언(도). 양의 각 = +y 를 +z 로 */
export function qAxisX(deg, out, oi) {
  const h = 0.5 * DEG * deg;
  out[oi] = Math.sin(h);
  out[oi + 1] = 0;
  out[oi + 2] = 0;
  out[oi + 3] = Math.cos(h);
}

/** 쿼터니언 → 행 우선 3×3 회전 행렬 */
export function quatToMat3(q, qi, out, oi) {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  out[oi]     = 1 - 2 * (yy + zz); out[oi + 1] = 2 * (xy - wz);     out[oi + 2] = 2 * (xz + wy);
  out[oi + 3] = 2 * (xy + wz);     out[oi + 4] = 1 - 2 * (xx + zz); out[oi + 5] = 2 * (yz - wx);
  out[oi + 6] = 2 * (xz - wy);     out[oi + 7] = 2 * (yz + wx);     out[oi + 8] = 1 - 2 * (xx + yy);
}

/** 오일러 'XYZ'(도) → 행 우선 3×3 회전 행렬 R = Rx·Ry·Rz (three Matrix4.makeRotationFromEuler 와 같은 식) */
export function eulerXYZToMat3(rotDeg, out, oi) {
  const a = rotDeg[0] * DEG, b = rotDeg[1] * DEG, c = rotDeg[2] * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  out[oi]     = cb * cc;                 out[oi + 1] = -cb * sc;                out[oi + 2] = sb;
  out[oi + 3] = ca * sc + sa * sb * cc;  out[oi + 4] = ca * cc - sa * sb * sc;  out[oi + 5] = -sa * cb;
  out[oi + 6] = sa * sc - ca * sb * cc;  out[oi + 7] = sa * cc + ca * sb * sc;  out[oi + 8] = ca * cb;
}

/** out = A·B (행 우선 3×3) — out 은 A·B 와 다른 배열(또는 겹치지 않는 구간) */
export function mat3mul(A, ai, B, bi, out, oi) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[oi + r * 3 + c] = A[ai + r * 3] * B[bi + c] + A[ai + r * 3 + 1] * B[bi + 3 + c] + A[ai + r * 3 + 2] * B[bi + 6 + c];
    }
  }
}
