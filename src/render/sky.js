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
    this.sky.renderOrder = 1;      // 불투명 목록 마지막 — z=w라 하늘 픽셀만 셰이딩 (풀스크린 Preetham 오버드로우 회피, 픽셀 불변)
    scene.add(this.sky);

    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;       // 맑은 대륙성 대기
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this._envRT = null;
    this._envScene = new THREE.Scene();
    /**
     * 큐브 렌더 → fromCubemap 경로 (C2 교정): PMREMGenerator.fromScene은 호출마다
     * 'PMREM.Background' 재질·박스를 새로 만들고 폐기해 매번 프로그램 링크+해제가 일어난다 —
     * 프리웜 불가능한 구조적 컴파일이라 setShot마다 컴파일 로그(frame≥0)에 잡혔다.
     * fromCubemap은 생성기 캐시 재질(_cubemapMaterial·_blurMaterial)만 쓰므로 첫 1회 이후
     * 컴파일 0. 큐브 해상도 256은 fromScene 내부 큐브 크기와 동일.
     */
    this._cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    this._cubeCam = new THREE.CubeCamera(0.1, 100, this._cubeRT); // fromScene 기본 near/far와 동일 (돔은 z=w 고정이라 무관)
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._pmremWarmed = new Set(); // 프리웜 중 PMREM을 재질(주간/야간)별 1회 보장
    /** 현재 안개 구성 — 파이프라인 안개 패스가 읽는다 (world:weather와 동일 값) */
    this.fog = { density: 0, heightFalloff: 0.12, baseY: 0 };

    /**
     * 야간 전용 그라데이션 돔 — Preetham 박명은 지평선 자홍(330–350°)이 §4
     * 색역 밖이고 우회 조정(청색 편이)이 역효과(5.1→11.2%)임을 실측했다.
     * 청 대역(175–240°) 고정 2색 그라데이션은 구조적으로 색역 안이다.
     * 주간 재질과 프로그램이 다르므로 프리웜 샷 순회(주간+야간)가 둘 다 컴파일한다.
     */
    this.dayMat = this.sky.material;
    this.nightMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        horizonColor: { value: new THREE.Color(0.050, 0.072, 0.115) }, // h≈220°
        zenithColor: { value: new THREE.Color(0.010, 0.016, 0.030) },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w; // 최원면 고정 (Sky와 동일 규약)
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldPos;
        uniform vec3 horizonColor;
        uniform vec3 zenithColor;
        void main() {
          // 시선 방향은 카메라 기준 (Sky.js 규약) — 돔 원점 기준이면 카메라 이동에 따라
          // 그라데이션이 비대칭으로 늘어난다. 지평선 아래는 감쇠해 PMREM 바닥광 역전 방지.
          vec3 d = normalize(vWorldPos - cameraPosition);
          float y = d.y;
          float t = pow(clamp(y, 0.0, 1.0), 0.55);
          vec3 c = mix(horizonColor, zenithColor, t);
          c *= mix(0.25, 1.0, smoothstep(-0.08, 0.0, y));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
  }

  /** 태양 방향 (월드, 태양을 향하는 단위 벡터) */
  get sunDir() { return this._sunDir; }

  /**
   * 샷 구성 적용 — applySunConfig 경로에서 호출.
   * sun: {elev, azim, intensity}, fogCfg: {density, heightFalloff?, baseY?} | undefined
   */
  apply(sun, fogCfg, hemi = 0.4) {
    const night = sun.intensity < 0.1;
    // 주간=Preetham, 야간=전용 그라데이션 돔 (§4 색역 구조 보장 — 생성자 주석)
    this.sky.material = night ? this.nightMat : this.dayMat;
    const skyElev = night ? -14 : sun.elev;
    const el = THREE.MathUtils.degToRad(skyElev);
    const az = THREE.MathUtils.degToRad(sun.azim);
    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);
    if (!night) this.dayMat.uniforms.sunPosition.value.set(x, y, z); // 야간 돔은 태양 무관
    // 실제 태양 방향 (안개 위상함수·광선용 — 스카이돔 유효 고도가 아니라 샷 값)
    const elReal = THREE.MathUtils.degToRad(sun.elev);
    this._sunDir.set(
      Math.sin(az) * Math.cos(elReal),
      Math.sin(elReal),
      -Math.cos(az) * Math.cos(elReal),
    ).normalize();

    // PMREM 재생성 — 스카이돔만 담은 임시 씬 (구성 변경 시 1회).
    // 프리웜 중에는 첫 1회만 생성한다: PMREM 프로그램은 첫 생성에서 전부
    // 컴파일되고, 프리웜의 목적은 커버리지다 — 샷마다 재생성하면 SwiftShader
    // 실측 개당 ~1.1s × 12회 = 부팅 12.6s (PATCH-004-A 분해로 확인).
    // 캡처·플레이의 setShot 경로는 항상 전체 재생성 (환경광 정확성).
    // 프리웜: 돔 재질(주간 Preetham / 야간 그라데이션)별 1회 — _envScene(광원 0)의
    // 프로그램 키가 메인 씬과 다르므로 야간 PMREM 순열도 별도 컴파일 대상 (C2 검토)
    if (!this.prewarmSkipPmrem || !this._envRT || !this._pmremWarmed.has(this.sky.material)) {
      if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
      this._envScene.add(this.sky); // scene에서 잠시 이관
      this._cubeCam.update(this.renderer, this._envScene);
      this._envRT = this.pmrem.fromCubemap(this._cubeRT.texture);
      this.scene.add(this.sky);     // 복귀
      this._pmremWarmed.add(this.sky.material);
    }
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
    // 어휘 준수(§3): world:tod { hours }만 — 야간은 hours(예: 20.0)로 표현, phase 필드 제거
    this.bus.emit('world:tod', { hours });
    this.bus.emit('world:weather', { fogDensity: this.fog.density, humidity: 0.5 });
  }

  /** 감사 리그 전용 — 환경광 차단/복원 */
  setEnvironmentEnabled(on) {
    this.scene.environment = on ? (this._envRT?.texture ?? null) : null;
  }
}
