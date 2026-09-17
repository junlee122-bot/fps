/**
 * src/sky/index.js — C2 하늘 서브시스템 (P3-BRIEF §3 C2, ARCHITECTURE §1 src/sky).
 *
 * 소유: 대기 산란 스카이돔(three addons Sky — Preetham, 셰이더 순수·무난수),
 * 시간대(world:tod)·날씨(world:weather) 이벤트 발행, PMREM 환경광,
 * 볼류메트릭 안개·광선 패스(fog.js FogPass — 파이프라인에 주입, 블릿은 파이프라인).
 *
 * 결정성 규약:
 *  - 모든 출력은 샷 구성(sun/fog)의 순수 함수. 시간·난수 입력 없음.
 *  - PMREM은 태양 구성 적용 시에만 재생성 (프레임 경로에서 갱신 금지).
 *  - world:tod의 hours는 azim의 결정적 매핑 (동 90°=06시, 남 180°=12시,
 *    서 270°=18시 — 태양 시계각 근사). 야간(intensity<0.1)도 같은 매핑의
 *    hours로만 표현한다 (§3 어휘 — phase 필드 없음).
 *
 * 야간 하늘: Preetham은 태양 고도의 함수라 intensity를 모른다 — 야간 샷은
 * 스카이돔 전용 유효 고도를 지평선 아래(-12°)로 낮춰 박명 감쇠를 쓴다.
 * CSM(직사광) 방향은 샷 값을 유지한다 (월광 대용 — 그림자 방향 보존).
 *
 * 주변광 이관: P0 반구광은 environment(PMREM) 도입 후 0.4×로 감쇠(계수는 조명
 * 리그 소유 render/renderer.js HEMI_SCALE_WITH_ENV) — 하늘색 주변광이 주가 되고
 * 반구광은 바닥 보정만 남는다 (C4에서 재조율).
 * 감사 리그(albedo/viewmodel)는 scene.environment를 끄고 자체 조명만 쓴다.
 */

import * as THREE from 'three';
import { clock } from '../core/clock.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { FogPass } from './fog.js';

/** 인스캐터 하늘색 = 돔 지평선 평균 × 이 계수 (단일 산란 알베도 근사 — 실측 근거 CONTRACT-NOTES C4) */
export const HORIZON_TO_INSCATTER = 1.0;
/** 지평선 판독 고도(°). Preetham 선형 출력은 저고도 태양에서 지평선(+6°)이 녹색 편이(g>b, fog_wall 실측 [.27,.37,.34]) — +10°는 청색 유지 */
export const HORIZON_SAMPLE_ELEV_DEG = 10;
/** 인스캐터 색 채도 감쇠 — 안개 속 다중 산란은 단일 산란 하늘색보다 무채색에 가깝다 (Preetham 녹색 편이 완화) */
export const INSCATTER_DESAT = 0.8;
/**
 * C4 돔 복사휘도 스케일 (주간 Preetham). three Sky.js는 texColor^(1/(1.2+1.2·sunfade))의 LDR 표시용 곡선을
 * 출력한다 — HDR 체인에서는 선형 복사휘도(texColor)를 써야 노출·AgX가 의미를 갖는다. 스케일은 태양 직사
 * (CSM irradiance 3.2 → 백색 확산면 복사휘도 ≈0.92)에 대한 지평선 하늘의 비(실세계 ≈0.25–0.4)로 정한다
 * — C2/C3 프레임의 '고조도·저대비'는 돔이 태양광 백색면보다 2.5× 밝아(지평선 2.5) 환경광이 직사광과
 * 맞먹은 결과였다 (C4 실측, CONTRACT-NOTES C4).
 */
