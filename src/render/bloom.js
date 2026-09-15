/**
 * src/render/bloom.js — C4 블룸 (ARCHITECTURE §1 src/render "블룸"; 샷 6 lantern_night '자발광·블룸').
 *
 * 체인(프레임당 6 소형 패스): 노출 적용 밝기 추출 → 1/4 (4탭) → 1/8 (4탭 박스) → 가우시안 9탭 H/V ×2회.
 * 출력 패스가 1/8 텍스처를 수동 쌍선형으로 업샘플해 가산한다 (출력 셰이더 sampleBilinear).
 *
 * 결정성: 모든 RT NearestFilter + 명시 탭(정수 텍셀 오프셋) — 하드웨어 선형 필터의 경계 가중치
 * (텍셀 경계 정확히 0.5/0.5)에 의존하지 않는다 (C1 TAA 히스토리 교훈). 시간 입력 없음.
 * 임계값은 **노출 적용 후** 공간에서 판정한다 — 화면에서 밝은 것만 번진다 (적응 상태 tAdapt 판독).
 */

import * as THREE from 'three';

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** 풀해상도 → 1/4: 4탭(간격 2텍셀) 평균 후 노출·소프트 임계 */
const BRIGHT_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tAdapt;
  uniform vec2 srcSize;
  uniform float ec, threshold, knee;
  void main() {
    vec2 base = floor(vUv * srcSize) + 0.5; // 이 1/4 텍셀에 대응하는 소스 4×4 블록의 중심 근방
    vec3 c = vec3(0.0);
    c += texture2D(tDiffuse, (base + vec2(-1.0, -1.0)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2( 1.0, -1.0)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2(-1.0,  1.0)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2( 1.0,  1.0)) / srcSize).rgb;
    c = max(c * 0.25, vec3(0.0));
    float ev = texture2D(tAdapt, vec2(0.5)).r;
    c *= 1.0 / (1.2 * exp2(ev - ec));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = threshold * knee;
    float soft = clamp(l - threshold + k, 0.0, 2.0 * k);
    soft = soft * soft / (4.0 * k + 1e-5);
    float contrib = max(soft, l - threshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * contrib, 1.0);
  }
`;

/** 2× 다운샘플 — 4탭 박스 (텍셀 중심 명시) */
const DOWN_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 srcSize;
  void main() {
    vec2 base = floor(vUv * srcSize) + 0.5;
    vec3 c = vec3(0.0);
    c += texture2D(tDiffuse, (base + vec2(-0.5, -0.5)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2( 0.5, -0.5)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2(-0.5,  0.5)) / srcSize).rgb;
    c += texture2D(tDiffuse, (base + vec2( 0.5,  0.5)) / srcSize).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

/** 분리 가우시안 9탭 (σ≈2.2 텍셀) — dir=(1,0)/(0,1) 텍셀 단위 */
const BLUR_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  uniform vec2 dir;
  void main() {
    const float w0 = 0.20236, w1 = 0.17967, w2 = 0.12570, w3 = 0.06928, w4 = 0.03004; // Σ=1.0 (정규화)
    vec3 c = texture2D(tDiffuse, vUv).rgb * w0;
    c += (texture2D(tDiffuse, vUv + dir * texel * 1.0).rgb + texture2D(tDiffuse, vUv - dir * texel * 1.0).rgb) * w1;
    c += (texture2D(tDiffuse, vUv + dir * texel * 2.0).rgb + texture2D(tDiffuse, vUv - dir * texel * 2.0).rgb) * w2;
    c += (texture2D(tDiffuse, vUv + dir * texel * 3.0).rgb + texture2D(tDiffuse, vUv - dir * texel * 3.0).rgb) * w3;
    c += (texture2D(tDiffuse, vUv + dir * texel * 4.0).rgb + texture2D(tDiffuse, vUv - dir * texel * 4.0).rgb) * w4;
    gl_FragColor = vec4(c, 1.0);
  }
`;

function fsMaterial(name, frag, uniforms) {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  m.name = name;
  return m;
}

export class BloomPass {
  /** @param {{blit: (material, target) => void, params?: {threshold, knee, iterations}}} o */
  constructor({ blit, params = {} }) {
    this._blit = blit;
    this.params = { threshold: 1.0, knee: 0.5, iterations: 2, ...params };
    const mk = (w, h) => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.quarterRT = mk(1, 1);
    this.eighthRT = [mk(1, 1), mk(1, 1)];
    this.size = new THREE.Vector2(1, 1);   // 1/8 텍스처 크기 (출력 패스 업샘플용)
    this.brightMat = fsMaterial('C4_BLOOM_BRIGHT', BRIGHT_FRAG, {
      tDiffuse: { value: null }, tAdapt: { value: null }, srcSize: { value: new THREE.Vector2(1, 1) },
      ec: { value: 0 }, threshold: { value: this.params.threshold }, knee: { value: this.params.knee },
    });
    this.downMat = fsMaterial('C4_BLOOM_DOWN', DOWN_FRAG, {
      tDiffuse: { value: null }, srcSize: { value: new THREE.Vector2(1, 1) },
    });
    this.blurMat = fsMaterial('C4_BLOOM_BLUR', BLUR_FRAG, {
      tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1, 1) }, dir: { value: new THREE.Vector2(1, 0) },
    });
    /** 풀스크린 등가 비용 (1/16 + 1/64 + 4/64) — 계측 보고용 */
    this.fullscreenEq = 1 / 16 + 1 / 64 + (2 * this.params.iterations) / 64;
  }

  /** 출력 텍스처 (1/8 해상도, 블러 완료) */
  get texture() { return this.eighthRT[0].texture; }

  setSize(w, h) {
    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    const ew = Math.max(1, Math.floor(w / 8)), eh = Math.max(1, Math.floor(h / 8));
    this.quarterRT.setSize(qw, qh);
    for (const rt of this.eighthRT) rt.setSize(ew, eh);
    this.size.set(ew, eh);
    this.brightMat.uniforms.srcSize.value.set(w, h);
    this.downMat.uniforms.srcSize.value.set(qw, qh);
    this.blurMat.uniforms.texel.value.set(1 / ew, 1 / eh);
  }

  /** 프레임당 1회 — src: HDR 프레임, adaptTex: 노출 적응 1×1, ec: 노출 보정 */
  render(src, adaptTex, ec) {
    this.brightMat.uniforms.tDiffuse.value = src;
    this.brightMat.uniforms.tAdapt.value = adaptTex;
    this.brightMat.uniforms.ec.value = ec;
    this._blit(this.brightMat, this.quarterRT);
    this.downMat.uniforms.tDiffuse.value = this.quarterRT.texture;
    this._blit(this.downMat, this.eighthRT[0]);
    const u = this.blurMat.uniforms;
    for (let i = 0; i < this.params.iterations; i++) {
      u.tDiffuse.value = this.eighthRT[0].texture; u.dir.value.set(1, 0);
      this._blit(this.blurMat, this.eighthRT[1]);
      u.tDiffuse.value = this.eighthRT[1].texture; u.dir.value.set(0, 1);
      this._blit(this.blurMat, this.eighthRT[0]);
    }
  }
}
