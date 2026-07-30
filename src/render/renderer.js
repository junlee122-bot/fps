/**
 * src/render/renderer.js — P0 최소 렌더 파이프라인.
 *
 * WebGL2 + sRGB 출력 + 단일 태양광 CSM 없음(P3에서 HDR/CSM/TAA/AgX).
 * P0의 목적은 하네스가 감시할 안정된 픽셀 소스다. 라이트 개수는
 * 항상 일정하게 유지한다 — 라이트 수가 변하면 셰이더 프로그램 순열이
 * 갈라져 프리웜 커버리지가 깨진다.
 */

import * as THREE from 'three';

export const SUN_DISTANCE = 90;

export function createRenderer({ canvas, dpr, preserveDrawingBuffer = false }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // 톤매핑은 P3 결합 시스템 소유
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(dpr ?? devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  return renderer;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
  camera.rotation.order = 'YXZ';
  return camera;
}

/**
 * 조명 리그: 반구 + 배경색. 태양은 P3부터 CSM 3캐스케이드(pipeline 소유)다 —
 * lighting.pipeline은 main.js가 파이프라인 생성 후 주입한다.
 * 등롱 포인트라이트는 world 소유.
 */
export function createLighting(scene) {
  scene.background = new THREE.Color(0x31353b);

  const hemi = new THREE.HemisphereLight(0xcfd4da, 0x8a8478, 0.5);
  scene.add(hemi);

  return { hemi, pipeline: null };
}

/**
 * 태양각 적용. azimuth: 0=북(-Z), 90=동(+X), 180=남(+Z). elevation: 도.
 * P3: CSM(pipeline)으로 위임 — 방향·강도. world:tod 발행 주체는 sky(C2).
 */
export function applySunConfig(lighting, sun, hemiIntensity) {
  lighting.pipeline.setSun(sun);
  lighting.hemi.intensity = hemiIntensity;
}

export function handleResize(renderer, camera) {
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);
  return onResize;
}
