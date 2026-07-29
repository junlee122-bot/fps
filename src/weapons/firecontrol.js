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
   * @param {(ox,oy,oz,dx,dy,dz,maxDist)=>Array} collectBodyHits
   *        physics 주입 — 동적 강체 레이 질의 (P2B §8). 미주입 시 강체 무시
   */
  constructor(collectChain, collectBodyHits = null) {
    this.collectChain = collectChain;
    this.collectBodyHits = collectBodyHits;
    this.weapons = new Map(WEAPON_ORDER.map((id) => [id, new Weapon(id)]));
    this.currentId = WEAPON_ORDER[0];
    /** playtest·디버그용 누적 계수 — 게임 로직은 읽지 않는다 */
    this.counters = { fired: 0, pellets: 0, hits: 0, penetrations: 0, stops: 0, bodyHits: 0 };
    /**
     * 카메라 반동 스프링 (P2B §8 — weapons 소유, 렌더 오프셋으로 발행).
     * 임계 감쇠: a = -k·p - c·v. 조준 입력(yaw/pitch 상태)은 건드리지 않는다 —
     * 스크립트 사격 결정성을 오프셋이 오염하지 않게 하기 위한 선택.
     */
    this.camSpring = { p: 0, v: 0, py: 0, vy: 0 };
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
    this.counters = { fired: 0, pellets: 0, hits: 0, penetrations: 0, stops: 0, bodyHits: 0 };
    this.camSpring.p = 0; this.camSpring.v = 0;
    this.camSpring.py = 0; this.camSpring.vy = 0;
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

    // 카메라 반동 스프링 (임계 감쇠 — k=90, c=2√k≈19)
    const K = 90, C = 19;
    const sp = this.camSpring;
    sp.v += (-K * sp.p - C * sp.v) * dt;  sp.p += sp.v * dt;
    sp.vy += (-K * sp.py - C * sp.vy) * dt; sp.py += sp.vy * dt;

    if (mayFire) this.fire(eye);
  }

  /** 발사 1회 — 펠릿별 독립 관통 (§2-4: 9발을 뭉뚱그리지 않는다) */
  fire(eye) {
    const w = this.current;
    const offsets = w.commitFire();
    const muzzle = this.muzzleWorldPos(eye);
    this.counters.fired++;
    // 카메라 스프링 킥 (시드 스트림 — 요는 좌우 무작위)
    this.camSpring.v += w.handling.camKickPitch;
    this.camSpring.vy += (w._rand() * 2 - 1) * w.handling.camKickYaw;

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

      // 레이 원점은 눈 — 시각 총구(muzzle)는 화염·예광 전용 (조준 정확도 분리)
      this.tracePellet(w, eye.pos, dx, dy, dz);
    }
  }

  /** 펠릿 1발의 체인 수집 → 관통 판정 → 이벤트 발행. origin = 눈 (레이 원점) */
  tracePellet(w, origin, dx, dy, dz) {
    const chain = this.collectChain(origin[0], origin[1], origin[2], dx, dy, dz, MAX_RANGE);

    // 동적 강체 히트를 체인에 병합 (P2B §8) — 차단 지점 이후는 제외
    if (this.collectBodyHits) {
      const limit = chain.blocked ? chain.endT : MAX_RANGE;
      for (const bh of this.collectBodyHits(origin[0], origin[1], origin[2], dx, dy, dz, MAX_RANGE)) {
        if (bh.tEnter >= limit) continue;
        chain.layers.push({
          surface: bh.surfaceName,
          thicknessCm: (bh.tExit - bh.tEnter) * 100,
          entryT: bh.tEnter,
          exitT: bh.tExit,
          objectId: -1,
          objectName: `body:${bh.body.id}`,
          entry: [origin[0] + dx * bh.tEnter, origin[1] + dy * bh.tEnter, origin[2] + dz * bh.tEnter],
          normal: [bh.nx, bh.ny, bh.nz],
          body: bh.body,
        });
      }
      chain.layers.sort((a, b) => a.entryT - b.entryT);
    }

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
      // 강체 층: 잔여 에너지 비례 임펄스 (P2B §8 — incidentEnergy 사용)
      if (L.body) {
        this.counters.bodyHits++;
        const J = Math.min(6, incident * 0.004); // kg·m/s — 캡으로 폭주 방지
        L.body.applyImpulse(dx * J, dy * J, dz * J, L.entry[0], L.entry[1], L.entry[2]);
        L.body.sleeping = false;
        L.body.sleepTimer = 0;
      }
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
          origin[0] + dx * L.exitT,
          origin[1] + dy * L.exitT,
          origin[2] + dz * L.exitT,
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

  /**
   * 시각 총구 위치 — 화염·예광의 시작점. 뷰모델 총열 끝 근사
   * (눈 + 전방 0.45 + 우 0.16·(1-ads) + 하 0.12·(1-ads)).
   * **레이 원점은 여전히 눈**(tracePellet 호출부) — 조준 정확도가 시각에
   * 종속되지 않는다.
   */
  muzzleWorldPos(eye) {
    const b = this.current.adsBlend;
    const cy = Math.cos(eye.yaw), sy = Math.sin(eye.yaw);
    const cp = Math.cos(eye.pitch), sp = Math.sin(eye.pitch);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;   // 전방
    const rx = cy, rz = -sy;                        // 우측 (yaw 평면)
    const side = 0.16 * (1 - b), down = 0.12 * (1 - b);
    return [
      eye.pos[0] + fx * 0.45 + rx * side,
      eye.pos[1] + fy * 0.45 - down,
      eye.pos[2] + fz * 0.45 + rz * side,
    ];
  }

  snapshot() {
    return {
      current: this.currentId,
      counters: { ...this.counters },
      camSpring: {
        p: +this.camSpring.p.toFixed(6), v: +this.camSpring.v.toFixed(6),
        py: +this.camSpring.py.toFixed(6), vy: +this.camSpring.vy.toFixed(6),
      },
      weapons: Object.fromEntries([...this.weapons].map(([id, w]) => [id, w.snapshot()])),
    };
  }
}
