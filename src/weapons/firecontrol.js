/**
 * src/weapons/firecontrol.js — 발사 파이프라인 (P2A-BRIEF §4).
 *
 * 흐름: 무기 상태머신이 발사를 허가하면 → 산포 적용 레이 생성(펠릿별 독립) →
 * physics 체인 수집(지오메트리 실측 두께) → ballistics.penetrate(k 스케일) →
 * ARCHITECTURE §3 이벤트 발행. FX·오디오·데칼은 여기서 만들지 않는다 —
 * 이벤트만 발행하고 P2B가 구독한다.
 *
 * 크로스 서브시스템 규칙: physics 접근은 주입받은 collectChain 함수로만.
 * HANJI 상태(materials)도 직접 만지지 않는다 — surface:damage를 발행하면
 * main.js 배선이 materials로 전달한다.
 */

import { bus } from '../core/events.js';
import { SURFACES, PenClass } from '../core/surfaces.js';
import { Weapon, WEAPON_ORDER } from './weapon.js';
import { penetrate } from './ballistics.js';

/** 탄도 최대 사거리 (m) — 관아 대각 전장보다 길게 */
const MAX_RANGE = 120;

export class FireControl {
  /**
   * @param {(ox,oy,oz,dx,dy,dz,maxDist)=>{layers,blocked,endT}} collectChain
   *        physics 주입 — raychain.collectRayChain 바인딩
   */
  constructor(collectChain) {
    this.collectChain = collectChain;
    this.weapons = new Map(WEAPON_ORDER.map((id) => [id, new Weapon(id)]));
    this.currentId = WEAPON_ORDER[0];
    /** playtest·디버그용 누적 계수 — 게임 로직은 읽지 않는다 */
    this.counters = { fired: 0, pellets: 0, hits: 0, penetrations: 0, stops: 0 };
  }

  get current() {
    return this.weapons.get(this.currentId);
  }

  switchTo(id) {
    if (!this.weapons.has(id)) throw new Error(`unknown weapon: ${id}`);
    if (id === this.currentId) return;
    this.currentId = id;
    // 무기 교체는 ADS 해제 (블렌드는 새 무기에서 0부터)
    this.current.adsBlend = 0;
  }

  reset() {
    for (const w of this.weapons.values()) w.reset();
    this.currentId = WEAPON_ORDER[0];
    this.counters = { fired: 0, pellets: 0, hits: 0, penetrations: 0, stops: 0 };
  }

  /**
   * 고정 스텝 갱신. eye: {pos:[x,y,z], yaw, pitch} — 플레이어 눈 트랜스폼
   * (weapons는 player를 import하지 않는다 — 값 주입).
   */
  update(dt, input, eye) {
    const w = this.current;
    const wasReloading = w.reloading;
    const mayFire = w.update(dt, {
      trigger: input.fire,
      ads: input.ads,
      reload: input.reload,
    });

    if (!wasReloading && w.reloading) {
      bus.emit('weapon:reload:begin', { weaponId: w.id, durationMs: w.reloadDurationMs });
    } else if (wasReloading && !w.reloading) {
      bus.emit('weapon:reload:end', { weaponId: w.id });
    }

    if (mayFire) this.fire(eye);
  }

