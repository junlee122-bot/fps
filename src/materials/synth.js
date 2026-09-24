/**
 * src/materials/synth.js — 절차적 텍스처 합성기 (P3 C3, ARCHITECTURE §4).
 *
 * GPU 렌더-투-텍스처. 재질은 "레시피"(유니폼 묶음)로 기술하고 **단일 레이어 프로그램**이
 * MRT 1패스로 알베도(sRGB8)와 ORM+높이(RGBA8: ao, rough, metal, height)를 동시에 쓴다.
 * 이어 Sobel 1패스가 높이→노멀(RGBA8: nxyz, height)을 만든다. 이미지 에셋 0개(A3).
 *
 * 왜 레시피인가: 재질별 전용 함수 15개를 한 셰이더에 넣으면 SwiftShader JIT 컴파일이
 * ~4.5s(실측)였다. 노이즈 4층(모틀 FBM·결 FBM·Worley·미세) + 패턴 연산 1개(선택)를
 * 유니폼으로 조합하면 프로그램 1개·코드 1/6로 같은 표면군을 표현한다.
 *
 * 결정성: 정수 해시(lowbias32)뿐, 시간·Math.random 없음. 노이즈 격자는 period로 감싸
 * 심리스(레이어 스케일은 정수). 같은 GPU에서 비트 동일(기기 간 동일은 요구 안 함).
 */

import * as THREE from 'three';
import { clock } from '../core/clock.js'; // 벽시계는 clock만 (determinismaudit: performance.now 직접 호출 금지)

/** 패턴 연산 인덱스 (레이어 셰이더 switch와 1:1) */
export const PAT = Object.freeze({
  NONE: 0, DANCHEONG: 1, WADANG: 2, ROWS: 3, WEAVE: 4, RIBS: 5, KNOTS: 6, CHISEL: 7, EDGEWEAR: 8,
});

