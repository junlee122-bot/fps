/**
 * src/materials/surface-shader.js — 표면 셰이더 패치 (P3 C3, ARCHITECTURE §4).
 *
 * MeshStandardMaterial에 onBeforeCompile로 주입한다:
 *  - SURF_TRI   : 트라이플래너 (월드 좌표 3축 투영, 노멀 가중 블렌드 지수 8). UV가 늘어난
 *                 박스·셸 지오메트리용. 노멀맵은 축별 탄젠트 프레임으로 월드 노멀에 합성.
 *  - SURF_LOCAL : 로컬(오브젝트) 좌표 매핑 — 부재 길이 방향을 u로 정규화(박스 치수 속성
 *                 aBoxDims 사용). 단청 머리초(양 끝)·금문(중앙) 배치가 부재마다 정렬된다.
 *  - SURF_POM   : 시차 폐색 매핑 — 지배 투영축에서 높이(normalMap.a)로 8스텝 행진 + 1회
 *                 시컨트 보정. 4~8m에서 페이드(비용 상한). 트라이플래너 전용.
 *  - SURF_WEAR  : 곡률(에지) 기반 마모 — 박스 면 가장자리 거리(aBoxDims × uv)에서 폭
 *                 uWearWidth 안을 마모색으로, 높이 마스크로 불규칙하게. 치수 속성이 없는
 *                 지오메트리(원통·셸)는 자동으로 0(마모 없음).
 *
 * 프로그램 수: 정의(define) 집합이 같으면 재질이 달라도 프로그램을 공유한다(three 캐시 키).
 * 모드 조합은 소수로 고정한다 — TRI / TRI+POM / TRI+WEAR / TRI+POM+WEAR / LOCAL(+WEAR).
 *
 * 결정성: 셰이더는 순수 함수(시간·난수 입력 없음). 카메라 의존 항(POM 페이드)은 샷의 함수.
 * CSM: pipeline.patchMaterial(CSM.setupMaterial)이 먼저 onBeforeCompile을 설정하므로 이 패치는
 * 그 다음에 적용해 기존 훅을 체인한다(덮어쓰기 금지).
 */

const VERT_PARS = /* glsl */`
  attribute vec3 aBoxDims;
  varying vec3 vSurfWPos; varying vec3 vSurfWNrm; varying vec3 vSurfLPos; varying vec3 vSurfLNrm;
  varying vec3 vSurfDims; varying vec2 vSurfUv;
`;
const VERT_MAIN = /* glsl */`
  {
    vec4 swp = vec4(transformed, 1.0);
    vec3 swn = objectNormal;
    #ifdef USE_INSTANCING
      swp = instanceMatrix * swp;
      swn = mat3(instanceMatrix) * swn;
    #endif
    swp = modelMatrix * swp;
    vSurfWPos = swp.xyz;
    vSurfWNrm = normalize(mat3(modelMatrix) * swn);
    vSurfLPos = position;
    vSurfLNrm = objectNormal;
    vSurfDims = aBoxDims;
    vSurfUv = uv;
  }
`;

const FRAG_PARS = /* glsl */`
  varying vec3 vSurfWPos; varying vec3 vSurfWNrm; varying vec3 vSurfLPos; varying vec3 vSurfLNrm;
  varying vec3 vSurfDims; varying vec2 vSurfUv;
  uniform float uSurfScale;   // 텍스처 반복 (1/m)
  uniform float uPomScale;    // 시차 깊이 (m)
  uniform vec3 uWearColor;    // 마모 노출색 (선형)
  uniform float uWearWidth;   // 마모 폭 (m)
  uniform float uWearAmount;  // 마모 강도 0..1
  uniform float uLocalScale;  // LOCAL 모드: 치수 속성이 없을 때의 반복 (1/m)

  vec3 surfWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(8.0));
    return w / max(w.x + w.y + w.z, 1e-5);
  }
  // 축별 투영 UV (부호로 좌우 반전 방지)
  vec2 surfUvX(vec3 p, float s) { return vec2(p.z * s, p.y) * uSurfScale; }
  vec2 surfUvY(vec3 p, float s) { return vec2(p.x, p.z * s) * uSurfScale; }
  vec2 surfUvZ(vec3 p, float s) { return vec2(p.x * s, p.y) * uSurfScale; }

  #ifdef SURF_POM
  // 지배축 평면에서의 시차 행진: uv0 입력, 뷰 벡터의 접평면 성분 vt(높이 1당 uv 이동)
  vec2 surfPom(vec2 uv0, vec2 vt) {
    const int STEPS = 8;
    float layer = 1.0 / float(STEPS);
    vec2 duv = vt * uPomScale * uSurfScale * layer;
    float depth = 0.0; vec2 uv = uv0;
    float h = 1.0 - texture2D(normalMap, uv).a;
    float prevH = h; vec2 prevUv = uv;
    for (int i = 0; i < STEPS; i++) {
      if (depth >= h) break;
      prevUv = uv; prevH = h;
      uv -= duv; depth += layer;
      h = 1.0 - texture2D(normalMap, uv).a;
    }
    // 시컨트 보정
    float a = h - depth; float b = prevH - (depth - layer);
    float t = clamp(b / max(b - a, 1e-4), 0.0, 1.0);
    return mix(prevUv, uv, t);
  }
  #endif
`;

