/**
 * src/render/pipeline.js — C1 렌더 파이프라인 뼈대 (P3-BRIEF §3).
 *
 * 체인: HDR(HalfFloat) 씬 렌더(+깊이 텍스처 prepass) → GTAO → [C2 안개] → TAA 리졸브
 * → 카메라 모션블러 → [C4 노출 미터 3패스 · 블룸 6패스] → 출력(노출·블룸·AgX·sRGB·그레이드 LUT, output.js).
 * 태양 그림자는 CSM 3캐스케이드(C4: 캐스케이드 경계 페이드).
 *
 * 구조: 모든 패스를 **명시적 자체 RT**로 직접 호출한다 — EffectComposer 없음.
 * (컴포저는 rt2를 clone()으로 만들며 depthTexture까지 복제하므로, TAA/모션블러가
 * 참조하는 원본 depth와 씬이 실제로 기록하는 depth가 갈라진다. 직접 소유로 차단.)
 * 규약: RenderPass.render(renderer, w, r)는 3번째 인자에 씬을 그리고,
 * GTAOPass.render(renderer, w, r)는 3번째 인자를 읽어 2번째 인자에 합성한다.
 * TAA 출력 RT가 곧 다음 프레임의 히스토리다 (핑퐁, 복사 없음).
 *
 * 그림자는 프레임당 정확히 1회: shadowMap.autoUpdate=false + 프레임 시작에
 * needsUpdate=true. (autoUpdate=true면 GTAO 노멀 프리패스의 renderer.render()가
 * 캐스케이드 3장을 한 번 더 그린다 — 2배 비용 + 패스 분해 오염.)
 *
 * 결정성 규약:
 *  - TAA 지터 인덱스는 clock.frame(시뮬 프레임 — lockstep에서 결정적)만 사용
 *  - 히스토리 RT는 상태다 — reset()이 무효화, 캡처는 settle 90프레임 동안
 *    결정적으로 재수렴 (동일 프레임열 → 동일 히스토리 → 비트 동일)
 *  - 재투영·모션블러는 **비지터** VP로 계산 (지터가 가짜 속도를 만들지 않게)
 *  - 정적 카메라(캡처)에서 모션블러는 항등, TAA는 지터 수퍼샘플 수렴
 *
 * CSM은 재질 셰이더 패치가 필요하다 — 부팅 patchScene() + 이후 생성 재질
 * (감사 카드·판별 클론)은 patchMaterial(). 미패치 재질은 캐스케이드 광 3개를
 * 중복 수광해 과노출된다.
 */

import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ExposureMeter } from './exposure.js';
import { BloomPass } from './bloom.js';
import { buildGradeLUT, GRADE_DEFAULT } from './grade.js';
import { createOutputMaterial } from './output.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { clock } from '../core/clock.js';

/**
 * C4 노출·블룸·출력 파라미터 — 미학 상수 (실측 근거: CONTRACT-NOTES C4 기록).
 *  ec: 노출 보정 EV(+가 밝게). evMin/evMax: 적응 EV100 클램프 — 야간이 중회색으로 끌려 올라가지 않게 하한을 둔다.
 *  rateUp/rateDown: 적응 속도(1/s) — 밝아질 때 빠르고 어두워질 때 느리다(시각 적응 비대칭).
 */
/** 태양광 색 (선형, R1 수정 A-2 — csm.fade 아래 주석) */
const SUN_COLOR = Object.freeze([1.0, 0.97, 0.92]);
/** GTAO 파라미터 (R1 수정 B — 접지 음영). radius(m)·scale·thickness·distanceExponent·distanceFallOff는 GTAOPass 유니폼 */
const GTAO_PARAMS = Object.freeze({ radius: 0.7, scale: 1.4, thickness: 1.0, distanceExponent: 1.0, distanceFallOff: 1.0 });
const EXPOSURE_PARAMS = Object.freeze({ ec: 1.0, evMin: 1.0, kneeSlope: 0.2, evMax: 14.0, rateUp: 3.0, rateDown: 1.5, centerWeight: 0.35 });
const BLOOM_PARAMS = Object.freeze({ threshold: 0.8, knee: 0.5, iterations: 2 });
const OUTPUT_PARAMS = Object.freeze({ bloomStrength: 0.08, lutIntensity: 1.0, ditherAmp: 0.0 });