export const DOME_SCALE = 0.10;
/** environmentIntensity = clamp(hemi × ENV_PER_HEMI, 0.05, 1.0) — 샷의 hemi(주변광 의도)로 물리 돔 IBL을 변조 */
export const ENV_PER_HEMI = 2.0;
/** 지평선 헤이즈 가산 (선형, domeScale 적용 후 단위): 지평선에서 hazeAmount·hazeColor, (1−y)^hazePower 감쇠 */
export const HAZE_AMOUNT = 0.2; // R1 수정 A: 0.3 → 0.2 — 기본 안개와 겹쳐 주간 전체가 뿌옇게 탈색(R1 12/12 언급)
export const HAZE_POWER = 1.5;
/** 야간 돔 환경광 강도 (apply 주석 — 팔레트 §4 야간 암부 교정, C3) */
export const NIGHT_ENV_INTENSITY = 0.65;
/** 권운층 (R1 수정 A, 생성자 주석): 혼합량·투영 스케일·하늘 대비 휘도 이득 */
export const CIRRUS_AMOUNT = 0.55;
export const CIRRUS_SCALE = 2.2;
export const CIRRUS_GAIN = 1.45;
const CIRRUS_GLSL = /* glsl */`
    uint skLb(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
    float skH(ivec2 p, uint s) { return float(skLb(uint(p.x + 8192) * 0x9E3779B1u ^ uint(p.y + 8192) * 0x85EBCA77u ^ s)) * (1.0 / 4294967296.0); }
    float skVn(vec2 p, uint s) {
      vec2 f = fract(p); ivec2 i = ivec2(floor(p)); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(skH(i, s), skH(i + ivec2(1, 0), s), u.x), mix(skH(i + ivec2(0, 1), s), skH(i + ivec2(1, 1), s), u.x), u.y);
    }
    float skFbm(vec2 p) {
      float s = 0.0, a = 0.5;
      for (int o = 0; o < 4; o++) { s += a * skVn(p, 0x51u + uint(o) * 131u); a *= 0.5; p = p * 2.03 + vec2(17.1, 9.7); }
      return s;
    }
    vec3 skyCirrus(vec3 sky, vec3 dir, vec3 sunDir, float dayF) {
      float y = max(dir.y, 0.0);
      vec2 cuv = dir.xz / (y + 0.18) * cirrusScale;
      float ang = 0.55; mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      cuv = rot * cuv; cuv.x *= 0.28;                       // 권운 결: 한 방향으로 늘인 이방성
      float n = skFbm(cuv) * 0.75 + skFbm(cuv * 3.1 + vec2(3.3, 7.7)) * 0.25;
      float cov = smoothstep(0.47, 0.70, n);
      cov *= smoothstep(0.02, 0.22, y);                      // 지평선 페이드 (헤이즈가 맡는다)
      float lum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
      float fwd = 1.0 + 1.6 * pow(max(dot(dir, sunDir), 0.0), 8.0); // 태양 근처 전방산란
      vec3 cl = cirrusColor * (lum * cirrusGain * fwd);
      return mix(sky, cl, cov * cirrusAmount * dayF);
    }
`;

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
    /**
     * C4 돔 셰이더 패치 (유니폼만 — 프로그램 순열 불변):
     *  - 선형 복사휘도 출력: Sky.js의 pow(1/(1.2+1.2·sunfade)) 표시 곡선 제거, × domeScale.
     *  - 지평선 헤이즈: Preetham 단일 산란은 다중 산란의 지평선 백화가 없어 선형 출력이 b/r≈3의 짙은
     *    청색이 된다(C4 실측). hazeColor·hazeAmount·(1−y)^hazePower·dayF 를 가산 (§4 청·하늘 대역 안,
     *    수묵 대기원근의 종이빛 지평선).
     *  - sunDisc: 환경 큐브 렌더 시 0 — 태양 원반(vSunE·19000·0.04 ≈ 7.6e5, HalfFloat 클램프 65504)이
     *    PMREM에 들어가면 조도 ≈ 65504·6.8e-5 sr ≈ 4.5 의 **무그림자 직사광**이 환경광으로 이중 계상된다
     *    (C2/C3 저대비의 두 번째 원인 — CSM 3.2와 맞먹는 그림자 없는 태양). 가시 돔은 1.
     */
    this.domeScale = { value: DOME_SCALE };
    this.hazeAmount = { value: HAZE_AMOUNT };
    this.hazePower = { value: HAZE_POWER };
    this.hazeColor = { value: new THREE.Color(0.95, 0.93, 0.88) };
    /**
     * R1 수정 A — 권운(卷雲)층: 돔이 단색 그라데이션이라 '구름·태양·변화 없음'이 12/12샷 결함이었다.
     * 결정적 정수 해시(lowbias32) 값노이즈 4옥타브를 고도 평면 투영(direction.xz/(y+k))에 이방성으로 늘여
     * 권운 결을 만들고, 국소 하늘 휘도 × cirrusGain 의 중성색으로 cov·cirrusAmount 만큼 섞는다(가산 아님 —
     * 돔 스케일과 무관하게 하늘 대비 비율 고정). 태양 근처 전방산란 가중. 야간(dayF=0)은 0. 지평선은 페이드.
     * 환경 큐브(PMREM)에도 그대로 들어간다(유니폼 공유). 저채도 백색이라 §4 하늘 대역 안.
     */
    this.cirrusAmount = { value: CIRRUS_AMOUNT };
    this.cirrusScale = { value: CIRRUS_SCALE };
    this.cirrusGain = { value: CIRRUS_GAIN };
    this.cirrusColor = { value: new THREE.Color(1.0, 0.985, 0.96) };
    this._sunDisc = { value: 1 };
    this.envPerHemi = ENV_PER_HEMI;
    const U = { domeScale: this.domeScale, hazeAmount: this.hazeAmount, hazePower: this.hazePower, hazeColor: this.hazeColor, sunDisc: this._sunDisc,
      cirrusAmount: this.cirrusAmount, cirrusScale: this.cirrusScale, cirrusGain: this.cirrusGain, cirrusColor: this.cirrusColor };
    this.sky.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float domeScale, hazeAmount, hazePower, sunDisc, cirrusAmount, cirrusScale, cirrusGain;\n\t\tuniform vec3 hazeColor, cirrusColor;\n' + CIRRUS_GLSL + '\n\t\tvoid main() {')
        .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * sunDisc;')
        .replace('gl_FragColor = vec4( retColor, 1.0 );',
          'float dayF = clamp( vSunE / 1000.0, 0.0, 1.0 );\n\t\t\tvec3 haze = hazeColor * ( hazeAmount * dayF * pow( 1.0 - clamp( direction.y, 0.0, 1.0 ), hazePower ) );\n\t\t\tvec3 skyLin = texColor * domeScale + haze;\n\t\t\tskyLin = skyCirrus( skyLin, direction, vSunDirection, dayF );\n\t\t\tgl_FragColor = vec4( skyLin, 1.0 );');
    };
    this.sky.material.customProgramCacheKey = () => 'sky_linear_r1';
    u.turbidity.value = 6;       // 맑은 대륙성 대기
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;

    /** 볼류메트릭 안개·광선 패스 — 파이프라인이 주입받아 블릿 (ARCHITECTURE §1 src/sky 소유) */
    this.fogPass = new FogPass();
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
    /**
     * C4: 돔 지평선 판독 — 큐브맵을 고도 +6°·방위 16점으로 샘플한 16×1 HalfFloat RT를 동기 판독해
     * 평균색을 안개 인스캐터 skyColor로 쓴다 (apply 시 1회 — 프레임 경로 아님). C2 검토 기록 (2) 해소.
     */
    this._horizonRT = new THREE.WebGLRenderTarget(16, 1, {
      type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this._horizonMat = new THREE.ShaderMaterial({
      uniforms: { tCube: { value: null }, elev: { value: THREE.MathUtils.degToRad(HORIZON_SAMPLE_ELEV_DEG) } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform samplerCube tCube;
        uniform float elev;
        void main() {
          float az = vUv.x * 6.283185307179586;
          vec3 d = vec3(cos(elev) * sin(az), sin(elev), -cos(elev) * cos(az));
          gl_FragColor = vec4(textureCube(tCube, d).rgb, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this._horizonMat.name = 'C4_SKY_HORIZON';
    this._horizonScene = new THREE.Scene();
    this._horizonScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._horizonMat));
    this._horizonCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._horizonBuf = new Uint16Array(16 * 4);
    /** 마지막 지평선 판독 평균 [r,g,b] (선형) — 계측·기록용 */
    this.horizonColor = [0, 0, 0];
    /** 환경광 재생성 소요 로그 [{material, cubeMs, pmremMs}] — 부팅 분해 계측 (PATCH-004-A) */
    this.envLog = [];
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
    this.fogPass.setSun(sun); // 인스캐터 색·광선 강도 (샷 구성의 순수 함수)
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
      const tc = clock.wallNowMs();
      this._sunDisc.value = this.envSunDisc ? 1 : 0; // 환경 큐브: 태양 원반 제외 (생성자 주석) — envSunDisc는 A/B 프로브 전용
      this._cubeCam.update(this.renderer, this._envScene);
      this._sunDisc.value = 1;
      const tp = clock.wallNowMs();
      this._envRT = this.pmrem.fromCubemap(this._cubeRT.texture);
      this.envLog.push({ material: this.sky.material === this.dayMat ? 'day' : 'night', cubeMs: Math.round(tp - tc), pmremMs: Math.round(clock.wallNowMs() - tp) });
      this.scene.add(this.sky);     // 복귀
      this._pmremWarmed.add(this.sky.material);
    }
    this.scene.environment = this._envRT.texture;
    this._readHorizon(); // C4: 인스캐터 색 = 돔 지평선 실측 (큐브는 위에서 갱신됨 — 프리웜 스킵 시 직전 돔)
    // 환경광 강도는 샷 주변광(hemi)에 종속. C2의 clamp(hemi·0.7, 0.03, 0.5)는 과대 돔(지평선 2.5)에 대한
    // 억제였다 — C4에서 돔을 선형 복사휘도 × DOME_SCALE로 물리 비율에 맞추고 계수를 ENV_PER_HEMI로 재정의
    // (noon hemi 0.55 → 1.0 = 돔 그대로, 실내 0.15 → 0.3). 야간은 C3 교정 NIGHT_ENV_INTENSITY 유지(야간 돔은
    // 스케일 대상이 아니므로 C3와 동일 조도): 암부가 AgX 토에 잠겨 온색 채도가 증폭되는 것을 하늘광으로 중화.
    this.scene.environmentIntensity = night ? NIGHT_ENV_INTENSITY : THREE.MathUtils.clamp(hemi * this.envPerHemi, 0.05, 1.0);

    // 안개 구성 (sky 소유 — 파이프라인이 this.fog를 읽는다)
    this.fog = {
      density: fogCfg?.density ?? 0.0012, // R1 수정 A: 0.0022 → 0.0012 (헤이즈·그레이드 암부 스플릿과 중첩된 탈색 완화)
      heightFalloff: fogCfg?.heightFalloff ?? 0.12,
      baseY: fogCfg?.baseY ?? 0,
    };

    // 이벤트 발행 (ARCHITECTURE §3 — sky 소유 어휘)
    const hours = +(6 + ((sun.azim - 90) * 12) / 180).toFixed(2);
    // 어휘 준수(§3): world:tod { hours }만 — 야간은 hours(예: 20.0)로 표현, phase 필드 제거
    this.bus.emit('world:tod', { hours });
    this.bus.emit('world:weather', { fogDensity: this.fog.density, humidity: 0.5 });
  }

  /** C4: 큐브맵 지평선 16점 샘플 → 동기 판독 → 평균 → fogPass.setSkyColor */
  _readHorizon() {
    this._horizonMat.uniforms.tCube.value = this._cubeRT.texture;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._horizonRT);
    this.renderer.render(this._horizonScene, this._horizonCam);
    this.renderer.readRenderTargetPixels(this._horizonRT, 0, 0, 16, 1, this._horizonBuf);
    this.renderer.setRenderTarget(prev);
    const f = THREE.DataUtils.fromHalfFloat;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 16; i++) { r += f(this._horizonBuf[i * 4]); g += f(this._horizonBuf[i * 4 + 1]); b += f(this._horizonBuf[i * 4 + 2]); }
    this.horizonColor = [r / 16, g / 16, b / 16];
    const lum = 0.2126 * this.horizonColor[0] + 0.7152 * this.horizonColor[1] + 0.0722 * this.horizonColor[2];
    this.fogPass.setSkyColor(this.horizonColor.map((v) => lum + (v - lum) * INSCATTER_DESAT), HORIZON_TO_INSCATTER);
  }

  /** 감사 리그 전용 — 환경광 차단/복원 */
  setEnvironmentEnabled(on) {
    this.scene.environment = on ? (this._envRT?.texture ?? null) : null;
  }
}