/** map_fragment 대체 — 모드별 UV 산출 + 3장(알베도·ORM·노멀) 샘플 + 마모 */
const FRAG_MAP = /* glsl */`
  vec3 surfN = normalize(vSurfWNrm);
  #ifdef DOUBLE_SIDED
    surfN *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec3 surfW = surfWeights(surfN);
  vec3 sgn = sign(surfN + 1e-6);
  vec4 surfAlbedo; vec4 surfORM; vec3 surfTn; // surfTn: 월드 노멀 (맵 합성 후)
  #ifdef SURF_LOCAL
  {
    // 부재 길이축 = 가장 긴 치수. 텍스처 u 의미: [0,0.5] = 가까운 끝에서 0..LREF(m) 구간(머리초·연화),
    // [0.5,1] = 중앙 구간(금문, LREF마다 반복). 길이에 비례하지 않고 미터 기준이라 16m 창방에서도 머리초는 끝 0.4m다.
    const float LREF = 1.0;
    vec3 d = vSurfDims;
    vec3 lp = vSurfLPos;
    float along, halfLen, across; // 'half'는 GLSL ES 예약어 — 사용 금지
    if (d.x <= 0.0) { along = lp.x; halfLen = 0.5 / uLocalScale; across = lp.y * uLocalScale + 0.5; }
    else if (d.x >= d.y && d.x >= d.z) { along = lp.x; halfLen = d.x * 0.5; across = (abs(vSurfLNrm.y) > 0.5 ? lp.z / d.z : lp.y / d.y) + 0.5; }
    else if (d.z >= d.x && d.z >= d.y) { along = lp.z; halfLen = d.z * 0.5; across = (abs(vSurfLNrm.y) > 0.5 ? lp.x / d.x : lp.y / d.y) + 0.5; }
    else { along = lp.y; halfLen = d.y * 0.5; across = (abs(vSurfLNrm.x) > 0.5 ? lp.z / d.z : lp.x / d.x) + 0.5; }
    float endDist = max(halfLen - abs(along), 0.0);
    float u = endDist < LREF ? endDist / (2.0 * LREF) : 0.5 + fract((endDist - LREF) / LREF) * 0.5;
    vec2 luv = vec2(u, across);
    surfAlbedo = texture2D(map, luv);
    surfORM = texture2D(roughnessMap, luv);
    vec3 tn = texture2D(normalMap, luv).xyz * 2.0 - 1.0; tn.xy *= normalScale;
    // 노멀 합성은 지배 월드축 프레임으로 근사
    vec3 nX = vec3(sgn.x * tn.z, tn.y, tn.x), nY = vec3(tn.x, sgn.y * tn.z, tn.y), nZ = vec3(tn.x, tn.y, sgn.z * tn.z);
    surfTn = normalize(nX * surfW.x + nY * surfW.y + nZ * surfW.z);
  }
  #else
  {
    vec3 p = vSurfWPos;
    vec2 uvX = surfUvX(p, sgn.x), uvY = surfUvY(p, sgn.y), uvZ = surfUvZ(p, sgn.z);
    #ifdef SURF_POM
    {
      vec3 V = normalize(cameraPosition - vSurfWPos);
      float dist = length(cameraPosition - vSurfWPos);
      float fade = 1.0 - smoothstep(4.0, 8.0, dist);
      if (fade > 0.0) {
        // 지배축 하나만 시차 행진 (비용 상한)
        if (surfW.x >= surfW.y && surfW.x >= surfW.z) {
          vec2 vt = vec2(V.z * sgn.x, V.y) / max(abs(V.x), 0.2) * fade;
          uvX = surfPom(uvX, vt);
        } else if (surfW.y >= surfW.z) {
          vec2 vt = vec2(V.x, V.z * sgn.y) / max(abs(V.y), 0.2) * fade;
          uvY = surfPom(uvY, vt);
        } else {
          vec2 vt = vec2(V.x * sgn.z, V.y) / max(abs(V.z), 0.2) * fade;
          uvZ = surfPom(uvZ, vt);
        }
      }
    }
    #endif
    surfAlbedo = texture2D(map, uvX) * surfW.x + texture2D(map, uvY) * surfW.y + texture2D(map, uvZ) * surfW.z;
    surfORM = texture2D(roughnessMap, uvX) * surfW.x + texture2D(roughnessMap, uvY) * surfW.y + texture2D(roughnessMap, uvZ) * surfW.z;
    vec3 tX = texture2D(normalMap, uvX).xyz * 2.0 - 1.0; tX.xy *= normalScale;
    vec3 tY = texture2D(normalMap, uvY).xyz * 2.0 - 1.0; tY.xy *= normalScale;
    vec3 tZ = texture2D(normalMap, uvZ).xyz * 2.0 - 1.0; tZ.xy *= normalScale;
    vec3 nX = vec3(sgn.x * tX.z, tX.y, tX.x);
    vec3 nY = vec3(tY.x, sgn.y * tY.z, tY.y);
    vec3 nZ = vec3(tZ.x, tZ.y, sgn.z * tZ.z);
    surfTn = normalize(nX * surfW.x + nY * surfW.y + nZ * surfW.z);
  }
  #endif
  float surfWear = 0.0;
  #ifdef SURF_WEAR
  {
    vec3 d = vSurfDims;
    if (d.x > 0.0) {
      vec3 ln = abs(vSurfLNrm);
      vec2 fd = ln.x > 0.5 ? vec2(d.z, d.y) : (ln.y > 0.5 ? vec2(d.x, d.z) : vec2(d.x, d.y));
      vec2 e = min(vSurfUv, 1.0 - vSurfUv) * fd;
      float edgeDist = min(e.x, e.y);
      float mask = smoothstep(0.35, 0.75, surfORM.a); // 높이 마스크 — 불규칙 마모
      surfWear = (1.0 - smoothstep(0.0, uWearWidth, edgeDist)) * mask * uWearAmount;
    }
  }
  #endif
  surfAlbedo.rgb = mix(surfAlbedo.rgb, uWearColor, surfWear);
  diffuseColor *= surfAlbedo;
`;
const FRAG_ROUGH = /* glsl */`
  float roughnessFactor = roughness * mix(surfORM.g, 0.6, surfWear);
`;
const FRAG_METAL = /* glsl */`
  float metalnessFactor = metalness * surfORM.b;
`;
const FRAG_NORMAL = /* glsl */`
  {
    vec3 nw = mix(surfTn, surfN, surfWear * 0.7);
    normal = normalize(mat3(viewMatrix) * nw);
  }
`;
const FRAG_AO = /* glsl */`
  {
    float ambientOcclusion = (surfORM.r - 1.0) * aoMapIntensity + 1.0;
    reflectedLight.indirectDiffuse *= ambientOcclusion;
    #if defined( USE_ENVMAP ) && defined( STANDARD )
      float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
      reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
    #endif
  }
`;

