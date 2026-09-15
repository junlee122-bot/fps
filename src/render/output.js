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
    if (ditherAmp > 0.0) {
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      s += (n - 0.5) * ditherAmp;
    }
    fragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
  }
`;

export const OUTPUT_DEFAULT = Object.freeze({ bloomStrength: 0.06, lutIntensity: 1.0, ditherAmp: 0.0 });

export function createOutputMaterial({ lut, lutSize, params = {} }) {
  const p = { ...OUTPUT_DEFAULT, ...params };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tDiffuse: { value: null }, tBloom: { value: null }, tAdapt: { value: null }, tLut: { value: lut },
      bloomSize: { value: new THREE.Vector2(1, 1) },
      toneMode: { value: 1 }, ec: { value: 0 }, bloomStrength: { value: p.bloomStrength },
      lutSize: { value: lutSize }, lutIntensity: { value: p.lutIntensity }, ditherAmp: { value: p.ditherAmp },
      toneMappingExposure: { value: 1.0 }, // three 청크 요구 유니폼 — 노출은 ec/적응이 소유
    },
    vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  m.name = 'C4_OUTPUT';
  m.toneMapped = false;
  return m;
}