  /** 발사 1회 — 펠릿별 독립 관통 (§2-4: 9발을 뭉뚱그리지 않는다) */
  fire(eye) {
    const w = this.current;
    const offsets = w.commitFire();
    const muzzle = this.muzzleWorldPos(eye);
    this.counters.fired++;

    // weapon:fire는 격발 1회당 1건 — 펠릿별 이벤트는 ballistic:* 소관
    // (산탄 9펠릿에 총구화염 9개가 그려지는 것을 막는다)
    const cp0 = Math.cos(eye.pitch);
    bus.emit('weapon:fire', {
      weaponId: w.id,
      muzzleWorldPos: muzzle.slice(),
      dir: [-Math.sin(eye.yaw) * cp0, Math.sin(eye.pitch), -Math.cos(eye.yaw) * cp0],
      energy: w.params.energy,
    });

    for (const off of offsets) {
      const yaw = eye.yaw + off.dYaw;
      const pitch = eye.pitch + off.dPitch;
      const cp = Math.cos(pitch);
      // yaw=0 → -Z 전방 (player.js 이동 좌표계와 동일)
      const dx = -Math.sin(yaw) * cp;
      const dy = Math.sin(pitch);
      const dz = -Math.cos(yaw) * cp;

      this.tracePellet(w, muzzle, dx, dy, dz);
    }
  }

  /** 펠릿 1발의 체인 수집 → 관통 판정 → 이벤트 발행 */
  tracePellet(w, muzzle, dx, dy, dz) {
    const chain = this.collectChain(muzzle[0], muzzle[1], muzzle[2], dx, dy, dz, MAX_RANGE);
    if (chain.layers.length === 0) return null;

    const result = penetrate(w.params, w.params.energy, chain.layers);
    this.counters.pellets++;

    for (let i = 0; i < chain.layers.length; i++) {
      const L = chain.layers[i];
      const def = SURFACES[L.surface];
      const pathEntry = result.path.find((p) => p.layer === i);
      // DECAL은 관통 계산에서 스킵되지만 히트 이벤트는 남긴다 (박리 기록 — P2B 소비)
      const incident = this.incidentEnergyBefore(w, result, i);

      this.counters.hits++;
      bus.emit('ballistic:hit', {
        surfaceType: L.surface,
        worldPos: L.entry.slice(),
        normal: L.normal.slice(),
        incidentEnergy: incident,
        layerIndex: i,
      });
      bus.emit('audio:impact', {
        surfaceType: L.surface,
        worldPos: L.entry.slice(),
        energy: incident,
      });
      if (def.breachable || def.dynamicOpacity) {
        bus.emit('surface:damage', {
          surfaceId: L.objectName,
          surfaceType: L.surface,
          localUV: null, // 판 로컬 UV는 배선 소비자(hanji 어댑터)가 히트 좌표로 산출
          radius: 0.02,
          worldPos: L.entry.slice(), // 어댑터용 부가 정보
        });
      }

      if (result.stoppedAt === i) {
        this.counters.stops++;
        bus.emit('ballistic:stop', {
          surfaceType: L.surface,
          worldPos: L.entry.slice(),
          normal: L.normal.slice(),
        });
        break;
      }
      if (pathEntry && pathEntry.exited && def.penClass !== PenClass.DECAL) {
        const exitPos = [
          muzzle[0] + dx * L.exitT,
          muzzle[1] + dy * L.exitT,
          muzzle[2] + dz * L.exitT,
        ];
        this.counters.penetrations++;
        bus.emit('ballistic:penetrate', {
          surfaceType: L.surface,
          entryPos: L.entry.slice(),
          exitPos,
          residualEnergy: pathEntry.residual,
        });
      }
    }

    return result;
  }

  /** 레이어 i 진입 시점의 에너지 (path의 직전 잔여 — 첫 레이어는 초구) */
  incidentEnergyBefore(w, result, layerIndex) {
    let e = w.params.energy;
    for (const p of result.path) {
      if (p.layer >= layerIndex) break;
      e = p.residual;
    }
    return e;
  }

  /** 총구 위치 — 눈에서 전방 소폭 오프셋 (뷰모델 시각 총구와 분리된 논리 총구) */
  muzzleWorldPos(eye) {
    return [eye.pos[0], eye.pos[1], eye.pos[2]];
  }

  snapshot() {
    return {
      current: this.currentId,
      counters: { ...this.counters },
      weapons: Object.fromEntries([...this.weapons].map(([id, w]) => [id, w.snapshot()])),
    };
  }
}