const FS_VERT = /* glsl */`
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FS_VERT_LEGACY = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NOISE_GLSL = /* glsl */`
  uint lowbias32(uint x) {
    x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x;
  }
  float hash2(ivec2 p, uint s) {
    uint h = lowbias32(uint(p.x) * 0x9E3779B1u ^ uint(p.y) * 0x85EBCA77u ^ s);
    return float(h) * (1.0 / 4294967296.0);
  }
  vec2 hash22(ivec2 p, uint s) { return vec2(hash2(p, s), hash2(p, s ^ 0x68E31DA4u)); }
  ivec2 wrapI(ivec2 p, int per) { return ((p % per) + per) % per; }
  float vnoise(vec2 p, int per, uint s) {
    vec2 f = fract(p); ivec2 i = ivec2(floor(p));
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = hash2(wrapI(i, per), s), b = hash2(wrapI(i + ivec2(1, 0), per), s);
    float c = hash2(wrapI(i + ivec2(0, 1), per), s), d = hash2(wrapI(i + ivec2(1, 1), per), s);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p, int per, uint s, int oct) {
    float sum = 0.0, a = 0.5, n = 0.0;
    for (int o = 0; o < 6; o++) {
      if (o >= oct) break;
      sum += a * vnoise(p, per, s + uint(o) * 131u); n += a; a *= 0.5; p *= 2.0; per *= 2;
    }
    return sum / n;
  }
  vec2 worley(vec2 p, int per, uint s) {
    ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      ivec2 g = ivec2(x, y);
      vec2 o = hash22(wrapI(i + g, per), s);
      vec2 r = vec2(g) + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
  float cellId(vec2 p, int per, uint s) { return hash2(wrapI(ivec2(floor(p)), per), s); }
`;

/**
 * 레이어 셰이더 (GLSL3, MRT 2출력).
 * 레이어: L0 모틀 FBM · L1 결 FBM(이방성) · W Worley(균열/반점) · L3 미세 값노이즈 · G 게이트 FBM.
 * 조합 유니폼 의미는 recipe 객체 필드 주석(index.js) 참조.
 */
const LAYER_FRAG = /* glsl */`
  precision highp float; precision highp int;
  in vec2 vUv;
  layout(location = 0) out vec4 oAlbedo;
  layout(location = 1) out vec4 oORM;
  uniform uint seed; uniform int period;
  uniform vec4 uL0, uL1, uL2, uL3, uGate, uRemap, uAlb, uHgt, uRgh, uAOM, uPat, uPat2;
  uniform vec3 colA, colB, colC, colD;
  ${NOISE_GLSL}

  void main() {
    float per = float(period);
    vec2 p = vUv * per;
    // ---- 레이어
    int s0 = int(uL0.x), s1 = int(uL1.x), s2 = int(uL2.x), s3 = int(uL3.x), sg = int(uGate.x);
    float L0 = fbm(p * float(s0) * vec2(1.0, uL0.w), period * s0, seed + uint(uL0.z), int(uL0.y));
    // 결(L1): x를 늘여 y 방향으로 줄무늬가 흐른다 — 트라이플래너에서 텍스처 y=월드 y(기둥 축), 바닥(Y투영)은 z(마루 방향)
    float L1 = fbm(p * float(s1) * vec2(uL1.w, 1.0), period * s1, seed + uint(uL1.z), int(uL1.y));
    vec2  W  = worley(p * float(s2), period * s2, seed + uint(uL2.y));
    float L3 = vnoise(p * float(s3), period * s3, seed + uint(uL3.y));
    float G  = fbm(p * float(sg), period * sg, seed + uint(uGate.y), 3);
    float gate = uGate.z > 0.0 ? step(uGate.z, G) : 1.0;
    // ---- 유도량
    float L0r = uRemap.y > uRemap.x ? smoothstep(uRemap.x, uRemap.y, L0) : L0;
    float streak = uRemap.w > uRemap.z ? smoothstep(uRemap.z, uRemap.w, L1) : L1;
    float crack = 0.0, spot = 0.0;
    if (uL2.z < 0.5)      crack = (1.0 - smoothstep(0.0, uL2.w, W.y - W.x)) * gate;   // 셀 경계 = 균열
    else if (uL2.z < 1.5) spot  = (1.0 - smoothstep(uL2.w * 0.5, uL2.w, W.x)) * gate; // 셀 중심 = 반점
    else                  spot  = step(uL2.w, cellId(p * float(s2), period * s2, seed + uint(uL2.y))) * gate; // 셀 무작위
    // ---- 기본 조합
    vec3 alb = mix(colA, colB, L0r);
    alb = mix(alb, colC, streak * uAlb.y);
    alb = mix(alb, colD, spot * uAlb.z);
    alb *= 1.0 - uAlb.w * crack;
    float h = 0.5 + uHgt.x * (L0 - 0.5) + uHgt.y * (streak - 0.5) - uHgt.z * crack + uHgt.w * (L3 - 0.5) + uAlb.x * spot;
    float rough = uRgh.x + uRgh.y * (streak - 0.5) + uRgh.z * crack + uRgh.w * (L0 - 0.5);
    float ao = 1.0 - uAOM.x * crack;
    float patina = smoothstep(uAOM.w, uAOM.w + 0.25, L0);
    float metal = mix(uAOM.y, uAOM.z, patina);
    // ---- 패턴 연산 (택1, uv 0..1 주기)
    int pat = int(uPat.x);
    vec2 uv = vUv;
    if (pat == 1) {
      // 단청 — u: [0,0.5] 끝단 구간(끝에서 0..LREF m, 셰이더 LOCAL 모드가 미터 기준으로 매핑), [0.5,1] 중앙 반복 구간.
      // 머리초(끝 3색 띠+흑선) · 연화(끝 안쪽 6엽) · 금문(중앙 청지 백선 격자·황점) · 박리
      float endD = min(uv.x * 2.0, 1.0);
      float bandW = uPat.y;
      float t = clamp(endD / bandW, 0.0, 1.0);
      vec3 band = colA;                                          // 청
      band = mix(band, colB, step(0.33, t) * step(t, 0.66));      // 적
      band = mix(band, colC, step(0.66, t) * (1.0 - step(1.0, t)));// 황
      float line = 1.0 - smoothstep(0.0, 0.03, min(abs(t - 0.33), abs(t - 0.66)));
      band *= 1.0 - 0.85 * line;
      vec2 c = vec2((endD - bandW * 0.5) / (bandW * 0.5), (uv.y - 0.5) * 2.0);
      float r = length(c); float ang = atan(c.y, c.x);
      float lotus = (1.0 - smoothstep(0.0, 0.08, abs(r - (0.5 + 0.12 * cos(ang * 6.0))))) * step(endD, bandW);
      band = mix(band, vec3(0.92), lotus * 0.9);
      float mid = smoothstep(bandW, bandW + 0.02, endD);
      vec2 g = vec2(uv.x * 2.0 * uPat.z, uv.y * 3.0);
      float lat = min(smoothstep(0.42, 0.47, abs(fract(g.x + g.y) - 0.5) * 2.0 * 0.5 + 0.25), smoothstep(0.42, 0.47, abs(fract(g.x - g.y) - 0.5) * 2.0 * 0.5 + 0.25));
      float white = 1.0 - min(smoothstep(0.03, 0.06, abs(fract(g.x + g.y) - 0.5)), smoothstep(0.03, 0.06, abs(fract(g.x - g.y) - 0.5)));
      float dots = 1.0 - smoothstep(0.10, 0.14, length(fract(g) - 0.5));
      vec3 geum = colA;
      geum = mix(geum, vec3(0.9), white * 0.95);
      geum = mix(geum, colC, dots);
      vec3 paint = mix(band, geum, mid);
      // 박리: 고주파 임계 마스크 + 끝단 가중 (도장층이 벗겨져 목재 노출 — 기본 alb가 목재)
      float pm = fbm(p * 6.0, period * 6, seed + 77u, 4);
      float peel = smoothstep(uPat.w, uPat.w + 0.03, pm);
      vec3 woodBase = mix(uPat2.rgb, uPat2.rgb * 0.7, L0); // 박리 노출 목재 (pat2.rgb)
      alb = mix(paint, woodBase, peel);
      h = 0.5 + 0.06 * (1.0 - peel) + 0.02 * lotus - 0.03 * white * mid;
      rough = mix(0.55, 0.9, peel);
      ao = 1.0 - 0.25 * peel;
    } else if (pat == 2) {
      // 와당 — 반원통 기와 UV: 끝단(v<0.08) 6엽 연화 원판
      float endMask = 1.0 - smoothstep(uPat.y, uPat.y + 0.03, uv.y);
      vec2 c = vec2((uv.x - 0.5) * 2.0, (uv.y - uPat.y * 0.5) / (uPat.y * 0.5));
      float r = length(c); float ang = atan(c.y, c.x);
      float petal = 1.0 - smoothstep(0.0, 0.1, abs(r - (0.65 + 0.15 * cos(ang * 6.0))));
      float disk = 1.0 - smoothstep(0.2, 0.25, r);
      float wadang = endMask * clamp(petal * 0.7 + disk, 0.0, 1.0);
      alb = mix(alb, colD, wadang * 0.6);
      h += 0.12 * wadang;
    } else if (pat == 3) {
      // 짚단 행 (초가): v 방향 다발, 다발 사이 그늘
      float row = fract(uv.y * uPat.y + 0.37 * floor(uv.x * uPat.z));
      float bundle = smoothstep(0.0, 0.18, row) * (1.0 - smoothstep(0.82, 1.0, row));
      alb *= 0.65 + 0.35 * bundle;
      h += uPat.w * (bundle - 0.5);
      ao *= 0.7 + 0.3 * bundle;
    } else if (pat == 4) {
      // 직물 (무명·삼베): 경사·위사 사인 격자
      float weave = (sin(uv.x * 6.2831853 * uPat.y) * sin(uv.y * 6.2831853 * uPat.y)) * 0.5 + 0.5;
      alb = mix(alb, colD, weave * uPat.z);
      h += uPat.w * (weave - 0.5);
      ao *= 0.85 + 0.15 * weave;
    } else if (pat == 5) {
      // 등롱 살대: v 주기 흑선 + 산란 얼룩(ao 채널 = 발광 마스크)
      float rib = 1.0 - smoothstep(0.0, uPat.z, abs(fract(uv.y * uPat.y) - 0.5) * 2.0 - (1.0 - uPat.z * 2.0));
      alb *= 1.0 - 0.35 * rib;
      h -= 0.1 * rib;
      ao = 0.35 + 0.65 * L0; // 내부 산란 마스크 (재질이 emissiveMap으로 소비)
    } else if (pat == 6) {
      // 옹이: 무작위 셀에 동심원
      float id = cellId(p * uPat.y, period * int(uPat.y), seed + 23u);
      vec2 wk = worley(p * uPat.y, period * int(uPat.y), seed + 21u);
      float knot = step(uPat.z, id) * (1.0 - smoothstep(0.0, uPat.w, wk.x));
      float ring = sin(wk.x * 70.0) * 0.5 + 0.5;
      alb = mix(alb, colD, knot * (0.6 + 0.4 * ring));
      h -= 0.15 * knot;
      ao *= 1.0 - 0.2 * knot;
    } else if (pat == 7) {
      // 정 자국 (화강암): 대각 방향 짧은 홈 (회전 Worley 경계, 게이트 마스크)
      vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
      vec2 wc = worley(q * uPat.y, period * int(uPat.y), seed + 11u);
      float ch = (1.0 - smoothstep(0.0, uPat.z, wc.x)) * step(uPat.w, G);
      alb *= 1.0 - 0.25 * ch;
      h -= 0.22 * ch;
      ao *= 1.0 - 0.3 * ch;
    } else if (pat == 8) {
      // 에지 마모 (R4 작업 1, 뷰모델) — UV 테두리 = 박스·원기둥 면 경계 = 기하 모서리다.
      // 손이 닿고 부딪히는 자리에서 도장이 벗겨져 바탕이 드러난다: 알베도 상승 · 거칠기 하강 · 금속성 상승.
      // uPat = [8, 마모 폭(UV), 알베도 혼합량, 거칠기·금속 델타]. 델타가 음수면 긁힌 폴리머(거칠기 상승·금속 0 고정).
      float d = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float edge = 1.0 - smoothstep(0.0, max(uPat.y, 1.0e-4), d);
      float grain = fbm(p * 18.0, period * 18, seed + 91u, 3);   // 균일한 띠가 아니라 얼룩지게
      edge *= 0.55 + 0.45 * grain;
      alb = mix(alb, colD, edge * uPat.z);
      rough = clamp(rough - uPat.w * edge, 0.04, 1.0);
      metal = clamp(metal + uPat.w * edge * 1.5, 0.0, 1.0);
      h -= 0.05 * edge;
      ao *= 1.0 - 0.15 * edge;
    }
    oAlbedo = vec4(max(alb, vec3(0.0)), 1.0);
    oORM = vec4(clamp(ao, 0.0, 1.0), clamp(rough, 0.0, 1.0), clamp(metal, 0.0, 1.0), clamp(h, 0.0, 1.0));
  }
`;

/** Sobel 높이→노멀 (ARCHITECTURE §4). 입력 orm.a = 높이. 출력 [n*0.5+0.5, height] */
const SOBEL_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tHeight; uniform vec2 texel; uniform float strength;
  float h(vec2 o) { return texture2D(tHeight, vUv + o * texel).a; }
  void main() {
    float tl = h(vec2(-1.0, 1.0)), t = h(vec2(0.0, 1.0)), tr = h(vec2(1.0, 1.0));
    float l = h(vec2(-1.0, 0.0)), r = h(vec2(1.0, 0.0));
    float bl = h(vec2(-1.0, -1.0)), b = h(vec2(0.0, -1.0)), br = h(vec2(1.0, -1.0));
    float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    vec3 n = normalize(vec3(-dx * strength, -dy * strength, 1.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, h(vec2(0.0)));
  }
`;

const V4 = (a = 0, b = 0, c = 0, d = 0) => new THREE.Vector4(a, b, c, d);

export class ProceduralSynth {
  constructor({ renderer }) {
    this.renderer = renderer;
    this._scene = new THREE.Scene();
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this._scene.add(this._quad);
    const v4u = () => ({ value: new THREE.Vector4() });
    this.layerMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        seed: { value: 1 }, period: { value: 4 },
        uL0: v4u(), uL1: v4u(), uL2: v4u(), uL3: v4u(), uGate: v4u(), uRemap: v4u(),
        uAlb: v4u(), uHgt: v4u(), uRgh: v4u(), uAOM: v4u(), uPat: v4u(), uPat2: v4u(),
        colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() },
        colC: { value: new THREE.Color() }, colD: { value: new THREE.Color() },
      },
      vertexShader: FS_VERT, fragmentShader: LAYER_FRAG, depthTest: false, depthWrite: false,
    });
    this.layerMat.name = 'SYNTH_LAYER';
    this.sobelMat = new THREE.ShaderMaterial({
      uniforms: { tHeight: { value: null }, texel: { value: new THREE.Vector2() }, strength: { value: 8.0 } },
      vertexShader: FS_VERT_LEGACY, fragmentShader: SOBEL_FRAG, depthTest: false, depthWrite: false,
    });
    this.sobelMat.name = 'SYNTH_SOBEL';
    this._copyMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } }, vertexShader: FS_VERT_LEGACY,
      fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D tSrc;
        void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this._copyMat.name = 'SYNTH_COPY';
    /** 재질별 소요 — PATCH-004-A 분해 계측 편입 */
    this.breakdown = [];
    this.totalMs = 0;
  }

  _texParams(tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
  }

  _blit(mat, rt) {
    this._quad.material = mat;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this._scene, this._cam);
    this.renderer.setRenderTarget(prev);
  }

  /**
   * 텍스처 3장 생성. recipe: { name, size, seed, period, colA..colD, L0,L1,L2,L3,gate,remap,alb,hgt,rgh,aom,pat, normalStrength }
   * 반환 { map, normalMap, ormMap, albedoLum } — albedoLum: 알베도 텍셀 평균 선형 휘도(16×16 판독, 결정적).
   */
  generate(r) {
    const t0 = clock.wallNowMs();
    const size = r.size ?? 512;
    const u = this.layerMat.uniforms;
    u.seed.value = (r.seed ?? 1) >>> 0; u.period.value = r.period ?? 4;
    const set = (k, v) => { u[k].value.copy(v ?? V4()); };
    set('uL0', r.L0); set('uL1', r.L1); set('uL2', r.L2); set('uL3', r.L3); set('uGate', r.gate); set('uRemap', r.remap);
    set('uAlb', r.alb); set('uHgt', r.hgt); set('uRgh', r.rgh); set('uAOM', r.aom); set('uPat', r.pat); set('uPat2', r.pat2);
    u.colA.value.copy(r.colA); u.colB.value.copy(r.colB ?? r.colA); u.colC.value.copy(r.colC ?? r.colB ?? r.colA); u.colD.value.copy(r.colD ?? r.colC ?? r.colA);
    // MRT: [0] 알베도 sRGB8, [1] ORM RGBA8 선형
    const mrt = new THREE.WebGLRenderTarget(size, size, {
      count: 2, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    });
    mrt.textures[0].colorSpace = THREE.SRGBColorSpace;
    mrt.textures[1].colorSpace = THREE.NoColorSpace;
    for (const t of mrt.textures) this._texParams(t);
    this._blit(this.layerMat, mrt);
    const normal = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, colorSpace: THREE.NoColorSpace,
    });
    this._texParams(normal.texture);
    this.sobelMat.uniforms.tHeight.value = mrt.textures[1];
    this.sobelMat.uniforms.texel.value.set(1 / size, 1 / size);
    this.sobelMat.uniforms.strength.value = r.normalStrength ?? 6.0;
    this._blit(this.sobelMat, normal);
    const albedoLum = this._meanLum(mrt.textures[0]);
    mrt.textures[0].name = `${r.name}.albedo`; mrt.textures[1].name = `${r.name}.orm`; normal.texture.name = `${r.name}.normal`;
    const ms = clock.wallNowMs() - t0;
    this.totalMs += ms;
    this.breakdown.push({ material: r.name, size, ms: +ms.toFixed(1) });
    return { map: mrt.textures[0], ormMap: mrt.textures[1], normalMap: normal.texture, albedoLum, _rts: [mrt, normal] };
  }

  /** 알베도 평균 선형 휘도 — 16×16 축소 렌더 판독 (sRGB→선형 복호 후 평균) */
  _meanLum(albedoTex) {
    const small = new THREE.WebGLRenderTarget(16, 16, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, colorSpace: THREE.SRGBColorSpace });
    this._copyMat.uniforms.tSrc.value = albedoTex;
    this._blit(this._copyMat, small);
    const buf = new Uint8Array(16 * 16 * 4);
    this.renderer.readRenderTargetPixels(small, 0, 0, 16, 16, buf);
    small.dispose();
    const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    let sum = 0;
    for (let i = 0; i < buf.length; i += 4) sum += 0.2126 * lin(buf[i]) + 0.7152 * lin(buf[i + 1]) + 0.0722 * lin(buf[i + 2]);
    return +(sum / (16 * 16)).toFixed(4);
  }

  /** 합성기 프로그램 해제 — 부팅 후 프로그램 수에서 제거 (텍스처는 유지) */
  dispose() {
    this.layerMat.dispose(); this.sobelMat.dispose(); this._copyMat.dispose();
    this._quad.geometry.dispose();
  }
}

export { V4 };
