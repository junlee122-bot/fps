/**
 * src/render/tagmask.js — 자발광·일시광 태그 마스크 (PATCH-007-C).
 *
 * 팔레트 게이트(tools/paletteaudit.mjs)가 "자발광 픽셀"을 재질 태그로 구분하도록, 캡처 프레임과 같은
 * 카메라·TAA 지터로 씬을 2패스 그린다:
 *   (A) 전 오브젝트 검정 오버라이드 — 깊이 기록
 *   (B) 태그 오브젝트만 흰색 오버라이드 — 깊이 검사 유지, 클리어 없음
 * 결과 = 태그 오브젝트가 **실제로 보이는** 픽셀만 1 (담장 뒤 등롱은 0, 창호지 뒤도 0 — 판이 불투명 깊이로 가린다).
 * 조명·안개·TAA·블룸·그레이드는 무관하다: 마스크는 "어느 픽셀이 발광체 표면인가"만 답한다.
 * 블룸 헤일로(발광체 밖으로 번진 빛)와 발광체가 비춘 표면은 태그되지 않는다 — 규율은 그 픽셀에 그대로 적용된다.
 *
 * 태그 규칙 (여기 한 곳에서만 정의 — 감사 도구는 마스크만 본다):
 *   - 재질 이름 FX_FLASH / FX_TRACER — 일시광 지오메트리(총구화염·예광)
 *   - emissive 가 0이 아니고 emissiveIntensity ≥ TAG_EMISSIVE_MIN(1.0) — 등롱 점등(6.0). 소등(0.25)은 확산면으로 취급
 *   - 태그하지 않음: FX_PARTICLE(먼지·파편·불꽃 — 무채색 물질), 뷰모델, 하늘 돔, HANJI(투과는 셰이더 가산, emissive 아님)
 *
 * 호출 시점: 캡처·getStats **뒤** (하네스 renderTagMask). 오버라이드 재질의 프로그램 컴파일이 캡처 프레임 통계에
 * 섞이지 않게 하고, harness 는 이 구간의 컴파일 로그를 tagMask 로 표식한다. 픽셀 게이트 무영향 — 캡처 뒤 별도 RT.
 */

import * as THREE from 'three';

export const TAG_MATERIAL_NAMES = Object.freeze(['FX_FLASH', 'FX_TRACER']);
export const TAG_EMISSIVE_MIN = 1.0;
const TAG_LAYER = 31;

export function isTaggedMaterial(m) {
  if (!m) return false;
  if (TAG_MATERIAL_NAMES.includes(m.name)) return true;
  const e = m.emissive;
  return !!e && (m.emissiveIntensity ?? 0) >= TAG_EMISSIVE_MIN && e.r + e.g + e.b > 0;
}

function visibleChain(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}

export function createTagMask({ renderer, scene, camera, pipeline }) {
  let rt = null;
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });
  black.name = 'TAGMASK_BLACK';
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  white.name = 'TAGMASK_WHITE';
  const _size = new THREE.Vector2();
  const _clear = new THREE.Color();

  function render() {
    renderer.getDrawingBufferSize(_size);
    const W = _size.x, H = _size.y;
    if (!rt || rt.width !== W || rt.height !== H) {
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      });
    }
    const tagged = [];
    const taggedMaterials = new Set();
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !visibleChain(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const hit = mats.filter(isTaggedMaterial);
      if (hit.length) { tagged.push(o); for (const m of hit) taggedMaterials.add(m.name); }
    });

    // ---- 상태 저장 ----
    const prevRT = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    const prevLayers = camera.layers.mask;

    // 카메라: 파이프라인 소유 aspect + 직전 프레임 지터 → 캡처 프레임과 동일 투영
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const j = pipeline.lastJitter ?? [0, 0];
    camera.setViewOffset(W, H, j[0], j[1], W, H);
    camera.updateMatrixWorld();

    const info = renderer.info.render;
    const calls0 = info.calls;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    scene.background = null; // Color 배경은 클리어색을 덮어쓴다 — 마스크 배경은 반드시 0
    renderer.autoClear = true;
    scene.overrideMaterial = black;            // (A)
    renderer.render(scene, camera);
    for (const o of tagged) o.layers.enable(TAG_LAYER);
    camera.layers.set(TAG_LAYER);              // (B) 태그 오브젝트만
    scene.overrideMaterial = white;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    const drawCalls = info.calls - calls0;
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);

    // ---- 복원 ----
    for (const o of tagged) o.layers.disable(TAG_LAYER);
    camera.layers.mask = prevLayers;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(_clear, prevAlpha);
    renderer.setRenderTarget(prevRT);
    camera.clearViewOffset();

    // 비트 패킹 — 행 우선, 좌상단 원점 (readRenderTargetPixels 는 하단 행부터)
    const packed = new Uint8Array(Math.ceil((W * H) / 8));
    let taggedPixels = 0;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        if (buf[(src + x) * 4] > 127) {
          const i = y * W + x;
          packed[i >> 3] |= 0x80 >> (i & 7);
          taggedPixels++;
        }
      }
    }
    let bin = '';
    for (let i = 0; i < packed.length; i += 8192) bin += String.fromCharCode.apply(null, packed.subarray(i, i + 8192));
    return {
      width: W, height: H, taggedPixels, ratioPct: +((100 * taggedPixels) / (W * H)).toFixed(4),
      taggedObjects: tagged.length, taggedMaterials: [...taggedMaterials].sort(), drawCalls,
      rule: `FX_FLASH·FX_TRACER 또는 emissive≠0 ∧ emissiveIntensity ≥ ${TAG_EMISSIVE_MIN}`,
      bits: btoa(bin),
    };
  }

  return { render, isTaggedMaterial };
}
