/**
 * src/render/exposure.js — C4 EV100 자동 노출 미터 (P3-BRIEF §3 C4, ARCHITECTURE §1 src/render "EV100 미터링").
 *
 * 체인(프레임당 3 소형 패스): HDR 프레임(모션블러 출력) → [meter] 64×64 로그휘도(셀당 4×4 탭)
 *   → [reduce] 8×8 중앙가중 합 → [adapt] 1×1 적응 상태(핑퐁). 출력·블룸 패스가 이 1×1을 읽어 노출 계수를 만든다.
 *
 * 산식(Lagarde & de Rousiers 2014 §5): EV100 = log2(L_avg · S/K), S=100, K=12.5 → log2(8·L_avg).
 *   노출 H = 1 / (1.2 · 2^(EV100 − EC)). EC(노출 보정, EV)·EV 하한 무릎(evMin 아래 기울기 kneeSlope)·
 *   상한·적응 속도·계량 격자는 **동결 계약** `render/exposure-contract.js` 가 단일 출처다(P4B 설계서 §9).
 *
 * 계약 규약 (P4B §9-2·9-3·9-5):
 *  - 값은 이 파일에 리터럴로 쓰지 않는다. 유니폼 값은 매 프레임 `_applyContract()` 가 계약(+ testOverride 층)에서 쓰고,
 *    셰이더 상수(격자·탭·목표식 계수·하드 하한 오프셋)는 `buildExposureShaders()` 템플릿으로 주입한다.
 *    params 주입 경로는 폐지했다(넘기면 throw) — "조정 프로브가 params를 바꿀 수 있다"는 종전 경로가 계약을 우회했다.
 *  - `this.params` 는 계약의 평탄 frozen 뷰다. `window.__pipeline` 을 거친 대입은 비엄격 문맥(page.evaluate)에서 조용히
 *    무시되고 그리기 값은 바뀌지 않는다. 유니폼을 직접 쓰는 경로는 `contractCheck()` 가 그리기 시점 값으로 잡는다.
 *  - **그리기 시점 기록**: 드로우 직전에 그 드로우에 묶인 유니폼 값을 `_drawn` 에 복사한다(미터는 reduce·adapt 직전,
 *    ec 는 미터가 아니라 블룸·출력에서 쓰이므로 파이프라인이 그 두 드로우 직전에 `noteDrawnEc` 로 남긴다).
 *    "현재 유니폼 대 계약" 대조는 계약을 쓴 직후라 항등이다 — 실제로 그려진 값을 본다.
 *  - 측정 잠금 `lock(ev)`/`unlock()` 은 ADAPT 유니폼(lockOn·lockEv)이라 프로그램 수 불변. 후보 값은 testOverride 층
 *    (`setTestOverride`)으로만 넣고 `contractCheck()` 가 일부러 잡는다(ok=false). `reset()` = unlock + 층 해제 + 스냅.
 *
 * 결정성 규약:
 *  - 입력은 프레임 텍스처·clock.dt(fixed 1/60 상수)·상수뿐. GPU 축소는 고정 순서 루프 —
 *    하드웨어 밉맵·블렌딩·선형 필터에 의존하지 않는다 (샘플 UV는 텍셀 중심으로 스냅).
 *  - 적응 상태는 GPU 상태(TAA 히스토리와 동급): reset()이 스냅 플래그를 세워 다음 프레임이
 *    목표값으로 점프한다. 부팅 후 pipeline.reset() 경로로 부팅 상태 ≡ resetState 상태.
 *  - 미터 가중: 중앙 1.0 → 모서리 centerWeight (FPS 시선 중심 우선 — 역광 실내→마당 샷의 의도).
 */

import * as THREE from 'three';
import { EXPOSURE_CONTRACT, exposureContractHash } from './exposure-contract.js';

