/**
 * src/actors/sim/ragdoll-rig.js — 시각 리그 → 래그돌 템플릿 컴파일 (P4B 설계서 §6-2).
 *
 * 묶음 actors-sim. 허용 import 는 actors-data·actors-sim·src/core 뿐이다(§1-1). physics 는 actors 를 모르므로
 * 이 함수가 만든 순수 배열 템플릿을 main.js(단계 9a)·테스트가 `ragdoll.registerTemplate(rigId, …)` 로 넘긴다.
 * 출력 형식은 `src/physics/ragdoll.js` `compileRagdollTemplate` 의 입력 형식이다.
 *
 * 유도 규칙(§6-2):
 *   - 입자 16·막대 15·버팀대 6·거리 한계·경첩 = biped 템플릿 표(데이터 순서 그대로).
 *   - 질량 분율 = `massFractions(rig.ragdoll.massScale)`(합 1). 총질량은 활성화 때 진짜 massKg 가 정한다.
 *   - 반지름: 원시마다 rc `(ra + rb)/2`, el 최단 반축. 뼈의 반지름 = 그 뼈에 붙은 몸 원시(zone ≠ 'prop')
 *     반지름의 최솟값(구현 파라미터 — 걸림을 줄이는 보수 쪽). 입자 반지름 = 자기 뼈 반지름, 없으면 들어오는
 *     막대의 반지름. 막대 반지름 = 부모 입자 뼈의 반지름, 없으면 자식 입자 반지름. 둘 다 없으면 throw.
 *     (§6-2 "데이터로 덮어쓰기"는 스키마 v1 에 필드가 없어 아직 받지 않는다.)
 *   - 거리 한계: 템플릿 굽힘 각(0 = 곧게, 데이터 `ragdoll.limits` 가 덮어씀) → 관절 내각 θ = 180° − 굽힘.
 *   - 경첩 법선: 프레임 정면 = lateral × up(biped FRAMES) = cross(up, right − left).
 */

import { BIPED, massFractions } from '../data/skeletons/biped.js';

const DEG = Math.PI / 180;

/** 원시 하나의 래그돌 반지름(§6-2) */
export function primRagdollRadius(p) {
  return p.kind === 'rc' ? (p.ra + p.rb) / 2 : Math.min(p.r[0], p.r[1], p.r[2]);
}

/**
 * 시각 리그(`visualRigOf` 결과 또는 같은 필드를 가진 정의) → 래그돌 템플릿(순수 배열, 동결).
 * `tpl` 은 골격 템플릿(기본 BIPED). 리그 템플릿 이름이 다르면 throw.
 */
export function compileRagdollRig(rig, tpl = BIPED) {
  if (rig.skeleton.template !== tpl.name || rig.ragdoll.template !== tpl.name) {
    throw new Error(`compileRagdollRig: 리그 템플릿 '${rig.skeleton.template}'/'${rig.ragdoll.template}' ≠ '${tpl.name}'`);
  }
  const ps = tpl.ragdoll.particles;
  const idx = Object.create(null);
  ps.forEach((p, i) => { idx[p.name] = i; });
  const at = (name) => {
    const i = idx[name];
    if (i === undefined) throw new Error(`compileRagdollRig: 미지 입자 '${name}'`);
    return i;
  };

  // 뼈별 몸 원시 반지름(최솟값)
  const boneRadius = Object.create(null);
  for (const p of rig.shape.primitives) {
    if (p.zone === 'prop') continue;
    const r = primRagdollRadius(p);
    boneRadius[p.bone] = boneRadius[p.bone] === undefined ? r : Math.min(boneRadius[p.bone], r);
  }

  const parent = ps.map((p) => (p.parent === null ? -1 : at(p.parent)));
  const rods = [];
  for (let i = 0; i < ps.length; i++) if (parent[i] >= 0) rods.push(parent[i], i);

  const radius = new Array(ps.length);
  for (let i = 0; i < ps.length; i++) {
    const own = boneRadius[ps[i].bone];
    radius[i] = own !== undefined ? own : parent[i] >= 0 ? boneRadius[ps[parent[i]].bone] : undefined;
    if (!(radius[i] > 0)) throw new Error(`compileRagdollRig: '${rig.rigId ?? rig.id}' 입자 '${ps[i].name}' 의 반지름을 정할 몸 원시가 없다`);
  }
  const rodRadius = [];
  for (let r = 0; r < rods.length; r += 2) {
    const pr = boneRadius[ps[rods[r]].bone];
    rodRadius.push(pr !== undefined ? pr : radius[rods[r + 1]]);
  }

  const braces = [];
  for (const [a, b] of tpl.ragdoll.braces.pairs) braces.push(at(a), at(b));

  const over = rig.ragdoll.limits || {};
  const limits = [], limitAngle = [];
  for (const l of tpl.ragdoll.limits) {
    const bend = over[l.key] || l.bendDeg;
    limits.push(at(l.a), at(l.joint), at(l.c));
    limitAngle.push((180 - bend[1]) * DEG, (180 - bend[0]) * DEG);
  }

  const hinges = [];
  for (const h of tpl.ragdoll.hinges) {
    const f = tpl.ragdoll.frames[h.frame];
    if (!f) throw new Error(`compileRagdollRig: 미지 프레임 '${h.frame}'`);
    hinges.push(at(h.a), at(h.joint), at(h.c), at(f.up[0]), at(f.up[1]), at(f.lateral[1]), at(f.lateral[0]), h.sign);
  }

  return Object.freeze({
    parent: Object.freeze(parent),
    massFrac: Object.freeze(Array.from(massFractions(rig.ragdoll.massScale))),
    radius: Object.freeze(radius),
    rods: Object.freeze(rods),
    rodRadius: Object.freeze(rodRadius),
    braces: Object.freeze(braces),
    limits: Object.freeze(limits),
    limitAngle: Object.freeze(limitAngle),
    hinges: Object.freeze(hinges),
  });
}
