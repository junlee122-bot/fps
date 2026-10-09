/**
 * src/ai/death.js — `actor:death` → PBD 래그돌 배선 (P4B 설계서 §6-4 ②).
 *
 * 시뮬 파일. import 0 — 버스·액터 시뮬·래그돌은 전부 주입이다(결정 #14, ARCHITECTURE §3).
 * `bus.markBoot()` 전에 설치해야 resetState 의 `bus.resetToBoot()` 가 구독을 남긴다(main.js 배선은 단계 9a).
 *
 * 발행 어휘는 그대로 `{actorId: 'a' + slot, impulseWorldPos, impulse}`(events.js `actor:death`).
 * `{rigKey, massKg} = actors.ragdollSeed(slot, pos, vel)` — rigKey 는 **외견** 시각 리그, massKg 는 **진짜** 값
 * (재검토 #10). 래그돌은 그 둘을 그대로 `activate` 에 넘긴다.
 */

const PARTICLE_FLOATS = 16 * 3;

/**
 * @param deps { bus, actors: { ragdollSeed(slot, outPos, outVel) → {rigKey, massKg} }, ragdoll: RagdollWorld }
 * @returns 구독 해제 함수
 */
export function installDeathWiring({ bus, actors, ragdoll }) {
  if (!bus || !actors || !ragdoll) throw new Error('installDeathWiring: bus, actors and ragdoll are required');
  // 부팅 할당 — 사망 경로는 할당하지 않는다
  const pos = new Float64Array(PARTICLE_FLOATS);
  const vel = new Float64Array(3);
  return bus.on('actor:death', (e) => {
    const id = e?.actorId;
    if (typeof id !== 'string' || !/^a\d+$/.test(id)) throw new Error(`actor:death: bad actorId ${id}`);
    const slot = Number(id.slice(1));
    pos.fill(0); vel.fill(0);
    const { rigKey, massKg } = actors.ragdollSeed(slot, pos, vel);
    ragdoll.activate(slot, rigKey, massKg, pos, vel, e.impulseWorldPos ?? null, e.impulse ?? null);
  });
}
