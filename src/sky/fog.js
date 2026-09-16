/**
 * src/sky/fog.js — 볼류메트릭 안개·광선 패스 (ARCHITECTURE §1: src/sky 소유).
 *
 * 풀스크린 셰이더 패스 하나(재질·유니폼·인스캐터 색·광선 강도)를 소유한다.
 * 실행(렌더타깃 바인딩·블릿·패스 순서)은 렌더 파이프라인이 한다 — 파이프라인은
 * 주입된 sky.fogPass의 update()로 프레임 입력을 넘기고 material을 블릿한다
 * (크로스 서브시스템 import 없음, §3 주입 규약).
 *
 * 결정성: 모든 출력은 샷 구성(sun/fog)·카메라·프레임 인덱스(8상 디더)의 순수 함수.
 */

import * as THREE from 'three';

/** 파이프라인 fsMaterial과 동일 규약의 풀스크린 정점 셰이더 (2×2 평면, NDC 직결) */
const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FOG_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tShadow;
  uniform mat4 invVP;
  uniform mat4 shadowMatrix;
  uniform vec3 camPos;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform float density;
  uniform float heightFalloff;
  uniform float baseY;
  uniform float jitterPhase;
  uniform float shaftStrength;
  uniform float shadowBias; // 광원 깊이창 정규화값 — CPU가 0.03m/(far-near)로 환산

  // three r180 packDepthToRGBA 역변환 (packing.glsl UnpackFactors4) — 구식 1/255 계열
  // 상수는 깊이를 ~0.8m 멀리 오독해 차폐를 놓쳤다 (C2 검토 실측)
  float unpackDepth(vec4 rgba) {
    return dot(rgba, vec4(255.0/256.0, 255.0/256.0/256.0, 255.0/256.0/65536.0, 1.0/16777216.0));
  }
  float shadowAt(vec3 wp) {
    vec4 sc = shadowMatrix * vec4(wp, 1.0);
    vec3 uvz = sc.xyz / sc.w;
    if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0) return 1.0;
    float d = unpackDepth(texture2D(tShadow, uvz.xy));
    return uvz.z - shadowBias > d ? 0.0 : 1.0;
  }
  // 지수 높이 안개의 시선 광학 두께 해석해
  float opticalDepth(vec3 ro, vec3 rd, float len) {
    float ky0 = heightFalloff * (ro.y - baseY);
    float kdy = clamp(heightFalloff * rd.y * len, -60.0, 60.0);
    float f = abs(kdy) > 1e-4 ? (1.0 - exp(-kdy)) / kdy : 1.0;
    return density * exp(-ky0) * f * len;
  }
  void main() {
    vec4 scene = texture2D(tDiffuse, vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 wp4 = invVP * clip;
    vec3 wp = wp4.xyz / wp4.w;
    vec3 rd = wp - camPos;
    float len = length(rd);
    rd /= max(len, 1e-5);
    if (depth >= 0.9999) len = 140.0; // 하늘 — 원거리 안개층 상한
    len = min(len, 140.0);

    float od = opticalDepth(camPos, rd, len);
    float T = exp(-od);

    // 인스캐터 색: 하늘 근사 + 태양 전방산란 (Henyey-Greenstein g=0.55)
    float mu = dot(rd, sunDir);
    float g = 0.55;
    float phase = (1.0 - g*g) / (4.0 * 3.14159265 * pow(1.0 + g*g - 2.0*g*mu, 1.5));
    // 광선: 시선 12스텝 그림자 가중 (전방산란 성분에만 적용)
    float lit = 1.0;
    if (shaftStrength > 0.0) {
      float acc = 0.0;
      float t0 = (jitterPhase + 0.5) / 8.0;            // 8상 스트라텀 전체 커버
      float ml = min(len, 24.0);                        // 캐스케이드0 도달거리 안에서만 행진
      for (int i = 0; i < 12; i++) {
        float t = (float(i) + t0) / 12.0;
        acc += shadowAt(camPos + rd * (ml * t));
      }
      lit = acc / 12.0;
    }
    vec3 inscatter = skyColor + sunColor * phase * mix(1.0, lit, shaftStrength);
    gl_FragColor = vec4(scene.rgb * T + inscatter * (1.0 - T), scene.a);
  }
`;

export class FogPass {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, tShadow: { value: null },
        invVP: { value: new THREE.Matrix4() }, shadowMatrix: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0, 0, 0) },
        skyColor: { value: new THREE.Color(0, 0, 0) },
        density: { value: 0 }, heightFalloff: { value: 0.12 }, baseY: { value: 0 },
        jitterPhase: { value: 0 }, shaftStrength: { value: 0.85 }, shadowBias: { value: 1.5e-5 },
      },
      vertexShader: FS_VERT, fragmentShader: FOG_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.material.name = 'SKY_FOG_PASS';
  }

  /** 태양 구성 → 인스캐터 색·광선 강도 (샷 구성의 순수 함수 — CPU 산출, C2) */
  setSun({ elev, intensity }) {
    const t = THREE.MathUtils.clamp(elev / 60, 0, 1); // 저고도→온색
    const day = intensity >= 0.1;
    const u = this.material.uniforms;
    const sun = u.sunColor.value;
    const sky = u.skyColor.value;
    if (day) {
      sun.setRGB(1.0, 0.72 + 0.2 * t, 0.5 + 0.4 * t).multiplyScalar(intensity * 0.16);
      sky.setRGB(0.36 + 0.1 * t, 0.44 + 0.09 * t, 0.55 + 0.06 * t).multiplyScalar(0.5 + 0.5 * t);
    } else {
      sun.setRGB(0, 0, 0);
      sky.setRGB(0.015, 0.02, 0.035); // 야간 박명 잔광
    }
    u.shaftStrength.value = day ? 0.85 : 0.0;
    // 위 skyColor는 CPU 근사 초기값 — C4부터 sky.apply가 돔 지평선 판독값으로 덮어쓴다 (setSkyColor)
  }

  /**
   * C4: 인스캐터 하늘색을 스카이돔 지평선 실측(큐브맵 판독)으로 통일 — CPU 근사와 돔 색의 불일치 해소
   * (C2 검토 기록 (2)). scale은 인스캐터 대 돔 휘도 비(단일 산란 근사의 알베도 계수).
   */
  setSkyColor(rgb, scale = 1.0) {
    this.material.uniforms.skyColor.value.setRGB(rgb[0] * scale, rgb[1] * scale, rgb[2] * scale);
  }

  /**
   * 프레임 입력 — 파이프라인이 블릿 직전에 호출.
   * shadow: CSM 캐스케이드0 LightShadow (map·matrix·camera), frame: 엔진 프레임 인덱스
   */
  update({ tDiffuse, tDepth, fog, camPos, sunDir, invVP, shadow, frame }) {
    const u = this.material.uniforms;
    u.tDiffuse.value = tDiffuse;
    u.tDepth.value = tDepth;
    u.density.value = fog.density;
    u.heightFalloff.value = fog.heightFalloff;
    u.baseY.value = fog.baseY;
    u.camPos.value.copy(camPos);
    u.sunDir.value.copy(sunDir);
    u.invVP.value.copy(invVP);
    u.tShadow.value = shadow.map ? shadow.map.texture : null;
    u.shadowMatrix.value.copy(shadow.matrix);
    u.shadowBias.value = 0.03 / (shadow.camera.far - shadow.camera.near); // 3cm (자유공간 시료 — 아크네 없음)
    u.jitterPhase.value = frame % 8;
  }
}
