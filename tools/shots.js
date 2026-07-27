/**
 * tools/shots.js — 베이스라인 샷 11종 정의 (HARNESS.md §3).
 *
 * 단일 진실: 브라우저(src/main.js의 setShot)와 Node 도구가 같은 파일을
 * import한다 (CONTRACT-NOTES B7). 의존성 없는 순수 데이터 ESM으로 유지할 것.
 *
 * cam: pos/target 월드 좌표(m), fov 도.
 * sun: elev/azim 도(azim 0=북, 90=동, 180=남), intensity.
 * lantern: 등롱 포인트라이트 강도 (0 = 꺼짐. 라이트 자체는 항상 씬에 존재 —
 *          라이트 개수가 변하면 셰이더 순열이 갈라져 프리웜이 깨진다).
 */

/** 샷당 고정 스텝 프레임 수 (CONTRACT-NOTES B6). 60Hz 고정 스텝 1.5초 */
export const FIXED_STEP_FRAMES = 90;

/** 캡처 기본 뷰포트 (HARNESS.md §6 기준 해상도) */
export const VIEW = Object.freeze({ width: 1512, height: 982, dpr: 2 });

/** 부팅 직후·프리웜 복원용 기본 조명 */
export const DEFAULT_VIEW = Object.freeze({
  sun: { elev: 55, azim: 205, intensity: 3.0 },
  hemi: 0.5,
  lantern: 0,
});

/*
 * P1 좌표 갱신 기록 (P1-BRIEF §5 — 신규 샷 없음, 좌표만. 조명·구도 의도는 불변):
 *  - courtyard_noon    target.y 2.4→3.2  — 동헌 용마루 7.35m 실고 반영 (프레이밍)
 *  - daecheong_backlit pos.y 1.9→2.2    — 대청 마루 상면 1.0m + 눈높이
 *  - hanji_silhouette  전좌표            — 대상이 내아 서벽(x=-32)으로 이동, 더미 (-29.5,-10)
 *  - dancheong_closeup 전좌표            — 동헌 다포 공포 실좌표 (brBase 4.35, 처마 5.25)
 *  - roofline_distant  전좌표            — 누각 데크 3.0 위에서 객사·동헌 지붕 스윕
 *  - fog_wall          전좌표            — 구좌표 (-36,16)이 행랑 신축 실내가 됨 → 서벽-행랑 골목
 *  - muzzle_interior   전좌표            — 객사 실내 (마루 1.0 + 눈높이)
 *  - hanji_pierced     전좌표            — 동헌 전면 창호 베이 중심 x=3.2 (베이 [1.6,4.8])
 *  - corridor_columns  pos.x/target.x 38→39.1 — 회랑 마루 중심선 (기둥 열 38/40.2 사이)
 *  - lantern_night / viewmodel_ads — 앵커 불변, 유지
 */
