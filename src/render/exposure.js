/**
 * src/render/exposure.js — C4 EV100 자동 노출 미터 (P3-BRIEF §3 C4, ARCHITECTURE §1 src/render "EV100 미터링").
 *
 * 체인(프레임당 3 소형 패스): HDR 프레임(모션블러 출력) → [meter] 64×64 로그휘도(셀당 4×4 탭)
 *   → [reduce] 8×8 중앙가중 합 → [adapt] 1×1 적응 상태(핑퐁). 출력·블룸 패스가 이 1×1을 읽어 노출 계수를 만든다.
 *
 * 산식(Lagarde & de Rousiers 2014 §5): EV100 = log2(L_avg · S/K), S=100, K=12.5 → log2(8·L_avg).
 *   노출 H = 1 / (1.2 · 2^(EV100 − EC)). EC(노출 보정, EV)·EV 하한 무릎(evMin 아래 기울기 kneeSlope)·
 *   상한·적응 속도는 미학 파라미터 — 값과 실측 근거는 CONTRACT-NOTES C4 기록.
 *
 * 결정성 규약:
 *  - 입력은 프레임 텍스처·clock.dt(fixed 1/60 상수)·상수뿐. GPU 축소는 고정 순서 루프 —
 *    하드웨어 밉맵·블렌딩·선형 필터에 의존하지 않는다 (샘플 UV는 텍셀 중심으로 스냅).
 *  - 적응 상태는 GPU 상태(TAA 히스토리와 동급): reset()이 스냅 플래그를 세워 다음 프레임이
 *    목표값으로 점프한다. 부팅 후 pipeline.reset() 경로로 부팅 상태 ≡ resetState 상태.
 *  - 미터 가중: 중앙 1.0 → 모서리 centerWeight (FPS 시선 중심 우선 — 역광 실내→마당 샷의 의도).
 */

import * as THREE from 'three';

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const METER_N = 64;
const REDUCE_N = 8;

/** 셀당 4×4 탭 로그휘도 평균 — 소스 텍셀 중심 스냅(NearestFilter RT와 일치) */
const METER_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 srcSize;
  void main() {
    vec2 cellOrigin = vUv - 0.5 / ${METER_N}.0;
    float sum = 0.0;
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec2 uv = cellOrigin + (vec2(float(i), float(j)) + 0.5) / (${METER_N}.0 * 4.0);
      uv = (floor(uv * srcSize) + 0.5) / srcSize;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float lum = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
      sum += log2(max(lum, 1e-4));
    }
    gl_FragColor = vec4(sum / 16.0, 0.0, 0.0, 1.0);
  }
`;

/** 64×64 → 8×8: 텍셀당 8×8 셀의 중앙가중 합 (R=Σw·logL, G=Σw) */
const REDUCE_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tLum;
  uniform float centerWeight;
  void main() {
    vec2 origin = vUv - 0.5 / ${REDUCE_N}.0;
    float sum = 0.0, sumW = 0.0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
      vec2 uv = origin + (vec2(float(i), float(j)) + 0.5) / (${REDUCE_N}.0 * 8.0);
      vec2 d = uv * 2.0 - 1.0;
      float r2 = clamp(dot(d, d) * 0.5, 0.0, 1.0);
      float w = mix(1.0, centerWeight, r2);
      sum += texture2D(tLum, uv).r * w;
      sumW += w;
    }
    gl_FragColor = vec4(sum, sumW, 0.0, 1.0);
  }
`;

/** 8×8 → 1×1 적응: R=적응 EV100, G=목표 EV100(클램프 후), B=L_avg, A=1 */
const ADAPT_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSum;
  uniform sampler2D tPrev;
  uniform float dt, rateUp, rateDown, evMin, evMax, snap, kneeSlope;
  void main() {
    float sum = 0.0, sumW = 0.0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
      vec2 s = texture2D(tSum, (vec2(float(i), float(j)) + 0.5) / 8.0).rg;
      sum += s.r; sumW += s.g;
    }
    float lavg = exp2(sum / sumW);
    // 하한은 무릎(knee): evMin 아래로는 기울기 kneeSlope로만 적응 — 어두운 장면(야간·실내)이 중회색으로
    // 끌려 올라가지 않으면서도 완전히 묻히지 않는다 (하드 클램프는 실내 주간 샷을 야간처럼 만들었다 — 스윕4)
    float target = log2(8.0 * lavg);
    target = target < evMin ? evMin + (target - evMin) * kneeSlope : target;
    target = clamp(target, evMin - 3.0, evMax);
    float prev = texture2D(tPrev, vec2(0.5)).r;
    float ev = target;
    if (snap < 0.5) {
      float rate = target > prev ? rateUp : rateDown;
      ev = prev + (target - prev) * (1.0 - exp(-dt * rate));
    }
    gl_FragColor = vec4(ev, target, lavg, 1.0);
  }
