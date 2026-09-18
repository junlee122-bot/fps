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
  varying vec3 vSurfOrigin; // R4: 오브젝트(인스턴스) 월드 원점 — 트라이플래너 UV 오프셋(기둥 결 다양화)
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
    {
      vec4 so = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        so = instanceMatrix * so;
      #endif
      vSurfOrigin = (modelMatrix * so).xyz;
    }
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
  varying vec3 vSurfOrigin;
  // R4 (R2 S10 '모든 기둥 동일 패턴'): 트라이플래너는 월드 좌표 슬라이스를 샘플하므로 같은 열의 인스턴스(같은 x 또는 z)는 같은 결을 얻는다.
  // 오브젝트 원점의 정수 해시로 세 투영 UV 를 상수 오프셋 — 타일링 텍스처라 이음새 없음, 결정적(정수 연산), 순열 불변.
  vec3 surfOriginOffset(vec3 o) {
    uvec3 q = uvec3(ivec3(floor(o * 4.0 + 0.5))) * uvec3(0x9E3779B1u, 0x85EBCA77u, 0xC2B2AE3Du);
    uint h = q.x ^ (q.y << 7u) ^ (q.z >> 3u); h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u;
    return vec3(float(h & 0xFFFFu), float((h >> 8u) & 0xFFFFu), float((h >> 16u) & 0xFFFFu)) / 65535.0 * 7.0;
  }
  uniform float uSurfScale;   // 텍스처 반복 (1/m)
  uniform float uPomScale;    // 시차 깊이 (m)
  uniform vec3 uWearColor;    // 마모 노출색 (선형)
  uniform float uWearWidth;   // 마모 폭 (m)
  uniform float uWearAmount;  // 마모 강도 0..1
  uniform float uLocalScale;  // LOCAL 모드: 치수 속성이 없을 때의 반복 (1/m)
  uniform float uMacro;       // R1 수정 D: 저주파(10~30m) 거시 변조 진폭 0..1 (0 = 없음)
  uniform vec4 uUnder;        // R1 수정 C: 지붕 셸 하면 서까래 — x 혼합량(0=없음), y 서까래 간격(m), z 서까래 폭(m), w 앙토 AO
  #ifdef SURF_GROUND_AO
  uniform sampler2D uGroundAoMap; // R4 접지 음영 맵 (render/groundao.js 베이크, R8, 월드 XZ)
  uniform vec4 uGroundAoBounds;   // minX, minZ, 1/sizeX, 1/sizeZ
  #endif
  uniform vec3 uUnderColor;   // 서까래 목재색 (선형)

  // 결정적 정수 해시 값노이즈 (synth.js lowbias32와 동형) — 시간·난수·미분 입력 없음
  uint sfLb(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
  float sfH(ivec2 q, uint s) { return float(sfLb(uint(q.x + 65536) * 0x9E3779B1u ^ uint(q.y + 65536) * 0x85EBCA77u ^ s)) * (1.0 / 4294967296.0); }
  float sfVn(vec2 q, uint s) {
    vec2 f = fract(q); ivec2 i = ivec2(floor(q)); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sfH(i, s), sfH(i + ivec2(1, 0), s), u.x), mix(sfH(i + ivec2(0, 1), s), sfH(i + ivec2(1, 1), s), u.x), u.y);
  }
  // 거시 변조: 월드 xz 기준 ~17m·~6m 두 옥타브 (벽면은 y로 소폭 기울여 수평 띠를 피한다). 평균 0.5 → 알베도 평균 보존
  float surfMacro(vec3 p) {
    vec2 q = p.xz * 0.06 + p.y * 0.035;
    return 0.65 * sfVn(q, 0x77u) + 0.35 * sfVn(q * 2.7 + vec2(11.3, 5.1), 0x99u);
  }

  vec3 surfWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(8.0));
    return w / max(w.x + w.y + w.z, 1e-5);
  }
  // 축별 투영 UV (부호로 좌우 반전 방지)
  vec2 surfUvX(vec3 p, float s) { return vec2(p.z * s, p.y) * uSurfScale; }
  vec2 surfUvY(vec3 p, float s) { return vec2(p.x, p.z * s) * uSurfScale; }
  vec2 surfUvZ(vec3 p, float s) { return vec2(p.x * s, p.y) * uSurfScale; }

  #ifdef SURF_POM
  // 지배축 평면에서의 시차 행진: uv0 입력, 뷰 벡터의 접평면 성분 vt(높이 1당 uv 이동).
  // gx/gy: 호출자가 **균일 제어 흐름**에서 계산한 uv0의 화면 미분. 루프(break)·지배축 분기 안의 암시 미분은
  // GLSL ES 3.0 §8.9상 정의되지 않는다 — SwiftShader에서 이웃 레인의 잔여값을 읽어 LOD가 실행마다 흔들렸다
  // (C3 종료 캡처 hanji_silhouette 1픽셀 1LSB 비결정, GRANITE 상면 POM 활성 — CONTRACT-NOTES C3 기록). textureGrad로 고정.
  vec2 surfPom(vec2 uv0, vec2 vt, vec2 gx, vec2 gy) {
    const int STEPS = 8;
    float layer = 1.0 / float(STEPS);
    vec2 duv = vt * uPomScale * uSurfScale * layer;
    float depth = 0.0; vec2 uv = uv0;
    float h = 1.0 - textureGrad(normalMap, uv, gx, gy).a;
    float prevH = h; vec2 prevUv = uv;
    for (int i = 0; i < STEPS; i++) {
      if (depth >= h) break;
      prevUv = uv; prevH = h;
      uv -= duv; depth += layer;
      h = 1.0 - textureGrad(normalMap, uv, gx, gy).a;
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
    // R4 N5 (R2 S05 '처마 아래 청백 띠 지글거림', S04 격자선): 원경 15–40 m 에서 단청 무늬를 평균색(고 LOD)으로 접고 노멀을 눌러 공포·창방
    // 대역의 고주파를 줄인다 — 텍스처 성분만(공포 기하 밀도는 P1). 거리 함수·유니폼 없음, 순열 불변.
    {
      float lodFade = smoothstep(15.0, 40.0, length(cameraPosition - vSurfWPos));
      if (lodFade > 0.0) { surfAlbedo = mix(surfAlbedo, textureLod(map, luv, 7.0), lodFade); tn.xy *= 1.0 - lodFade; }
    }
    // 노멀 합성은 지배 월드축 프레임으로 근사
    vec3 nX = vec3(sgn.x * tn.z, tn.y, tn.x), nY = vec3(tn.x, sgn.y * tn.z, tn.y), nZ = vec3(tn.x, tn.y, sgn.z * tn.z);
    surfTn = normalize(nX * surfW.x + nY * surfW.y + nZ * surfW.z);
  }
  #else
  {
    vec3 p = vSurfWPos;
    vec2 uvX = surfUvX(p, sgn.x), uvY = surfUvY(p, sgn.y), uvZ = surfUvZ(p, sgn.z);
    { vec3 oo = surfOriginOffset(vSurfOrigin); uvX += oo.yz; uvY += oo.xz; uvZ += oo.xy; } // R4 기둥 결 다양화 (상수 오프셋 — 미분 불변)
    #ifdef SURF_POM
    {
      // 화면 미분은 분기 전(균일 흐름)에서 3축 모두 계산 — surfPom 주석
      vec2 gXx = dFdx(uvX), gXy = dFdy(uvX), gYx = dFdx(uvY), gYy = dFdy(uvY), gZx = dFdx(uvZ), gZy = dFdy(uvZ);
      vec3 V = normalize(cameraPosition - vSurfWPos);
      float dist = length(cameraPosition - vSurfWPos);
      float fade = 1.0 - smoothstep(4.0, 8.0, dist);
      if (fade > 0.0) {
        // 지배축 하나만 시차 행진 (비용 상한)
        if (surfW.x >= surfW.y && surfW.x >= surfW.z) {
          vec2 vt = vec2(V.z * sgn.x, V.y) / max(abs(V.x), 0.2) * fade;
          uvX = surfPom(uvX, vt, gXx, gXy);
        } else if (surfW.y >= surfW.z) {
          vec2 vt = vec2(V.x, V.z * sgn.y) / max(abs(V.y), 0.2) * fade;
          uvY = surfPom(uvY, vt, gYx, gYy);
        } else {
          vec2 vt = vec2(V.x * sgn.z, V.y) / max(abs(V.z), 0.2) * fade;
          uvZ = surfPom(uvZ, vt, gZx, gZy);
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
    // R1 수정 D: 저주파 거시 변조 — 근경·원경이 같은 잔점 질감(R1 S03·S06·S10·S12)에 10~30m 규모의 알베도·거칠기
    // 변화를 준다. 유니폼 게이트(대부분 재질 0) — 프로그램 순열 불변.
    if (uMacro > 0.0) {
      float mac = surfMacro(p);
      surfAlbedo.rgb *= 1.0 + uMacro * (mac - 0.5) * 2.0;
      surfORM.g = clamp(surfORM.g + uMacro * 0.6 * (mac - 0.5), 0.0, 1.0);
    }
    // R1 수정 C: 지붕 셸(ROOF_SOIL) 하면 = 서까래 + 앙토. 눈높이에서 보이는 팔작지붕 면은 보토 셸 하면이라(C3 기록)
    // 흙벽 잔점 질감이 '베이지 천·방수포'로 오독됐다(R1 S01·S02·S05·S06·S11). 서까래는 경사 방향(면 노멀의 수평 성분)과
    // 평행하므로 그 수직 방향으로 간격 uUnder.y 마다 폭 uUnder.z 의 목재 띠를 놓는다. 하면(surfN.y<−0.3)에서만.
    if (uUnder.x > 0.0 && surfN.y < -0.3) {
      vec2 hn = surfN.xz; float hl = length(hn); hn = hl > 1e-3 ? hn / hl : vec2(1.0, 0.0);
      float across = dot(p.xz, vec2(-hn.y, hn.x));
      float ph = fract(across / uUnder.y);
      float dm = abs(ph - 0.5) * uUnder.y;                 // 서까래 중심으로부터 거리 (m)
      float rafter = 1.0 - smoothstep(uUnder.z * 0.5 - 0.01, uUnder.z * 0.5 + 0.01, dm);
      rafter *= 1.0 - smoothstep(12.0, 30.0, length(cameraPosition - vSurfWPos)); // R3: 원거리 줄무늬 앨리어싱(R2 S10 스페클) — 12~30 m 페이드
      surfAlbedo.rgb = mix(surfAlbedo.rgb, uUnderColor, rafter * uUnder.x);
      surfORM.g = mix(surfORM.g, 0.85, rafter);
      surfORM.r *= 1.0 - uUnder.w * (1.0 - rafter) * (1.0 - smoothstep(0.0, 0.12, dm - uUnder.z * 0.5)); // 서까래 옆 앙토 그늘
    }
  }
  #endif
  #ifdef SURF_GROUND_AO
  {
    // R4 접지 음영: 정적 수직 구조물 풋프린트에서 베이크한 탑다운 AO 를 상향면에만 곱한다 (GTAO 합성과 같은 의미 — 직사·간접 모두).
    // 화면 공간 GTAO 가 눈높이에서 바닥 옆 기둥을 못 보는 한계(측정 1.00)를 메운다.
    vec2 gUv = (vSurfWPos.xz - uGroundAoBounds.xy) * uGroundAoBounds.zw;
    float gao = texture2D(uGroundAoMap, clamp(gUv, 0.0, 1.0)).r;
    surfAlbedo.rgb *= mix(1.0, gao, max(surfN.y, 0.0));
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
 * opts: { mode: 'tri'|'local', pom, wear, scale, pomScale, wearColor, wearWidth, wearAmount, localScale,
 *         macro (R1 D: 거시 변조 진폭), under: { amount, pitch, width, ao } + underColor (R1 C: 지붕 셸 하면 서까래) }
 * 텍스처: mat.map(알베도), mat.normalMap(노멀+높이), mat.roughnessMap=mat.aoMap=mat.metalnessMap(ORM)
 */
export function applySurfaceShader(mat, opts = {}) {
  const mode = opts.mode ?? 'tri';
  mat.defines = mat.defines || {};
  if (mode === 'local') mat.defines.SURF_LOCAL = 1; else mat.defines.SURF_TRI = 1;
  if (opts.pom && mode === 'tri') mat.defines.SURF_POM = 1;
  if (opts.wear) mat.defines.SURF_WEAR = 1;
  if (opts.groundAo?.texture) mat.defines.SURF_GROUND_AO = 1;
  const uniforms = {
    uSurfScale: { value: opts.scale ?? 1.0 },
    uPomScale: { value: opts.pomScale ?? 0.02 },
    uWearColor: { value: opts.wearColor ?? { r: 0.5, g: 0.5, b: 0.5 } },
    uWearWidth: { value: opts.wearWidth ?? 0.02 },
    uWearAmount: { value: opts.wearAmount ?? 0.6 },
    uLocalScale: { value: opts.localScale ?? 2.0 },
    uMacro: { value: opts.macro ?? 0.0 },
    uUnder: { value: { x: opts.under?.amount ?? 0.0, y: opts.under?.pitch ?? 0.45, z: opts.under?.width ?? 0.14, w: opts.under?.ao ?? 0.0 } },
    uUnderColor: { value: opts.underColor ?? { r: 0.15, g: 0.11, b: 0.08 } },
    ...(opts.groundAo?.texture ? {
      uGroundAoMap: { value: opts.groundAo.texture },
      uGroundAoBounds: { value: { x: opts.groundAo.bounds.minX, y: opts.groundAo.bounds.minZ, z: 1 / opts.groundAo.bounds.sizeX, w: 1 / opts.groundAo.bounds.sizeZ } },
    } : {}),
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
  mat.customProgramCacheKey = () => 'surf3'; // C3 POM textureGrad 교정(surf2) → R1 거시 변조·서까래 하면(surf3)
  mat.needsUpdate = true;
  return mat;
}
