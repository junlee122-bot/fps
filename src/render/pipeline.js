/**
 * src/render/pipeline.js — C1 렌더 파이프라인 뼈대 (P3-BRIEF §3).
 *
 * 체인: HDR(HalfFloat) 씬 렌더(+깊이 텍스처 prepass) → GTAO → TAA 리졸브
 * → 카메라 모션블러 → AgX 톤매핑 + sRGB (OutputPass). 태양 그림자는 CSM 3캐스케이드.
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
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { clock } from '../core/clock.js';

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

    renderer.toneMapping = THREE.AgXToneMapping; // C1: AgX. 노출·그레이드는 C4
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
    this.outputPass = new OutputPass();
    this.outputPass.renderToScreen = true;

    this._prevVP = new THREE.Matrix4();
    this._curVP = new THREE.Matrix4();
    this._reproj = new THREE.Matrix4();
    this._invVP = new THREE.Matrix4();
    this._hasPrev = false;
    this._fakeRead = { texture: null }; // OutputPass.render(readBuffer) 인터페이스
    /** 패스별 콜·삼각형 분해 (지표 의미 판정용 — renderFrame이 stats에 전달) */
    this.passStats = { shadowBeauty: [0, 0], gtao: [0, 0], post: [0, 0], scenePass: [0, 0] };
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

  /** 태양 구성 (elev/azim 도, intensity) — applySunConfig가 호출 */
  setSun({ elev, azim, intensity }) {
    const el = THREE.MathUtils.degToRad(elev);
    const az = THREE.MathUtils.degToRad(azim);
    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);
    this.csm.lightDirection.set(-x, -y, -z).normalize();
    for (const l of this.csm.lights) l.intensity = intensity;
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
    this._size.set(w, h);
    this.taaMat.uniforms.resolution.value.set(w, h);
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
    this.csm.update();
    this.renderer.shadowMap.needsUpdate = true; // 프레임당 1회 (renderPass 내부에서 소비)

    // 비지터 VP → 재투영 행렬 (현재 클립 → 이전 클립)
    cam.updateProjectionMatrix();
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
    const j = JITTER[clock.frame % JITTER.length];
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
    const beauty = this.aoRT;

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

    // 4. AgX 톤매핑 + sRGB → 화면
    this._fakeRead.texture = this.mbRT.texture;
    this.outputPass.render(this.renderer, null, this._fakeRead, 0, false);
    this.passStats.post = [info.calls - c2, info.triangles - t2];

    cam.clearViewOffset();
    this.taaWrite = 1 - this.taaWrite;
    this.historyValid = true;
    this._prevVP.copy(this._curVP);
    this._hasPrev = true;
  }
}