/** Halton(2,3) 8점 — TAA 서브픽셀 지터 (결정적 상수, 픽셀 단위 오프셋) */
const JITTER = [
  [0.000000, -0.166667], [-0.250000, 0.166667], [0.250000, -0.388889], [-0.375000, -0.055556],
  [0.125000, 0.277778], [-0.125000, -0.277778], [0.375000, 0.055556], [-0.437500, 0.388889],
];

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const TAA_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tHistory;
  uniform sampler2D tDepth;
  uniform mat4 reproj;
  uniform float blend;
  uniform float historyValid;
  uniform vec2 resolution;
  void main() {
    vec4 cur = texture2D(tDiffuse, vUv);
    if (historyValid < 0.5) { gl_FragColor = cur; return; }
    float depth = texture2D(tDepth, vUv).x;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 prev = reproj * clip;
    vec2 prevUv = (prev.xy / prev.w) * 0.5 + 0.5;
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
      gl_FragColor = cur; return;
    }
    vec4 hist = texture2D(tHistory, prevUv);
    vec2 px = 1.0 / resolution;
    vec4 mn = cur, mx = cur;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      vec4 s = texture2D(tDiffuse, vUv + vec2(float(dx), float(dy)) * px);
      mn = min(mn, s); mx = max(mx, s);
    }
    hist = clamp(hist, mn, mx);
    gl_FragColor = mix(cur, hist, blend);
  }
`;

const MB_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform mat4 reproj;
  uniform float strength;
  uniform float maxVelocity;
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 prev = reproj * clip;
    vec2 prevUv = (prev.xy / prev.w) * 0.5 + 0.5;
    vec2 vel = (vUv - prevUv) * strength;
    float vl = length(vel);
    if (vl > maxVelocity) vel *= maxVelocity / vl;
    vec4 sum = vec4(0.0);
    const int N = 8;
    for (int i = 0; i < N; i++) {
      float t = (float(i) / float(N - 1)) - 0.5;
      sum += texture2D(tDiffuse, vUv + vel * t);
    }
    gl_FragColor = sum / float(N);
  }
`;

/**
 * C2 볼류메트릭 안개·광선 (P3-BRIEF §3 C2).
 *  - 높이 안개: 지수 밀도 ρ(y)=ρ0·exp(-k(y-y0))의 시선 적분 **해석해** —
 *    스텝 없음(밴딩 없음), 저비용. 색은 하늘 근사색 + 태양 전방산란(HG 위상).
 *  - 광선(god rays): CSM 캐스케이드0 그림자를 시선상 12스텝 샘플 —
 *    스텝 위상은 (픽셀, clock.frame%8) 결정적 디더 → TAA가 시간 수렴.
 *  - depth=1(하늘)은 원거리 상한으로 처리해 하늘도 안개층을 통과해 보인다.
 */
// C2 볼류메트릭 안개·광선 셰이더는 src/sky/fog.js(FogPass) 소유 — 파이프라인은 블릿만 한다


function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: FS_VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false,
  });
}

