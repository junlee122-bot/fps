/**
 * src/render/output.js — C4 출력 패스 (AgX 톤매핑 + 노출 + 블룸 합성 + sRGB + 그레이드 LUT).
 *
 * three OutputPass를 대체한다(동일 위치·동일 역할, 화면 직결). 순서:
 *   HDR × 노출(적응 1×1 판독) → + 블룸(1/8 수동 쌍선형 업샘플) → AgX(three 청크, toneMappingExposure=1)
 *   → sRGB OETF → 3D LUT(표시 공간) → [선택 디더] → 화면.
 * 감사 상태(renderer.toneMapping === NoToneMapping, albedoaudit 리그)는 toneMode=0으로 종전 OutputPass
 * NoToneMapping 경로(sRGB OETF만)와 동일 출력 — 감사 수치가 C4 도입에 불변이어야 한다.
 *
 * GLSL3 (sampler3D). 결정성: 시간 입력 없음, 디더는 gl_FragCoord 해시(정적 패턴).
 */

import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  varying vec2 vUv;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform sampler2D tAdapt;
  uniform sampler3D tLut;
  uniform vec2 bloomSize;
  uniform float toneMode, ec, bloomStrength, lutSize, lutIntensity, ditherAmp;
  // R1 A-3: 목재·흙 대역 채도 연성 상한을 LUT가 아니라 여기서 해석적으로 건다 (grade.js GRADE_DEFAULT.band 주석).
  // 32³ LUT는 암부(v<.1, 격자 2~3칸)에서 노드 색상(0/.032/.064 조합)의 색상(hue)이 실제 픽셀과 무관해 대역 상한이
  // 작동하지 않았다 (R1 사전점검: muzzle_interior 7.2%, 위반 픽셀 전부 v≈.04~.07). uBand = [램프인 a0,a1, 램프아웃 b0,b1] (도),
  // 8비트 양자화 1LSB 여유: cap_eff = cap − 1/(255·v) — 어두울수록 상한이 강해져 반올림으로 규율(≤.35)을 넘지 않는다.
  uniform vec4 uBand; uniform float uBandCap, uBandSlope;
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = c.g < c.b ? vec4(c.bg, K.wz) : vec4(c.gb, K.xy);
    vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
    float d = q.x - min(q.w, q.y); float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // colorspace_pars_fragment(sRGBTransferOETF)는 three가 모든 프래그먼트 접두부에 주입한다 — 재포함 금지(중복 정의 컴파일 오류).
  // tonemapping_pars_fragment는 toneMapped=false 재질에는 주입되지 않으므로 여기서 포함한다 (AgXToneMapping·toneMappingExposure).
  #include <tonemapping_pars_fragment>

  // 수동 쌍선형 — 하드웨어 필터 경계 가중치에 의존하지 않는다 (NearestFilter RT)
  vec3 sampleBilinear(sampler2D t, vec2 uv, vec2 size) {
    vec2 p = uv * size - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 t00 = (i + 0.5) / size;
    vec2 t10 = (i + vec2(1.5, 0.5)) / size;
    vec2 t01 = (i + vec2(0.5, 1.5)) / size;
    vec2 t11 = (i + 1.5) / size;
    vec3 a = mix(texture2D(t, t00).rgb, texture2D(t, t10).rgb, f.x);
    vec3 b = mix(texture2D(t, t01).rgb, texture2D(t, t11).rgb, f.x);
    return mix(a, b, f.y);
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    if (toneMode < 0.5) { fragColor = sRGBTransferOETF(vec4(c, 1.0)); return; }
    float ev = texture2D(tAdapt, vec2(0.5)).r;
    c *= 1.0 / (1.2 * exp2(ev - ec));
    c += sampleBilinear(tBloom, vUv, bloomSize) * bloomStrength;
    c = AgXToneMapping(c);
    vec3 s = sRGBTransferOETF(vec4(c, 1.0)).rgb;
    vec3 uvw = vec3(0.5 / lutSize) + clamp(s, 0.0, 1.0) * (1.0 - 1.0 / lutSize);
    s = mix(s, texture(tLut, uvw).rgb, lutIntensity);
    if (uBandCap > 0.0) {
      vec3 h = rgb2hsv(clamp(s, 0.0, 1.0)); float hd = h.x * 360.0;
      float w = smoothstep(uBand.x, uBand.y, hd) * (1.0 - smoothstep(uBand.z, uBand.w, hd));
      float cap = max(uBandCap - 1.0 / (255.0 * max(h.z, 1.0e-3)), 0.0);
      if (w > 0.0 && h.y > cap) { float s2 = cap + (h.y - cap) * uBandSlope; s = hsv2rgb(vec3(h.x, mix(h.y, s2, w), h.z)); }
    }
    if (ditherAmp > 0.0) {
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      s += (n - 0.5) * ditherAmp;
    }
    fragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
  }
`;

export const OUTPUT_DEFAULT = Object.freeze({ bloomStrength: 0.06, lutIntensity: 1.0, ditherAmp: 0.0 });

/** band: { band:[a0,a1,b0,b1], bandCap, bandSlope } — grade.js GRADE_DEFAULT (LUT는 bandCap=null로 빌드, 상한은 셰이더) */
export function createOutputMaterial({ lut, lutSize, params = {}, band = null }) {
  const p = { ...OUTPUT_DEFAULT, ...params };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tDiffuse: { value: null }, tBloom: { value: null }, tAdapt: { value: null }, tLut: { value: lut },
      bloomSize: { value: new THREE.Vector2(1, 1) },
      toneMode: { value: 1 }, ec: { value: 0 }, bloomStrength: { value: p.bloomStrength },
      lutSize: { value: lutSize }, lutIntensity: { value: p.lutIntensity }, ditherAmp: { value: p.ditherAmp },
      uBand: { value: { x: band?.band?.[0] ?? 0, y: band?.band?.[1] ?? 0, z: band?.band?.[2] ?? 0, w: band?.band?.[3] ?? 0 } },
      uBandCap: { value: band?.bandCap ?? 0 }, uBandSlope: { value: band?.bandSlope ?? 0 },
      toneMappingExposure: { value: 1.0 }, // three 청크 요구 유니폼 — 노출은 ec/적응이 소유
    },
    vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  m.name = 'C4_OUTPUT';
  m.toneMapped = false;
  return m;
}