export const SHOTS = Object.freeze([
  {
    name: 'courtyard_noon',
    watch: '노출·그림자 (마당 정오 직사광)',
    cam: { pos: [7, 1.7, 8], target: [0, 3.2, -22], fov: 70 },
    sun: { elev: 68, azim: 190, intensity: 3.2 },
    hemi: 0.55,
    lantern: 0,
  },
  {
    name: 'daecheong_backlit',
    watch: 'EV 적응 (대청 역광, 실내→마당)',
    cam: { pos: [0, 2.2, -26.5], target: [0, 1.3, 20], fov: 70 },
    sun: { elev: 32, azim: 180, intensity: 3.4 },
    hemi: 0.4,
    lantern: 0,
  },
  {
    name: 'hanji_silhouette',
    watch: '반투과 (창호지 너머 실루엣)',
    cam: { pos: [-36.8, 1.9, -10], target: [-32, 1.9, -10], fov: 60 },
    sun: { elev: 28, azim: 90, intensity: 3.0 },
    hemi: 0.35,
    lantern: 0,
  },
  {
    name: 'dancheong_closeup',
    watch: '머티리얼 최악 케이스 (처마·공포 근접)',
    // [P1.5 재조준] 다포 3출목 재구축(주두·소로·첨차·살미·행공·장혀도리)에 맞춰
    // 공포 출목 구조가 프레임 60% 이상을 채우도록 — 공포대 y 4.35..5.9, 외목선 z -18.66.
    // 2~3조가 처마 곡선과 함께 걸리도록 반 발 물러선 앵글
    cam: { pos: [3.6, 3.55, -16.0], target: [5.2, 5.05, -19.7], fov: 50 },
    sun: { elev: 55, azim: 200, intensity: 3.2 },
    hemi: 0.5,
    lantern: 0,
  },
  {
    name: 'roofline_distant',
    watch: 'LOD·대기원근 (기와지붕 원경 — 팔작 vs 맞배 실루엣)',
    // [P1.5 재조준] 팔작 전환에 맞춰 카메라를 남동 담장 상공으로 — 팔작 2동(동헌·객사)과
    // 맞배 계열(내아·행랑·누각·회랑) 실루엣 차이가 한 프레임에 들어온다.
    // (누각 데크 시점은 누각 자기 지붕이, 남서 상공은 누각이 경내를 가려 기각)
    cam: { pos: [30, 8.0, 40], target: [-6, 3.5, -16], fov: 58 },
    sun: { elev: 40, azim: 240, intensity: 3.0 },
    hemi: 0.45,
    lantern: 0,
  },
  {
    name: 'lantern_night',
    watch: '자발광·블룸 (야간 등롱)',
    cam: { pos: [1.2, 1.6, 36.5], target: [5, 2.2, 40], fov: 60 },
    sun: { elev: 35, azim: 300, intensity: 0.02 },
    hemi: 0.05,
    lantern: 9,
  },
  {
    name: 'fog_wall',
    watch: '볼류메트릭 (안개 담장)',
    cam: { pos: [-41.6, 1.8, 0], target: [-43.6, 2.0, -28], fov: 65 },
    sun: { elev: 18, azim: 250, intensity: 2.2 },
    hemi: 0.4,
    lantern: 0,
  },
  {
    name: 'muzzle_interior',
    watch: '트랜지언트 라이트 (실내 총구화염)',
    cam: { pos: [24.8, 1.9, -7.2], target: [30, 1.6, -11.8], fov: 68 },
    sun: { elev: 12, azim: 270, intensity: 1.0 },
    hemi: 0.15,
    lantern: 0,
  },
  {
    name: 'hanji_pierced',
    watch: '동적 투과율 (피격 누적 창호지)',
    cam: { pos: [3.2, 2.2, -17.3], target: [3.2, 2.4, -19.6], fov: 55 },
    sun: { elev: 45, azim: 185, intensity: 3.0 },
    hemi: 0.5,
    lantern: 0,
    // [P2A] 누적 피격 반영: setShot 시 실제 발사 파이프라인으로 결정적 사격.
    // 카빈 3발 + 산탄 1격발(9펠릿) — 시드 스트림 산포라 2회 캡처 비트 동일.
    // 시점은 카메라와 같은 베이 정면 (마커는 프레임 종료 시 제거, 불투명도만 남는다)
    actions: [
      { type: 'fire', weapon: 'CARBINE', rounds: 3, eye: { pos: [3.2, 1.7, -16.2], yaw: 0, pitch: 0.09 } },
      { type: 'fire', weapon: 'SHOTGUN', rounds: 1, eye: { pos: [3.2, 1.7, -16.2], yaw: 0, pitch: 0.09 } },
    ],
  },
  {
    name: 'corridor_columns',
    watch: '그림자 이음매 (회랑 기둥 리듬)',
    cam: { pos: [39.1, 1.7, 17], target: [39.1, 1.9, -30], fov: 62 },
    sun: { elev: 16, azim: 255, intensity: 2.8 },
    hemi: 0.35,
    lantern: 0,
  },
  {
    name: 'viewmodel_ads',
    watch: '뷰모델 조명 리그 (P2A부터 실제 뷰모델 감시)',
    cam: { pos: [0, 1.64, 10], target: [0, 1.5, -24], fov: 58 },
    sun: { elev: 50, azim: 205, intensity: 3.0 },
    hemi: 0.5,
    lantern: 0,
    // [P2A] 카빈 완전 ADS — 뷰모델이 월드 조명 리그로 렌더되는지 감시하는 샷.
    // 이 필드가 없는 샷은 뷰모델을 표시하지 않는다 (씬 검사 샷의 시야 확보)
    viewmodel: { weapon: 'CARBINE', ads: 1 },
  },
]);

export const SHOTS_BY_NAME = new Map(SHOTS.map((s) => [s.name, s]));