/**
 * 재질에 표면 셰이더를 적용. 반드시 CSM 패치(pipeline.patchMaterial) 이후에 호출한다.
 * opts: { mode: 'tri'|'local', pom, wear, scale, pomScale, wearColor, wearWidth, wearAmount, localScale }
 * 텍스처: mat.map(알베도), mat.normalMap(노멀+높이), mat.roughnessMap=mat.aoMap=mat.metalnessMap(ORM)
 */
export function applySurfaceShader(mat, opts = {}) {
  const mode = opts.mode ?? 'tri';
  mat.defines = mat.defines || {};
  if (mode === 'local') mat.defines.SURF_LOCAL = 1; else mat.defines.SURF_TRI = 1;
  if (opts.pom && mode === 'tri') mat.defines.SURF_POM = 1;
  if (opts.wear) mat.defines.SURF_WEAR = 1;
  const uniforms = {
    uSurfScale: { value: opts.scale ?? 1.0 },
    uPomScale: { value: opts.pomScale ?? 0.02 },
    uWearColor: { value: opts.wearColor ?? { r: 0.5, g: 0.5, b: 0.5 } },
    uWearWidth: { value: opts.wearWidth ?? 0.02 },
    uWearAmount: { value: opts.wearAmount ?? 0.6 },
    uLocalScale: { value: opts.localScale ?? 2.0 },
  };
  mat.userData.surfUniforms = uniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN);
    // 파스 선언은 normalMap 샘플러가 선언된 뒤(normalmap_pars_fragment)에 넣는다 — surfPom이 normalMap을 읽는다
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normalmap_pars_fragment>', '#include <normalmap_pars_fragment>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <metalnessmap_fragment>', FRAG_METAL)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  // 프로그램 캐시 키: 모드 정의는 material.defines로 이미 키에 포함된다(three) — 패치 버전만 보탠다
  mat.customProgramCacheKey = () => 'surf1';
  mat.needsUpdate = true;
  return mat;
}