/** 유니폼으로 매 프레임 쓰는 계약 키(평탄 이름 → 계약 경로). testOverride 층은 이 키만 덮을 수 있다 */
export const EXPOSURE_UNIFORM_KEYS = Object.freeze({
  evMin: Object.freeze(['range', 'evMin']),
  evMax: Object.freeze(['range', 'evMax']),
  kneeSlope: Object.freeze(['range', 'kneeSlope']),
  rateUp: Object.freeze(['speed', 'rateUp']),
  rateDown: Object.freeze(['speed', 'rateDown']),
  ec: Object.freeze(['metering', 'ec']),
  centerWeight: Object.freeze(['metering', 'centerWeight']),
});
/** 셰이더 템플릿 상수 — 재컴파일 없이는 바뀌지 않으므로 testOverride 대상이 아니다 */
export const EXPOSURE_TEMPLATE_KEYS = Object.freeze({
  floorOffset: Object.freeze(['range', 'floorOffset']),
  k: Object.freeze(['metering', 'k']),
  meterN: Object.freeze(['metering', 'meterN']),
  reduceN: Object.freeze(['metering', 'reduceN']),
  tapsPerAxis: Object.freeze(['metering', 'tapsPerAxis']),
});
/** 1×1 적응 패스의 화소 수 (passPixels 의 마지막 항) */
const ADAPT_PIXELS = 1;
/** 미터 드로우(reduce·adapt)에 묶이는 계약 유니폼 — ec 는 블룸·출력 드로우에서 따로 기록한다 */
const METER_DRAWN_KEYS = Object.freeze(['rateUp', 'rateDown', 'evMin', 'evMax', 'kneeSlope', 'centerWeight']);
/** ec 를 읽는 드로우 — 블룸 밝기 추출(bloom.js BRIGHT_FRAG)·출력(output.js) */
export const EC_DRAW_PASSES = Object.freeze(['bloom', 'output']);

/** 계약 객체 → 평탄 frozen 뷰 {evMin, …, tapsPerAxis} (경로 표 두 개가 키를 소유한다) */
export function flattenContract(contract = EXPOSURE_CONTRACT) {
  const out = {};
  for (const [k, [grp, key]] of [...Object.entries(EXPOSURE_UNIFORM_KEYS), ...Object.entries(EXPOSURE_TEMPLATE_KEYS)]) {
    const v = contract[grp]?.[key];
    if (!Number.isFinite(v)) throw new Error(`exposure: 계약 ${grp}.${key} 가 유한수가 아니다 (got ${v})`);
    out[k] = v;
  }
  return Object.freeze(out);
}

/** GLSL 실수 리터럴 — 정수는 `N.0`, 지수 표기는 GLSL ES 1.0 이식성 때문에 거부 */
function glslFloat(v) {
  const s = Number.isInteger(v) ? `${v}.0` : String(v);
  if (!Number.isFinite(v) || /e/i.test(s)) throw new Error(`exposure: GLSL 실수 리터럴로 쓸 수 없는 값 ${v}`);
  return s;
}
/** GLSL 루프 상한 — 양의 정수만 (WebGL1 루프는 상수 상한이어야 한다) */
function glslInt(v) {
  if (!Number.isInteger(v) || v < 1) throw new Error(`exposure: GLSL 루프 상한은 양의 정수여야 한다 (got ${v})`);
  return String(v);
}

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * 계약 → 미터 3패스 프래그먼트 셰이더 문자열. 같은 계약 → 같은 문자열(contractCheck 가 머티리얼의
 * 컴파일 대상 문자열과 다시 만든 이 문자열을 대조한다). 템플릿 자리 밖의 리터럴은 계약과 무관한 산식 상수다
 * (휘도 가중 Rec.709, 로그 하한, 텍셀 중심 0.5, 중앙가중 거리 정규화 등).
 */