`;

function fsMaterial(name, frag, uniforms) {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  m.name = name;
  return m;
}

/** 노출 계수 (CPU 판독 보조 — 셰이더의 exposureOf와 동일 산식) */
export function exposureOf(ev100, ec) {
  return 1 / (1.2 * 2 ** (ev100 - ec));
}

export class ExposureMeter {
  /**
   * @param {{renderer: THREE.WebGLRenderer, blit: (material, target) => void, params?: object}} o
   * params: { ec, evMin, evMax, rateUp, rateDown, centerWeight }
   */
  constructor({ renderer, blit, params = {} }) {
    this.renderer = renderer;
    this._blit = blit;
    this.params = {
      ec: 0.0, evMin: -4, evMax: 16, kneeSlope: 0.5, rateUp: 3.0, rateDown: 1.5, centerWeight: 0.35,
      ...params,
    };
    const mk = (n, type) => new THREE.WebGLRenderTarget(n, n, {
      type, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.lumRT = mk(METER_N, THREE.HalfFloatType);
    this.sumRT = mk(REDUCE_N, THREE.HalfFloatType);
    this.adaptRT = [mk(1, THREE.FloatType), mk(1, THREE.FloatType)]; // Float: readRenderTargetPixels 직접 판독
    this._write = 0;
    this._snap = true;

    this.meterMat = fsMaterial('C4_EXPOSURE_METER', METER_FRAG, {
      tDiffuse: { value: null }, srcSize: { value: new THREE.Vector2(1, 1) },
    });
    this.reduceMat = fsMaterial('C4_EXPOSURE_REDUCE', REDUCE_FRAG, {
      tLum: { value: this.lumRT.texture }, centerWeight: { value: this.params.centerWeight },
    });
    this.adaptMat = fsMaterial('C4_EXPOSURE_ADAPT', ADAPT_FRAG, {
      tSum: { value: this.sumRT.texture }, tPrev: { value: null },
      dt: { value: 1 / 60 }, rateUp: { value: this.params.rateUp }, rateDown: { value: this.params.rateDown },
      evMin: { value: this.params.evMin }, evMax: { value: this.params.evMax }, snap: { value: 1 },
      kneeSlope: { value: this.params.kneeSlope },
    });
  }

  /** 현재 적응 상태 텍스처 (직전 render()가 쓴 1×1) */
  get texture() { return this.adaptRT[1 - this._write].texture; }

  /** 노출 보정 EV (출력·블룸 패스가 같은 값을 쓴다) */
  get ec() { return this.params.ec; }

  /** 적응 상태 무효화 — 다음 프레임은 목표값에 스냅 (resetState·부팅 종료) */
  reset() { this._snap = true; }

  /**
   * 프레임당 1회 — src: HDR 프레임 텍스처(NearestFilter), srcW/H: 그 크기, dt: clock.dt
   */
  render(src, srcW, srcH, dt) {
    // 파라미터는 매 프레임 반영 (조정 프로브가 params를 바꿀 수 있다 — 유니폼 복사 비용은 무시 가능)
    const p = this.params, a = this.adaptMat.uniforms;
    a.rateUp.value = p.rateUp; a.rateDown.value = p.rateDown; a.evMin.value = p.evMin; a.evMax.value = p.evMax;
    a.kneeSlope.value = p.kneeSlope;
    this.reduceMat.uniforms.centerWeight.value = p.centerWeight;
    this.meterMat.uniforms.tDiffuse.value = src;
    this.meterMat.uniforms.srcSize.value.set(srcW, srcH);
    this._blit(this.meterMat, this.lumRT);
    this._blit(this.reduceMat, this.sumRT);
    const u = this.adaptMat.uniforms;
    u.tPrev.value = this.adaptRT[1 - this._write].texture;
    u.dt.value = dt;
    u.snap.value = this._snap ? 1 : 0;
    this._blit(this.adaptMat, this.adaptRT[this._write]);
    this._write = 1 - this._write;
    this._snap = false;
  }

  /** 계측 판독 (동기 readback — 하네스 getExposure 전용, 프레임 경로 금지) */
  read() {
    const buf = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.adaptRT[1 - this._write], 0, 0, 1, 1, buf);
    const ev100 = buf[0];
    return {
      ev100: +ev100.toFixed(4), evTarget: +buf[1].toFixed(4), avgLum: +buf[2].toFixed(5),
      ec: this.params.ec, exposure: +exposureOf(ev100, this.params.ec).toFixed(5),
      valid: buf[3] > 0.5,
    };
  }
}