export class RenderPipeline {
  constructor({ renderer, scene, camera }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // C4: renderer.toneMapping은 출력 패스의 모드 스위치다 — AgX=전체 체인, NoToneMapping=감사 우회(audit-cards).
    // 씬은 HDR RT에 그려지므로 재질 셰이더에는 톤매핑이 주입되지 않는다 (three 규약: 화면 타깃에서만).
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    // 컴포저·후처리의 내부 render() 다회 호출이 info를 매번 리셋하면
    // drawCalls/triangles가 마지막 패스(풀스크린 쿼드 1콜)만 남는다 —
    // 프레임 단위 수동 리셋으로 전환 (stats 게이트의 전제)
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // render()가 프레임당 1회 needsUpdate

    // ---- CSM 3캐스케이드 ----
    this.csm = new CSM({
      parent: scene,
      camera,
      cascades: 3,
      maxFar: 70,
      mode: 'practical',
      shadowMapSize: 2048,
      lightDirection: new THREE.Vector3(-0.3, -0.8, 0.5).normalize(),
      lightIntensity: 3.0,
    });
    for (const l of this.csm.lights) {
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.02;
    }
    // C4: 캐스케이드 경계 페이드 (C2 검토 이월 '경계 페더') — CSM_FADE 정의가 재질 셰이더에 들어가므로
    // patchMaterial 이전에 설정해야 한다 (프리웜이 그 순열을 컴파일). 마진은 three 규약 0.25·d² (정규화 깊이).
    this.csm.fade = true;
    // R1 수정 A-2: 태양광 약한 온색 (5500K 근사) — 그늘(청색 환경광)과 양지의 색온도 대비. CSM은 lightColor 인자가 없어 생성 후 설정.
    // 팔레트: 목재 대역 원색 sRGB 채도 ≈.2 × 온광 → ≈.25 < .35 (사전점검 확인). 야간(강도 .02)은 무의미.
    for (const l of this.csm.lights) l.color.setRGB(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]);