export function buildExposureShaders(contract = EXPOSURE_CONTRACT) {
  const p = flattenContract(contract);
  if (p.meterN % p.reduceN !== 0) throw new Error(`exposure: meterN ${p.meterN} 이 reduceN ${p.reduceN} 의 배수가 아니다`);
  const cells = p.meterN / p.reduceN; // 축소 텍셀 하나가 덮는 미터 셀 수(축당)
  const N = glslFloat(p.meterN), R = glslFloat(p.reduceN), C = glslFloat(cells), T = glslFloat(p.tapsPerAxis);
  const tapLoop = glslInt(p.tapsPerAxis), cellLoop = glslInt(cells), reduceLoop = glslInt(p.reduceN);

  /** 셀당 tapsPerAxis² 탭 로그휘도 평균 — 소스 텍셀 중심 스냅(NearestFilter RT와 일치) */
  const meter = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 srcSize;
  void main() {
    vec2 cellOrigin = vUv - 0.5 / ${N};
    float sum = 0.0;
    for (int j = 0; j < ${tapLoop}; j++) for (int i = 0; i < ${tapLoop}; i++) {
      vec2 uv = cellOrigin + (vec2(float(i), float(j)) + 0.5) / (${N} * ${T});
      uv = (floor(uv * srcSize) + 0.5) / srcSize;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float lum = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
      sum += log2(max(lum, 1e-4));
    }
    gl_FragColor = vec4(sum / ${glslFloat(p.tapsPerAxis * p.tapsPerAxis)}, 0.0, 0.0, 1.0);
  }
`;

  /** meterN² → reduceN²: 텍셀당 cells² 셀의 중앙가중 합 (R=Σw·logL, G=Σw) */
  const reduce = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tLum;
  uniform float centerWeight;
  void main() {
    vec2 origin = vUv - 0.5 / ${R};
    float sum = 0.0, sumW = 0.0;
    for (int j = 0; j < ${cellLoop}; j++) for (int i = 0; i < ${cellLoop}; i++) {
      vec2 uv = origin + (vec2(float(i), float(j)) + 0.5) / (${R} * ${C});
      vec2 d = uv * 2.0 - 1.0;
      float r2 = clamp(dot(d, d) * 0.5, 0.0, 1.0);
      float w = mix(1.0, centerWeight, r2);
      sum += texture2D(tLum, uv).r * w;
      sumW += w;
    }
    gl_FragColor = vec4(sum, sumW, 0.0, 1.0);
  }
`;

  /** reduceN² → 1×1 적응: R=적응 EV100, G=목표 EV100(클램프 후), B=L_avg, A=1 */
  const adapt = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSum;
  uniform sampler2D tPrev;
  uniform float dt, rateUp, rateDown, evMin, evMax, snap, kneeSlope, lockOn, lockEv;
  void main() {
    float sum = 0.0, sumW = 0.0;
    for (int j = 0; j < ${reduceLoop}; j++) for (int i = 0; i < ${reduceLoop}; i++) {
      vec2 s = texture2D(tSum, (vec2(float(i), float(j)) + 0.5) / ${R}).rg;
      sum += s.r; sumW += s.g;
    }
    float lavg = exp2(sum / sumW);
    // 하한은 무릎(knee): evMin 아래로는 기울기 kneeSlope로만 적응 — 어두운 장면(야간·실내)이 중회색으로
    // 끌려 올라가지 않으면서도 완전히 묻히지 않는다 (하드 클램프는 실내 주간 샷을 야간처럼 만들었다 — 스윕4)
    float target = log2(${glslFloat(p.k)} * lavg);
    target = target < evMin ? evMin + (target - evMin) * kneeSlope : target;
    target = clamp(target, evMin - ${glslFloat(p.floorOffset)}, evMax);
    float prev = texture2D(tPrev, vec2(0.5)).r;
    float ev = target;
    if (snap < 0.5) {
      float rate = target > prev ? rateUp : rateDown;
      ev = prev + (target - prev) * (1.0 - exp(-dt * rate));
    }
    // 측정 잠금(P4B §9-5): 적응 상태만 lockEv 로 고정한다 — 목표·L_avg(G·B)는 그대로 기록해 판독이 의미를 유지한다
    if (lockOn > 0.5) ev = lockEv;
    gl_FragColor = vec4(ev, target, lavg, 1.0);
  }
`;
  return Object.freeze({ meter, reduce, adapt });
}

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
   * @param {{renderer: THREE.WebGLRenderer, blit: (material, target) => void}} o
   * 값은 받지 않는다 — 계약 단일 출처(render/exposure-contract.js). params 를 넘기면 throw(§9-2).
   */
  constructor(o) {
    if (o && 'params' in o) {
      throw new Error('ExposureMeter: params 인자는 폐지됐다 — 노출 값의 단일 출처는 render/exposure-contract.js (P4B §9-2)');
    }
    const { renderer, blit } = o;
    this.renderer = renderer;
    this._blit = blit;
    /** 계약의 평탄 frozen 뷰 (대입 불가 — 그리기 값은 _applyContract 만 정한다) */
    this.params = flattenContract(EXPOSURE_CONTRACT);
    /** testOverride 층(frozen 부분 객체) — exposureprobe 후보·debugExposureOverride 전용, contractCheck 가 ok=false 로 잡는다 */
    this._override = null;
    /** 매 프레임 유니폼에 쓰는 값 = 계약 ⊕ testOverride (층이 바뀔 때만 다시 만든다 — 프레임 경로 무할당) */
    this._eff = this.params;
    /** 측정 잠금 상태 — 다음 adapt 드로우부터 적응 상태를 ev 로 고정 */
    this._lock = { on: false, ev: 0 };
    /** 그리기 시점 기록: 직전 드로우에 실제로 묶였던 값 (contractCheck 의 대조 대상) */
    this._drawn = {
      frames: 0, rateUp: null, rateDown: null, evMin: null, evMax: null, kneeSlope: null, centerWeight: null,
      lockOn: null, lockEv: null, ec: { bloom: null, output: null },
    };
    const p = this.params;
    /** 프레임당 미터 패스 화소 수(meterN² + reduceN² + 1) — 파이프라인 풀스크린 등가 계측용 */
    this.passPixels = p.meterN * p.meterN + p.reduceN * p.reduceN + ADAPT_PIXELS;

    const mk = (n, type) => new THREE.WebGLRenderTarget(n, n, {
      type, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.lumRT = mk(p.meterN, THREE.HalfFloatType);
    this.sumRT = mk(p.reduceN, THREE.HalfFloatType);
    this.adaptRT = [mk(1, THREE.FloatType), mk(1, THREE.FloatType)]; // Float: readRenderTargetPixels 직접 판독
    this._write = 0;
    this._snap = true;

    const sh = buildExposureShaders(EXPOSURE_CONTRACT);
    this.meterMat = fsMaterial('C4_EXPOSURE_METER', sh.meter, {
      tDiffuse: { value: null }, srcSize: { value: new THREE.Vector2(1, 1) },
    });
    this.reduceMat = fsMaterial('C4_EXPOSURE_REDUCE', sh.reduce, {
      tLum: { value: this.lumRT.texture }, centerWeight: { value: p.centerWeight },
    });
    this.adaptMat = fsMaterial('C4_EXPOSURE_ADAPT', sh.adapt, {
      tSum: { value: this.sumRT.texture }, tPrev: { value: null },
      dt: { value: 1 / 60 }, rateUp: { value: p.rateUp }, rateDown: { value: p.rateDown },
      evMin: { value: p.evMin }, evMax: { value: p.evMax }, snap: { value: 1 },
      kneeSlope: { value: p.kneeSlope }, lockOn: { value: 0 }, lockEv: { value: 0 },
    });
  }

  /** 현재 적응 상태 텍스처 (직전 render()가 쓴 1×1) */
  get texture() { return this.adaptRT[1 - this._write].texture; }

  /** 노출 보정 EV (출력·블룸 패스가 같은 값을 쓴다) — 계약 ⊕ testOverride */
  get ec() { return this._eff.ec; }

  /** 적응 상태 무효화 — 다음 프레임은 목표값에 스냅 (resetState·부팅 종료). 잠금·testOverride 층도 해제한다(§9-5) */
  reset() {
    this.unlock();
    this.clearTestOverride();
    this._snap = true;
  }

  /** 측정 잠금 — 다음 adapt 드로우부터 적응 EV100 을 ev 로 고정 (잠근 도구는 measurement 를 남긴다, PATCH-015-E) */
  lock(ev) {
    if (!Number.isFinite(ev)) throw new Error(`exposure.lock: EV100 은 유한수여야 한다 (got ${ev})`);
    this._lock.on = true;
    this._lock.ev = ev;
  }

  unlock() {
    this._lock.on = false;
    this._lock.ev = 0;
  }

  /**
   * testOverride 층 — 유니폼 계약 키의 부분 덮어쓰기(후보 실측 전용). 템플릿 상수는 재컴파일 없이는 바뀌지 않으므로 거부.
   * 활성 동안 contractCheck().ok 는 false 다(값이 계약과 같아도) — 후보로 찍은 화면이 계약 판정에 섞이지 않게.
   */
  setTestOverride(partial) {
    const keys = partial && typeof partial === 'object' ? Object.keys(partial) : [];
    if (keys.length === 0) throw new Error('exposure.setTestOverride: 키가 하나 이상인 객체여야 한다 (해제는 clearTestOverride)');
    for (const k of keys) {
      if (k in EXPOSURE_TEMPLATE_KEYS) throw new Error(`exposure.setTestOverride: ${k} 는 셰이더 템플릿 상수 — 재컴파일 없이 바꿀 수 없다`);
      if (!(k in EXPOSURE_UNIFORM_KEYS)) throw new Error(`exposure.setTestOverride: 미지 키 ${k}`);
      if (!Number.isFinite(partial[k])) throw new Error(`exposure.setTestOverride: ${k} 는 유한수여야 한다 (got ${partial[k]})`);
    }
    this._override = Object.freeze(Object.fromEntries(keys.map((k) => [k, partial[k]])));
    this._eff = Object.freeze({ ...this.params, ...this._override });
    return { ...this._override };
  }

  clearTestOverride() {
    this._override = null;
    this._eff = this.params;
  }

  /** 계약(+ testOverride 층·잠금)을 유니폼에 쓴다 — 매 프레임 render() 첫머리. 다른 경로는 유니폼을 쓰지 않는다 */
  _applyContract() {
    const e = this._eff, a = this.adaptMat.uniforms;
    a.rateUp.value = e.rateUp; a.rateDown.value = e.rateDown; a.evMin.value = e.evMin; a.evMax.value = e.evMax;
    a.kneeSlope.value = e.kneeSlope;
    a.lockOn.value = this._lock.on ? 1 : 0;
    a.lockEv.value = this._lock.ev;
    this.reduceMat.uniforms.centerWeight.value = e.centerWeight;
  }

  /** 블룸·출력 드로우 직전 ec 기록 — pipeline._blit 이 해당 머티리얼을 그리기 직전에 부른다 */
  noteDrawnEc(pass, value) {
    this._drawn.ec[pass] = value;
  }

  /**
   * 프레임당 1회 — src: HDR 프레임 텍스처(NearestFilter), srcW/H: 그 크기, dt: clock.dt
   */
  render(src, srcW, srcH, dt) {
    this._applyContract();
    this.meterMat.uniforms.tDiffuse.value = src;
    this.meterMat.uniforms.srcSize.value.set(srcW, srcH);
    this._blit(this.meterMat, this.lumRT);
    const d = this._drawn;
    d.centerWeight = this.reduceMat.uniforms.centerWeight.value; // 그리기 시점: reduce 드로우에 묶인 값
    this._blit(this.reduceMat, this.sumRT);
    const u = this.adaptMat.uniforms;
    u.tPrev.value = this.adaptRT[1 - this._write].texture;
    u.dt.value = dt;
    u.snap.value = this._snap ? 1 : 0;
    // 그리기 시점: adapt 드로우에 묶인 값 (계약을 쓴 뒤 누가 유니폼을 바꿨다면 그 값이 여기 남는다)
    d.rateUp = u.rateUp.value; d.rateDown = u.rateDown.value; d.evMin = u.evMin.value; d.evMax = u.evMax.value;
    d.kneeSlope = u.kneeSlope.value; d.lockOn = u.lockOn.value; d.lockEv = u.lockEv.value;
    d.frames++;
    this._blit(this.adaptMat, this.adaptRT[this._write]);
    this._write = 1 - this._write;
    this._snap = false;
  }

  /**
   * 런타임 일치 검사(§9-3) — 직전 프레임의 그리기 시점 값과 **컴파일 대상 셰이더 문자열**을 계약과 대조한다.
   * testOverride 층이 활성이면 ok=false. 잠금은 계약 위반이 아니라 측정 상태라 measurement 로만 보고한다.
   */
  contractCheck() {
    const want = this.params, d = this._drawn, mismatches = [];
    if (d.frames < 1) {
      mismatches.push({ key: 'drawn', reason: '그리기 기록 없음 — 미터를 1프레임 이상 그린 뒤 검사한다' });
    } else {
      for (const k of METER_DRAWN_KEYS) {
        if (!Object.is(d[k], want[k])) mismatches.push({ key: k, drawn: d[k], contract: want[k] });
      }
      for (const pass of EC_DRAW_PASSES) {
        if (!Object.is(d.ec[pass], want.ec)) mismatches.push({ key: 'ec', pass, drawn: d.ec[pass], contract: want.ec });
      }
    }
    const sh = buildExposureShaders(EXPOSURE_CONTRACT);
    for (const [mat, src] of [[this.meterMat, sh.meter], [this.reduceMat, sh.reduce], [this.adaptMat, sh.adapt]]) {
      if (mat.fragmentShader !== src) mismatches.push({ key: `shader:${mat.name}`, reason: '컴파일 대상 셰이더 문자열 ≠ 계약 템플릿' });
    }
    const overrideActive = this._override !== null;
    return {
      ok: mismatches.length === 0 && !overrideActive,
      version: EXPOSURE_CONTRACT.version,
      status: EXPOSURE_CONTRACT.status,
      hash: exposureContractHash(),
      overrideActive,
      ...(overrideActive ? { override: { ...this._override } } : {}),
      measurement: d.lockOn === 1 ? { exposure: 'locked', ev100: d.lockEv } : { exposure: 'adaptive' },
      drawnFrames: d.frames,
      drawn: {
        rateUp: d.rateUp, rateDown: d.rateDown, evMin: d.evMin, evMax: d.evMax, kneeSlope: d.kneeSlope,
        centerWeight: d.centerWeight, lockOn: d.lockOn, lockEv: d.lockEv, ec: { ...d.ec },
      },
      mismatches,
    };
  }

  /** 적응 1×1 원값 판독 [ev100, evTarget, L_avg, valid] (동기 readback — 계측 전용, 프레임 경로 금지) */
  _readAdapt() {
    const buf = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.adaptRT[1 - this._write], 0, 0, 1, 1, buf);
    return buf;
  }

  /** 적응 EV100 원값(Float32 그대로) — 동결은 반올림하지 않은 이 값으로 잠가야 같은 비트가 된다 */
  readRawEv() {
    return this._readAdapt()[0];
  }

  /** 계측 판독 (동기 readback — 하네스 getExposure 전용, 프레임 경로 금지) */
  read() {
    const buf = this._readAdapt();
    const ev100 = buf[0];
    return {
      ev100: +ev100.toFixed(4), evTarget: +buf[1].toFixed(4), avgLum: +buf[2].toFixed(5),
      ec: this._eff.ec, exposure: +exposureOf(ev100, this._eff.ec).toFixed(5),
      valid: buf[3] > 0.5,
    };
  }
}
