/**
 * src/render/audit-cards.js — albedoaudit 카드 리그 + 머티리얼 알베도 열거 (P3 §5).
 *
 * 휘도 정합: 알베도 0.04 / 0.18 / 0.90 카드 3장 + 검정(0.0) 카드를 동일 조명
 * 무차폐 위치에 배치하고, **톤매핑을 끄고**(NoToneMapping — 감사 조건, 반환에
 * 표식) 렌더한다. 선형 체인에서 L(0.18)/L(0.04)≈4.5, L(0.90)/L(0.18)≈5.0이
 * 성립해야 하며, 이탈은 파이프라인이 알베도를 선형으로 다루지 않는다는 뜻이다.
 *
 * 감사 태양은 강도 0.85로 낮춘다 — 0.90 카드가 1.0에 클립되면 비율이 무의미해진다.
 *
 * 음성 훅: scaleAlbedo ≠ 1 은 씬의 전 MeshStandardMaterial 알베도를 그 배율로
 * 깎는다(참조 레포의 위조 재현) — 매니페스트 대조가 반드시 잡아야 한다.
 */

import * as THREE from 'three';

const CARD_ALBEDOS = [0.04, 0.18, 0.90];

export function setupAlbedoAudit({ scene, camera, renderer, applySunRaw, patchMaterial = () => {}, extraMaterials = [], scaleAlbedo = 1 }) {
  const DIST = 8, SIZE = 0.6, GAP = 0.8;

  camera.position.set(0, 1.7, 14);
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.updateProjectionMatrix();
  // 감사 조명: 무차폐 직사 + 저강도 (클리핑 방지) — 반환에 표식
  applySunRaw({ elev: 55, azim: 205, intensity: 0.85 }, 0.12);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;

  const geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const mk = (albedo, x, y) => {
    // Lambert = 순수 확산 카드. Standard의 F0=0.04 스페큘러는 알베도 비비례
    // 가산이라 0.04 카드 비율을 끌어올린다 (실측 3.59→3.83 — 순수 확산으로 격리).
    // 감사 목적은 "디퓨즈 체인의 알베도 선형성"이므로 Lambert가 정확한 측정계다.
    const m = new THREE.MeshLambertMaterial();
    patchMaterial(m); // CSM 패치 (P3 C1)
    m.color.setRGB(albedo, albedo, albedo, THREE.LinearSRGBColorSpace);
    m.name = `albedo_card_${albedo}`;
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = m.name;
    mesh.position.set(x, y, 14 - DIST);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
    return mesh;
  };
  const cards = CARD_ALBEDOS.map((a, i) => mk(a, (i - 1) * GAP, 1.7));
  const black = mk(0.0, 0, 1.7 - GAP);

  // 화면 사각형 (CSS px, 내접 60%)
  camera.updateMatrixWorld(true);
  const rectOf = (mesh) => {
    const c = new THREE.Vector3();
    mesh.getWorldPosition(c);
    const half = (SIZE / 2) * 0.6;
    const pts = [[-half, -half], [half, -half], [-half, half], [half, half]].map(([dx, dy]) => {
      const p = new THREE.Vector3(c.x + dx, c.y + dy, c.z).project(camera);
      return [(p.x * 0.5 + 0.5) * innerWidth, (1 - (p.y * 0.5 + 0.5)) * innerHeight];
    });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...xs) - x), h: Math.round(Math.max(...ys) - y) };
  };
  const rects = {
    a004: rectOf(cards[0]), a018: rectOf(cards[1]), a090: rectOf(cards[2]),
    black: rectOf(black),
  };
  rects.backdrop = { ...rects.black, x: rects.black.x + Math.round(rects.black.w * 1.8) };

  // 씬 머티리얼 알베도 열거 (조명 반영 전 선형 색 휘도) — 매니페스트 대조용.
  // 대상: 조명 BRDF를 쓰는 MeshStandardMaterial만 (unlit fx basic 제외).
  const seen = new Map();
  const record = (mat) => {
    if (!mat || !mat.isMeshStandardMaterial) return;
    if (mat.name.startsWith('albedo_card')) return;
    // 판별 클론(HANJI@판이름 등)은 기본명으로 정규화 — 알베도 동일
    const base = mat.name.split('@')[0];
    if (!seen.has(base)) {
      seen.set(base, +(0.2126 * mat.color.r + 0.7152 * mat.color.g + 0.0722 * mat.color.b).toFixed(4));
    }
  };
  scene.traverse((o) => record(o.material));
  for (const m of extraMaterials) record(m); // 런타임 전용(낙하 기와 등) — 씬 순회 밖

  // 음성 훅 — 전 표준 머티리얼 알베도를 깎는다 (열거는 깎은 후 값이어야 검출된다)
  if (scaleAlbedo !== 1) {
    scene.traverse((o) => {
      const mat = o.material;
      if (mat?.isMeshStandardMaterial && !mat.name.startsWith('albedo_card')) {
        mat.color.multiplyScalar(scaleAlbedo);
      }
    });
    for (const [k] of seen) {
      seen.set(k, +(seen.get(k) * scaleAlbedo).toFixed(4));
    }
  }

  return {
    rects,
    materials: Object.fromEntries(seen),
    auditState: 'NoToneMapping · sun 0.85/hemi 0.12 — 감사 전용 렌더 상태 (계약 샷 무관)',
    ...(scaleAlbedo !== 1 ? { testOverride: `scaleAlbedo=${scaleAlbedo} — harnesstest 전용, 계약 판정 무효` } : {}),
  };
}