    // ---- 씬(HDR+깊이) RT + GTAO 합성 RT — 직접 소유 ----
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this._size = size;
    const depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      depthTexture,
    });
    this.aoRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // R1 비평 수정 B: 기본 반경 0.25m·scale 1은 계약 해상도(3024×1964)에서 기단·기둥 밑 접지 음영이
    // 읽히지 않았다(R1 S01·S03·S05·S11). 반경은 월드 m — 주춧돌·기단 턱(0.3~0.6m) 규모의 폐색을 잡도록
    // 확대, scale은 폐색 곡선 강도. 유니폼만 변경(샘플 수·정의 불변 → 프로그램 순열·비용 불변).
    this.gtao.updateGtaoMaterial(GTAO_PARAMS);
    this.depthTexture = depthTexture;

    // GTAOPass 생성자는 PD 디노이즈 노이즈를 SimplexNoise 기본 인자 r=Math로 만든다
    // — Math.random 256회 소비 = 페이지 부팅마다 다른 텍스처 = 페이지 간 결정성 위반.
    // ('Math.random' grep에 안 걸리는 r.random() 경로 — CONTRACT-NOTES P3 기록.)
    // 고정 시드 mulberry32로 동일 형식(64² RGBA8, Repeat) 재생성해 교체한다.
    {
      let seed = 0x9e3779b9 | 0;
      const rand = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const simplex = new SimplexNoise({ random: rand });
      const n = 64;
      const data = new Uint8Array(n * n * 4);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const o = (i * n + j) * 4;
        data[o] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
        data[o + 1] = (simplex.noise(i + n, j) * 0.5 + 0.5) * 255;
        data[o + 2] = (simplex.noise(i, j + n) * 0.5 + 0.5) * 255;
        data[o + 3] = (simplex.noise(i + n, j + n) * 0.5 + 0.5) * 255;
      }
      const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      this.gtao.pdNoiseTexture.dispose();
      this.gtao.pdNoiseTexture = tex;
      this.gtao.pdMaterial.uniforms.tNoise.value = tex;
    }

    // ---- 명시적 후반부: TAA(핑퐁 = 히스토리) → MB → Output(AgX+sRGB) ----
    // NearestFilter: 히스토리·MB는 동해상도 재투영이라 정적 카메라(캡처)에선 정확
    // 텍셀 페치가 맞다. LinearFilter는 텍셀 중심 경계에서 가중치가 나이프에지가 되어
    // 소프트웨어 GL 비결정 시드로 작동했다 (E3 실측: 첫 히스토리 읽기 프레임에서 분기).
    // 이동 카메라 서브픽셀 부드러움 소폭 손실 — 실기기(C4) 검증 시 재평가.
    const mkRT = () => new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
    });
    this.taaRT = [mkRT(), mkRT()];
    this.taaWrite = 0;
    this.historyValid = false;
    this.mbRT = mkRT();
    this.fogRT = mkRT(); // C2 안개 출력 (GTAO 뒤·TAA 앞)

    this._fsScene = new THREE.Scene();
    this._fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this._fsScene.add(this._fsQuad);

    this.taaMat = fsMaterial(TAA_FRAG, {
      tDiffuse: { value: null }, tHistory: { value: null }, tDepth: { value: depthTexture },
      reproj: { value: new THREE.Matrix4() }, blend: { value: 0.90 },
      historyValid: { value: 0 }, resolution: { value: new THREE.Vector2(size.x, size.y) },
    });
    this.mbMat = fsMaterial(MB_FRAG, {
      tDiffuse: { value: null }, tDepth: { value: depthTexture },
      reproj: { value: new THREE.Matrix4() },
      strength: { value: 0.55 }, maxVelocity: { value: 0.02 },
    });
    /** C2: main.js가 SkySystem 생성 후 주입 — 안개 구성·태양 방향의 소유자는 sky */
    this.sky = null;
    this._invVPFog = new THREE.Matrix4();
    this._csmFov = -1; this._csmAspect = -1;
    // ---- C4: 노출 미터 → 블룸 → 출력(AgX·sRGB·LUT) — 전부 자체 RT·자체 재질 (output.js 머리주석) ----
    const blit = (m, t) => this._blit(m, t);
    this.exposure = new ExposureMeter({ renderer, blit, params: EXPOSURE_PARAMS });
    this.bloom = new BloomPass({ blit, params: BLOOM_PARAMS });
    // R1 A-3: 대역 채도 상한은 LUT(암부에서 무력)가 아니라 출력 셰이더가 건다 — LUT는 bandCap 없이 빌드 (output.js 주석)
    this.lut = buildGradeLUT({ bandCap: null });
    this.outputMat = createOutputMaterial({ lut: this.lut.texture, lutSize: this.lut.size, params: OUTPUT_PARAMS, band: GRADE_DEFAULT });

    this._prevVP = new THREE.Matrix4();
    this._curVP = new THREE.Matrix4();
    this._reproj = new THREE.Matrix4();
    this._invVP = new THREE.Matrix4();
    this._hasPrev = false;
    /** 패스별 콜·삼각형 분해 (지표 의미 판정용 — renderFrame이 stats에 전달) */
    this.passStats = { shadowBeauty: [0, 0], gtao: [0, 0], post: [0, 0], scenePass: [0, 0], postFullscreenEq: 0 };
    /** rendervariance 음성 테스트 전용 결함 주입 — reset()에 무관한 렌더 카운터로 지터를 흔든다 (harness.debugDrift) */
    this.debugDrift = false;
    this._renderCount = 0;
    /** 직전 렌더의 TAA 지터 — 태그 마스크(render/tagmask.js)가 캡처 프레임과 같은 투영으로 그리는 데 쓴다 (PATCH-007-C) */
    this.lastJitter = [0, 0];
  }

  /** C4 그레이드 LUT 재구성 (조정 프로브·설정 변경용 — 부팅 경로는 생성자 1회) */
  setGrade(params) {
    const old = this.lut.texture;
    this.lut = buildGradeLUT({ ...params, bandCap: null });
    const u = this.outputMat.uniforms;
    u.tLut.value = this.lut.texture;
    u.lutSize.value = this.lut.size;
    const g = { ...GRADE_DEFAULT, ...params };
    u.uBand.value = { x: g.band[0], y: g.band[1], z: g.band[2], w: g.band[3] };
    u.uBandCap.value = g.bandCap ?? 0; u.uBandSlope.value = g.bandSlope ?? 0;
    old.dispose();
  }

  /** CSM 셰이더 패치 — 부팅 씬 순회 + 이후 생성 재질(카드·클론)에 필수 */
  patchMaterial(mat) {
    if (!mat) return;
    if (mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) {
      this.csm.setupMaterial(mat);
    }
  }

  patchScene() {
    const seen = new Set();
    this.scene.traverse((o) => {
      const m = o.material;
      if (m && !seen.has(m)) { seen.add(m); this.patchMaterial(m); }
    });
  }

  /** 빛 진행 방향(월드, 공유 참조 — setSun이 제자리 갱신). 창호지 투과 유니폼이 참조한다 (R1 F) */
  get sunTravelDirection() { return this.csm.lightDirection; }
  /** 태양광 색(공유 참조) */
  get sunColor() { return this.csm.lights[0].color; }
  /** 태양 구성 (elev/azim 도, intensity) — applySunConfig가 호출 */
  setSun({ elev, azim, intensity }) {
    const el = THREE.MathUtils.degToRad(elev);
    const az = THREE.MathUtils.degToRad(azim);
    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);
    this.csm.lightDirection.set(-x, -y, -z).normalize();
    for (const l of this.csm.lights) l.intensity = intensity;
    // 안개 인스캐터 색·광선 강도는 sky.fogPass.setSun이 소유 (src/sky/fog.js) — sky.apply 경로에서 갱신
  }

  /** 프리웜 전용 — 그림자 맵 해상도 축소/복원 (프로그램 동일, 렌더 비용만 변화) */
  setShadowMapSize(px) {
    for (const l of this.csm.lights) {
      l.shadow.mapSize.set(px, px);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h); // depthTexture는 렌더러가 자동 재조정 (WebGLTextures)
    this.aoRT.setSize(w, h);
    this.gtao.setSize(w, h);
    for (const rt of this.taaRT) rt.setSize(w, h);
    this.mbRT.setSize(w, h);
    this.fogRT.setSize(w, h);
    this._size.set(w, h);
    this.taaMat.uniforms.resolution.value.set(w, h);
    this.bloom.setSize(w, h);
    this.outputMat.uniforms.bloomSize.value.copy(this.bloom.size);
    // 포스트 체인 풀스크린 등가 비용 (계측 보고 — §8 overdraw 지표 정의(씬+안개+HANJI)와 별개):
    // GTAO 4 + 안개 1 + TAA 1 + MB 1 + 출력 1 + 노출 미터(64²+8²+1)/픽셀 + 블룸(1/16+5/64)
    this.passStats.postFullscreenEq = +(4 + 1 + 1 + 1 + 1 + (64 * 64 + 64 + 1) / (w * h) + this.bloom.fullscreenEq).toFixed(4);
    this.csm.updateFrustums();
    // 히스토리·재투영·패리티 전부 리셋 — historyValid만 끄고 _hasPrev를 남기면
    // 다음 첫 프레임의 MB가 stale _prevVP(프리웜 마지막 뷰)로 비항등 재투영을 만들어
    // '부팅 직후 첫 시행'과 'reset 후 시행'의 상태가 갈라진다 (클램프가 이를 영구화)
    this.reset();
  }

  /** resetState 경로 — GPU 누적 상태 무효화 (RT 내용·패리티까지 명시 복원) */
  reset() {
    this.historyValid = false;
    this._hasPrev = false;
    this.taaWrite = 0;          // 핑퐁 패리티 — '짝수 프레임 수' 우연에 의존하지 않는다
    this._prevVP.identity();
    this.exposure.reset();      // C4: 노출 적응 상태 — 다음 프레임 목표값 스냅
    const prev = this.renderer.getRenderTarget();
    for (const rt of [this.taaRT[0], this.taaRT[1], this.mbRT]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
  }

  _blit(material, target) {
    this._fsQuad.material = material;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._fsScene, this._fsCam);
    this.renderer.setRenderTarget(prev);
  }

  render() {
    this.renderer.info.reset(); // 프레임 시작 — 전 패스 합산 계측
    const cam = this.camera;
    cam.updateMatrixWorld();
    // aspect는 파이프라인이 소유한다: setViewOffset(fullW,fullH,…)가 camera.aspect를
    // fullW/fullH로 덮어쓰므로(three 규약), 프리웜 저해상도 렌더가 aspect를 오염시킨 채
    // 부팅이 끝나면 첫 프레임의 _curVP만 잘못된 aspect로 계산된다 — 실제 드로우는
    // setViewOffset이 즉시 고쳐 scene은 정상이지만, 프레임 2의 정적 카메라 비교가
    // 실패해 비항등 재투영이 TAA/MB에 유입된다 (부팅≠reset 상태 결함의 진범, E5b 실측)
    cam.aspect = this._size.x / this._size.y;
    cam.updateProjectionMatrix();
    // CSM 캐스케이드 절두체는 fov/aspect의 함수 — setSize 시점(프리웜 잔여 1.6·fov 70)에
    // 고정되면 샷 fov와 무관한 분할이 그림자 텍셀 밀도를 결정한다 (C2 검토).
    // 반드시 csm.update()(광원 행렬 산출) **앞**에서 갱신한다: 뒤에서 갱신하면 샷 전환 후 첫 프레임의
    // 그림자가 직전 샷의 분할로 그려져 '첫 프레임 ≠ 재실행 첫 프레임'이 된다 (rendervariance frames=1
    // 실측: fov가 바뀐 샷마다 반복 1회차만 해시 이탈 — C3 교정)
    if (cam.fov !== this._csmFov || cam.aspect !== this._csmAspect) {
      this.csm.updateFrustums();
      this._csmFov = cam.fov; this._csmAspect = cam.aspect;
    }
    this.csm.update();
    this.renderer.shadowMap.needsUpdate = true; // 프레임당 1회 (renderPass 내부에서 소비)

    // 비지터 VP → 재투영 행렬 (현재 클립 → 이전 클립).
    this._curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (this._hasPrev) {
      // 정적 카메라(캡처): prevVP == curVP이면 정확한 항등으로 스냅 — 역행렬의
      // fp 오차(~1e-7)가 prevUv를 텍셀 중심에서 밀어내 히스토리 샘플을 경계
      // 민감하게 만드는 것을 차단한다 (결정성 시드 제거, E3 실측)
      let staticCam = true;
      const a = this._curVP.elements, b = this._prevVP.elements;
      for (let i = 0; i < 16; i++) if (a[i] !== b[i]) { staticCam = false; break; }
      if (staticCam) {
        this._reproj.identity();
      } else {
        this._invVP.copy(this._curVP).invert();
        this._reproj.multiplyMatrices(this._prevVP, this._invVP);
      }
    } else {
      this._reproj.identity();
    }

    // TAA 지터 (시뮬 프레임 인덱스 — 결정적)
    const j0 = JITTER[clock.frame % JITTER.length];
    // 결함 주입(음성 테스트): 리셋과 무관한 카운터로 서브픽셀 지터를 흔들어 '같은 입력 → 다른 HDR 프레임'을 만든다
    const j = this.debugDrift ? [j0[0] + 1e-3 * (this._renderCount % 5), j0[1]] : j0;
    this._renderCount++;
    this.lastJitter = j;
    cam.setViewOffset(this._size.x, this._size.y, j[0], j[1], this._size.x, this._size.y);

    // 1. 씬(HDR+깊이) → sceneRT, GTAO 합성 → aoRT (패스별 계측 포함)
    const info = this.renderer.info.render;
    const c0 = info.calls, t0 = info.triangles;
    this.renderPass.render(this.renderer, this.aoRT, this.sceneRT, 0, false); // 3번째 인자에 그린다
    const c1 = info.calls, t1 = info.triangles;
    this.gtao.render(this.renderer, this.aoRT, this.sceneRT, 0, false); // sceneRT를 읽어 aoRT에 합성
    const c2 = info.calls, t2 = info.triangles;
    this.passStats.shadowBeauty = [c1 - c0, t1 - t0];
    this.passStats.gtao = [c2 - c1, t2 - t1];
    // GTAO 델타 = 노멀 프리패스(뷰티와 동일 컬링의 순수 씬 1패스, 메시 전용)
    //           + 풀스크린 삼각형 4콜(AO 추정·PD 디노이즈·복사·블렌드, 각 1tri)
    // → 단일 씬 패스 지표. 한계: Points/Line/Sprite는 프리패스에서 숨겨져 미포함
    //   (FX 예산으로 별도 상한 — CONTRACT-NOTES P3 판정 참조)
    this.passStats.scenePass = [c2 - c1 - 4, t2 - t1 - 4];
    let beauty = this.aoRT;

    // 1.5 C2 볼류메트릭 안개·광선 → fogRT (sky가 주입된 뒤 항상 실행 —
    // 패스 구조를 프레임마다 동일하게 유지해 프로그램·계측 순열을 고정한다)
    if (this.sky) {
      const s0 = this.csm.lights[0].shadow;
      this._invVPFog.copy(this._curVP).invert();
      this.sky.fogPass.update({
        tDiffuse: beauty.texture, tDepth: this.sceneRT.depthTexture, fog: this.sky.fog,
        camPos: cam.position, sunDir: this.sky.sunDir, invVP: this._invVPFog,
        shadow: s0, frame: clock.frame,
      });
      this._blit(this.sky.fogPass.material, this.fogRT);
      beauty = this.fogRT;
    }

    // 2. TAA 리졸브 → taaRT[write] (이 RT가 다음 프레임 히스토리)
    const readHist = this.taaRT[1 - this.taaWrite];
    const writeHist = this.taaRT[this.taaWrite];
    this.taaMat.uniforms.tDiffuse.value = beauty.texture;
    this.taaMat.uniforms.tHistory.value = readHist.texture;
    this.taaMat.uniforms.reproj.value.copy(this._reproj);
    this.taaMat.uniforms.historyValid.value = this.historyValid && this._hasPrev ? 1 : 0;
    this._blit(this.taaMat, writeHist);

    // 3. 카메라 모션블러 → mbRT (정적 카메라 = 항등)
    this.mbMat.uniforms.tDiffuse.value = writeHist.texture;
    this.mbMat.uniforms.reproj.value.copy(this._reproj);
    this._blit(this.mbMat, this.mbRT);

    // 4. C4 노출 미터(3 소형 패스) + 블룸(6 소형 패스) — 둘 다 모션블러 출력(HDR, 노출 전)을 읽는다
    this.exposure.render(this.mbRT.texture, this._size.x, this._size.y, clock.dt);
    this.bloom.render(this.mbRT.texture, this.exposure.texture, this.exposure.ec);

    // 5. 출력: 노출 × HDR + 블룸 → AgX → sRGB → 그레이드 LUT → 화면 (감사 상태는 sRGB만)
    const ou = this.outputMat.uniforms;
    ou.tDiffuse.value = this.mbRT.texture;
    ou.tBloom.value = this.bloom.texture;
    ou.tAdapt.value = this.exposure.texture;
    ou.ec.value = this.exposure.ec;
    ou.toneMode.value = this.renderer.toneMapping === THREE.NoToneMapping ? 0 : 1;
    this._blit(this.outputMat, null);
    this.passStats.post = [info.calls - c2, info.triangles - t2];

    cam.clearViewOffset();
    this.taaWrite = 1 - this.taaWrite;
    this.historyValid = true;
    this._prevVP.copy(this._curVP);
    this._hasPrev = true;
  }
}
