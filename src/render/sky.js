/**
 * src/render/sky.js — C2 하늘 서브시스템 (P3-BRIEF §3 C2).
 *
 * 소유: 대기 산란 스카이돔(three addons Sky — Preetham, 셰이더 순수·무난수),
 * 시간대(world:tod)·날씨(world:weather) 이벤트 발행, PMREM 환경광.
 *
 * 결정성 규약:
 *  - 모든 출력은 샷 구성(sun/fog)의 순수 함수. 시간·난수 입력 없음.
 *  - PMREM은 태양 구성 적용 시에만 재생성 (프레임 경로에서 갱신 금지).
 *  - world:tod의 hours는 azim의 결정적 매핑 (동 90°=06시, 남 180°=12시,
 *    서 270°=18시 — 태양 시계각 근사). 야간(intensity<0.1)은 azim 매핑에
 *    +12h 반전 없이 그대로 두되 phase='night'로 구분한다.
 *
 * 야간 하늘: Preetham은 태양 고도의 함수라 intensity를 모른다 — 야간 샷은
 * 스카이돔 전용 유효 고도를 지평선 아래(-12°)로 낮춰 박명 감쇠를 쓴다.
 * CSM(직사광) 방향은 샷 값을 유지한다 (월광 대용 — 그림자 방향 보존).
 *
 * 주변광 이관: P0 반구광은 environment(PMREM) 도입 후 0.4×로 감쇠 —
 * 하늘색 주변광이 주가 되고 반구광은 바닥 보정만 남는다 (C4에서 재조율).
 * 감사 리그(albedo/viewmodel)는 scene.environment를 끄고 자체 조명만 쓴다.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** 반구광 감쇠 계수 — environment 도입 후 잔여 바닥 보정 (C4 재조율 대상) */
export const HEMI_SCALE_WITH_ENV = 0.4;

export class SkySystem {
  constructor({ scene, renderer, bus }) {
    this.scene = scene;
    this.renderer = renderer;
    this.bus = bus;

    this.sky = new Sky();
    this.sky.name = 'sky_dome';
    this.sky.scale.setScalar(290); // 카메라 far 300 안쪽
    scene.add(this.sky);

    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;       // 맑은 대륙성 대기
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this._envRT = null;
    this._envScene = new THREE.Scene();
    this._sunDir = new THREE.Vector3(0, 1, 0);
    /** 현재 안개 구성 — 파이프라인 안개 패스가 읽는다 (world:weather와 동일 값) */
    this.fog = { density: 0, heightFalloff: 0.12, baseY: 0 };
  }

  /** 태양 방향 (월드, 태양을 향하는 단위 벡터) */
  get sunDir() { return this._sunDir; }

  /**
   * 샷 구성 적용 — applySunConfig 경로에서 호출.
   * sun: {elev, azim, intensity}, fogCfg: {density, heightFalloff?, baseY?} | undefined
   */
  apply(sun, fogCfg, hemi = 0.4) {
    const night = sun.intensity < 0.1;
    // 스카이돔 유효 고도: 야간은 지평선 아래 박명 (CSM 방향은 샷 값 유지)
    const skyElev = night ? -14 : sun.elev;
    // 야간 대기: 청색 편이 — Preetham 박명의 자홍(330–350°)은 §4 색역 밖이라
    // rayleigh↑·mie↓로 잔광을 청 대역(175–240°)으로 밀어넣는다 (paletteaudit 실측 5.1%→)
    const u = this.sky.material.uniforms;
    u.turbidity.value = night ? 2.5 : 6;
    u.rayleigh.value = night ? 3.2 : 1.6;
    u.mieCoefficient.value = night ? 0.0006 : 0.004;
    u.mieDirectionalG.value = 0.85;
    const el = THREE.MathUtils.degToRad(skyElev);
    const az = THREE.MathUtils.degToRad(sun.azim);
    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);
    this.sky.material.uniforms.sunPosition.value.set(x, y, z);
    // 실제 태양 방향 (안개 위상함수·광선용 — 스카이돔 유효 고도가 아니라 샷 값)
    const elReal = THREE.MathUtils.degToRad(sun.elev);
    this._sunDir.set(
      Math.sin(az) * Math.cos(elReal),
      Math.sin(elReal),
      -Math.cos(az) * Math.cos(elReal),
    ).normalize();

    // PMREM 재생성 — 스카이돔만 담은 임시 씬 (구성 변경 시 1회)
    if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
    this._envScene.add(this.sky); // scene에서 잠시 이관
    this._envRT = this.pmrem.fromScene(this._envScene, 0.04);
    this.scene.add(this.sky);     // 복귀
    this.scene.environment = this._envRT.texture;
    // 환경광 강도는 샷 주변광(hemi)에 종속 — 기본 1.0은 실내까지 하늘 IBL로
    // 침수시켜 역광·실내 무드를 파괴한다 (C2 실측: meanLum 39→156 백화)
    this.scene.environmentIntensity = THREE.MathUtils.clamp(hemi * 0.7, 0.03, 0.5);

    // 안개 구성 (sky 소유 — 파이프라인이 this.fog를 읽는다)
    this.fog = {
      density: fogCfg?.density ?? 0.0022,
      heightFalloff: fogCfg?.heightFalloff ?? 0.12,
      baseY: fogCfg?.baseY ?? 0,
    };

    // 이벤트 발행 (ARCHITECTURE §3 — sky 소유 어휘)
    const hours = +(6 + ((sun.azim - 90) * 12) / 180).toFixed(2);
    this.bus.emit('world:tod', { hours, phase: night ? 'night' : 'day' });
    this.bus.emit('world:weather', { fogDensity: this.fog.density, humidity: 0.5 });
  }

  /** 감사 리그 전용 — 환경광 차단/복원 */
  setEnvironmentEnabled(on) {
    this.scene.environment = on ? (this._envRT?.texture ?? null) : null;
  }
}
