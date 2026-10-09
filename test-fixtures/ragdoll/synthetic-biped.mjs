/**
 * test-fixtures/ragdoll/synthetic-biped.mjs — 합성 래그돌 템플릿 (P4B 단계 5 개발용, 제품 데이터 아님).
 *
 * 설계서 §13 단계 5: "합성 템플릿으로 먼저 개발"하고 3a 의 `biped.js` 로 바꿔 끼운다.
 * `test/` 밖에 둔다 — `node --test` 는 `test/` 아래 모든 .js/.mjs 를 테스트로 실행한다(HANDOFF §4-3).
 * 수치(질량 분율·반지름·관절 각)는 이 합성 템플릿의 데이터일 뿐 게이트 임계가 아니다.
 *
 * 입자: 0 골반 1 가슴 2 목 3 머리 · 4–6 왼 어깨·팔꿈치·손 · 7–9 오른 어깨·팔꿈치·손 · 10–12 왼 엉덩·무릎·발 · 13–15 오른 엉덩·무릎·발
 * 기준 자세: 원점 = 두 발 가운데 바닥, +z 를 본다(왼쪽 = +x).
 */

const deg = (d) => (d * Math.PI) / 180;

export const PARENT = [-1, 0, 1, 2, 1, 4, 5, 1, 7, 8, 0, 10, 11, 0, 13, 14];

const REST = [
  [0, 0.95, 0], [0, 1.35, 0], [0, 1.5, 0], [0, 1.68, 0],
  [0.2, 1.42, 0], [0.2, 1.15, 0], [0.2, 0.9, 0],
  [-0.2, 1.42, 0], [-0.2, 1.15, 0], [-0.2, 0.9, 0],
  [0.1, 0.92, 0], [0.1, 0.5, 0], [0.1, 0.08, 0],
  [-0.1, 0.92, 0], [-0.1, 0.5, 0], [-0.1, 0.08, 0],
];

/** 오른팔을 정면 수평으로 뻗은 자세(판 앞 사망 시험용) */
const REACH = REST.map((p) => p.slice());
REACH[8] = [-0.2, 1.42, 0.27];
REACH[9] = [-0.2, 1.42, 0.52];

const RODS = [];
for (let i = 1; i < 16; i++) RODS.push(PARENT[i], i);

function templateFrom({ massFrac, radius }) {
  const rodRadius = [];
  for (let r = 0; r < 15; r++) rodRadius.push(Math.min(radius[RODS[r * 2]], radius[RODS[r * 2 + 1]]));
  return {
    parent: PARENT,
    massFrac,
    radius,
    rods: RODS,
    rodRadius,
    braces: [4, 7, 10, 13, 4, 10, 7, 13, 4, 13, 7, 10],
    limits: [
      0, 1, 2, 1, 2, 3,
      1, 4, 5, 1, 7, 8,
      4, 5, 6, 7, 8, 9,
      0, 10, 11, 0, 13, 14,
      10, 11, 12, 13, 14, 15,
    ],
    limitAngle: [
      deg(140), deg(180), deg(120), deg(180),
      deg(20), deg(175), deg(20), deg(175),
      deg(30), deg(180), deg(30), deg(180),
      deg(60), deg(175), deg(60), deg(175),
      deg(35), deg(180), deg(35), deg(180),
    ].map((v) => Math.min(v, Math.PI)),
    // [a, j, c, upFrom, upTo, left, right, sign] — 무릎은 앞(+), 팔꿈치는 뒤(−)
    hinges: [
      10, 11, 12, 0, 1, 10, 13, 1,
      13, 14, 15, 0, 1, 10, 13, 1,
      4, 5, 6, 0, 1, 4, 7, -1,
      7, 8, 9, 0, 1, 4, 7, -1,
    ],
  };
}

/** 합성 템플릿 A (사람 비례) */
export const SYNTH_A = templateFrom({
  massFrac: [0.2, 0.25, 0.03, 0.07, 0.03, 0.025, 0.015, 0.03, 0.025, 0.015, 0.03, 0.07, 0.055, 0.03, 0.07, 0.055],
  radius: [0.12, 0.14, 0.06, 0.11, 0.06, 0.05, 0.045, 0.06, 0.05, 0.045, 0.08, 0.06, 0.05, 0.08, 0.06, 0.05],
});

/** 합성 템플릿 B (다른 외견 리그 — 머리·상체가 무거운 분포). 총질량 시험용 */
const rawB = [0.14, 0.3, 0.04, 0.12, 0.035, 0.03, 0.02, 0.035, 0.03, 0.02, 0.025, 0.05, 0.035, 0.025, 0.05, 0.035];
const sumB = rawB.reduce((a, b) => a + b, 0);
export const SYNTH_B = templateFrom({
  massFrac: rawB.map((v, i) => (i === 0 ? v + (1 - sumB) : v)),
  radius: [0.14, 0.16, 0.07, 0.13, 0.07, 0.06, 0.05, 0.07, 0.06, 0.05, 0.09, 0.07, 0.06, 0.09, 0.07, 0.06],
});

/**
 * 기준 자세를 월드에 놓은 관절 원점(Float64Array 48).
 * yaw: 정면 = (sin yaw, 0, cos yaw).
 */
export function posePositions({ x = 0, y = 0, z = 0, yaw = 0, reach = false } = {}) {
  const src = reach ? REACH : REST;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const out = new Float64Array(48);
  for (let i = 0; i < 16; i++) {
    const [px, py, pz] = src[i];
    out[i * 3] = x + px * c + pz * s;
    out[i * 3 + 1] = y + py;
    out[i * 3 + 2] = z - px * s + pz * c;
  }
  return out;
}
