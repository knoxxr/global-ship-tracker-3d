/**
 * MarineGlobe 3D — Lightweight EN / KO Internationalization (English default).
 * Zero external dependencies; works identically in Browser & Node.js tests.
 */

export const SUPPORTED_LANGS = ['en', 'ko'];
let currentLang = 'en';

export const ZONE_LABELS = {
  'korea-strait':     { en: 'Korea Strait',      ko: '한반도·대한해협' },
  'shanghai-taiwan':  { en: 'Shanghai–Taiwan',   ko: '상하이·대만' },
  'japan-tokyo':      { en: 'Tokyo Bay',         ko: '일본·도쿄만' },
  'singapore-malacca':{ en: 'Malacca–Singapore', ko: '말라카·싱가포르' },
  'north-sea':        { en: 'North Sea',         ko: '유럽·북해' },
  'nordic-norway':    { en: 'Norway',            ko: '노르웨이' },
  'baltic-finland':   { en: 'Baltic Sea',        ko: '발트해' },
  'mediterranean':    { en: 'Mediterranean',     ko: '지중해' },
  'suez-redsea':      { en: 'Suez–Red Sea',      ko: '수에즈·홍해' },
  'hormuz-dubai':     { en: 'Hormuz–Dubai',      ko: '두바이·호르무즈' },
  'us-east':          { en: 'US East',           ko: '미동부' },
  'us-west':          { en: 'US West',           ko: '미서부' },
  'panama':           { en: 'Panama Canal',      ko: '파나마 운하' },
  'santos-br':        { en: 'Santos, BR',        ko: '브라질·산토스' },
  'capetown-za':      { en: 'Cape Town',         ko: '케이프타운' },
  'sydney-au':        { en: 'Sydney',            ko: '호주·시드니' },
};

const DICT = {
  en: {
    pageTitle: 'MarineGlobe 3D — Global Real-Time 3D AIS Ship Tracker (Live Only)',
    liveVesselsPrefix: 'Live ',
    ratePrefix: 'Rx ',
    statusLoading: 'Connecting',
    statusConnectingGlobal: 'Connecting Global...',
    statusConnectingServer: 'Connecting...',
    statusGlobalSync: 'Global Sync {pct}%',
    statusFeedError: 'Feed Error',
    statusReconnecting: 'Reconnecting',
    statusRateWait: 'Rate Limit {secs}s',
    fleetTableDesktop: 'All Vessels ({count})',
    fleetTableDesktopInit: 'All Vessels',
    fleetTableMobile: 'Table',
    feedConfigDesktop: 'AIS Feed',
    feedConfigMobile: 'Feed',
    langToggleTitle: 'Switch Language (EN / 한국어)',
    themeToggleTitle: 'Toggle Light / Dark Theme',
    toggleSidebarTitle: 'Toggle Vessel List',
    closeSidebarTitle: 'Close Vessel List',
    sidebarMobileTitle: 'Live Vessel Search & List',
    searchPlaceholder: 'Search vessel, MMSI, IMO, callsign, destination, flag...',
    sortRecent: 'Most Recent',
    sortSpeed: 'Fastest (SOG)',
    sortName: 'Name (A–Z)',
    sortLength: 'Longest (LOA)',
    sortType: 'Ship Type',
    sortDest: 'Destination',
    filteredCount: 'Live: {count}',
    allFilter: 'All',
    favFilter: 'Watch',
    // Bottom toolbar
    btnZoomIn: 'Zoom In',
    btnZoomOut: 'Zoom Out',
    btnScanView: 'Scan View',
    btnScanViewTitle: 'Load live AIS vessels in the current viewport',
    btnScanning: 'Scanning...',
    btnLoadTracks: 'Load Tracks',
    btnLoadTracksTitle: 'Fetch real 24h AIS tracks for visible moving ships',
    btnLoadingTracks: 'Tracks ({done}/{total})',
    btnRefresh: 'Refresh',
    btnRefreshTitle: 'Refresh global live AIS data',
    btnMeasure: 'Measure',
    btnMeasureTitle: 'Great-circle distance, bearing & ETA ruler (click two points)',
    btnShare: 'Share',
    btnShareTitle: 'Copy shareable link for current view / vessel',
    btnSnapshot: 'Capture',
    btnSnapshotTitle: 'Save high-DPI PNG snapshot of the 3D globe',
    btnClusters: 'Clusters',
    btnClustersTitle: 'Auto-cluster dense maritime zones',
    btnMovingOnly: 'Moving Only',
    btnMovingOnlyTitle: 'Show underway vessels (>= 0.5 kn) only',
    btnWakes: 'Tracks',
    btnWakesTitle: 'Show vessel wakes & real 24h AIS trails',
    btnCharts: 'Charts',
    btnChartsTitle: 'Show OSM + OpenSeaMap nautical charts at 12x+ zoom',
    btnBorders: 'Borders',
    btnBordersTitle: 'Show country borders',
    btnDayNight: 'Day/Night',
    btnDayNightTitle: 'Real-time solar day/night terminator',
    btnPorts: 'Ports',
    btnPortsTitle: 'Show major world ports (click for 15NM control filter)',
    btnLabels: 'Labels',
    btnLabelsTitle: 'Show vessel name labels',
    btnAutoRotate: 'Rotate',
    btnAutoRotateTitle: 'Auto-rotate 3D globe',
    // Summary & list
    summaryTracked: 'Tracked Ships',
    summaryUnderway: 'Underway',
    summaryAvgSpeed: 'Avg Speed',
    summaryFastest: 'Top Speed',
    emptyError: 'Live feed error: {err}',
    emptyLoadingGlobal: 'Receiving real AIS vessels from 16 global maritime hubs...',
    emptyLoadingServer: 'Receiving live AIS vessel data...',
    emptyFavorites: 'No watchlisted vessels currently live. Click ☆ in the inspector to add one.',
    emptySearch: 'No live vessels match your search or filter.',
    // Tooltips
    tooltipDest: 'Dest',
    tooltipUnderway: 'Underway',
    tooltipStatic: 'Stationary',
    tooltipShips: '{count} ships',
    tooltipClickZoom: 'Click to zoom into individual vessels',
    // Inspector
    inspectorLoading: 'Loading particulars & 24h track...',
    inspectorFavAdd: 'Add to Watchlist',
    inspectorFavRemove: 'Remove from Watchlist',
    inspectorClose: 'Close',
    secLiveTelemetry: 'Live Navigation Telemetry (AIS)',
    lblGpsCoord: 'Live GPS Position (Decimal / DMS)',
    lblSog: 'Speed Over Ground (SOG)',
    lblCogHdg: 'Course (COG) / Heading (HDG)',
    lblNavStatus: 'Navigational Status',
    secParticulars: 'Voyage & Vessel Particulars (Static AIS)',
    lblDest: 'AIS Destination',
    lblEta: 'AIS Reported ETA',
    lblCallsign: 'Call Sign',
    lblLoaBeam: 'Length (LOA) × Beam',
    lblDraughtTon: 'Draught / Tonnage',
    lblUnreported: 'N/A',
    lblBuiltYear: 'Built {year}',
    lblFirstSeen: 'First seen {date}',
    lblBuiltUnknown: 'Build year N/A',
    lblDraughtShort: 'Draught',
    lblDraughtNA: 'Draught N/A',
    lblDimRef: 'Bow:{a} Stern:{b} Port:{c} Stbd:{d}m',
    secMarineWeather: 'Live Marine Weather (Open-Meteo Marine)',
    lblWave: 'Wave Height / Period',
    lblWavePeriod: 'Period {p}s',
    lblMarineData: 'Marine data',
    lblWindTemp: 'Wind Speed / Sea Temp',
    lblSeaTemp: 'Sea Temp {t}°C',
    lblLiveWeather: 'Live weather',
    secProvenance: 'AIS Feed Provenance',
    lblNetworkStation: 'Network / Station / Channel',
    secTrackLog: 'Recorded Live AIS Track ({count} pts)',
    noTrackLog: 'No recorded AIS track points yet.',
    btnFollowOn: 'Unlock Camera',
    btnFollowOff: 'Follow Vessel',
    btnCenter: 'Center View',
    btnMeasureFromVessel: 'Measure distance & ETA from this vessel',
    btnShareVessel: 'Copy shareable link for this vessel',
    ageJustNow: 'just now',
    ageSecAgo: '{n}s ago',
    ageMinAgo: '{n}m ago',
    ageHrAgo: '{n}h ago',
    // Port filter banner
    portBannerStats: 'Moving {moving} · Moored {moored}',
    portZoneRing: '{name} · {radius}NM Zone',
    portClearTitle: 'Clear port control filter',
    // Fleet modal
    fleetModalTitle: 'Global Live AIS Fleet Directory',
    fleetModalSub: 'Showing {count} live vessels · Click column headers to sort · Click row to track on 3D globe',
    fleetModalSubInit: 'All real-time AIS vessels (click header to sort · click row to track)',
    fleetSearchPlaceholder: 'Filter table by name, MMSI, destination...',
    btnExportCsv: 'Export CSV',
    btnClose: 'Close',
    colName: 'Vessel Name',
    colType: 'Type',
    colClass: 'Class',
    colFlag: 'Flag',
    colMmsi: 'MMSI',
    colImo: 'IMO',
    colCallsign: 'Call Sign',
    colLat: 'Lat',
    colLon: 'Lon',
    colSog: 'SOG',
    colCog: 'COG',
    colDest: 'Destination',
    colDims: 'LOA×Beam / Draught',
    colSource: 'Source',
    colUpdated: 'Updated',
    tableEmpty: 'No live vessels currently received.',
    // Settings modal (Pages)
    modalTitlePages: 'Global Live AIS Feed Settings',
    modalDescPages:
      'Receives <strong>100% real AIS vessel positions</strong> with zero simulation. Default <strong>Open Waters AIS</strong> works with no API key using 16 global tiles + 16 major hubs + automatic un-thinned viewport tiles (z=5/6) & live WebSocket, protected by multi-tab sync and 3-min caching.',
    modalTitleServer: 'Live AIS Feed Settings (Real Data Only)',
    modalDescServer:
      'Streams <strong>100% real AIS data</strong> with zero simulation. Default <strong>Open Waters AIS</strong> works globally with no API key (global tiles + 16 major hubs + live WebSocket).',
    lblDataSource: 'Live Data Source',
    optOpenWatersPages: 'Open Waters AIS (Free · No key · Global Tiles + WebSocket)',
    optDigitrafficPages: 'Fintraffic Digitraffic (Free · No key · Northern Europe / Baltic)',
    optRemoteSse: 'MarineGlobe Custom Backend SSE (Render / Docker / AISStream.io)',
    optOpenWatersServer: 'Open Waters AIS (Default · Free · Global Tiles + WebSocket)',
    optDigitrafficServer: 'Fintraffic Digitraffic (Free · No key · Northern Europe / Baltic)',
    optAisStreamServer: 'AISStream.io (Optional free API key · Global WebSocket)',
    lblOwToken: 'Open Waters Personal Token (Optional — 4× larger live area)',
    phOwToken: 'Optional (leave blank for free anonymous live stream)',
    lblBackendUrl: 'Custom Backend URL (when using Custom Backend SSE)',
    phBackendUrl: 'e.g., https://marineglobe-3d.onrender.com',
    lblAisStreamKey: 'AISStream.io API Key (only for AISStream.io)',
    phAisStreamKey: 'API key from aisstream.io',
    btnApplyFeed: 'Apply Live Feed',
    errInvalidBackendUrl: 'Enter a valid http:// or https:// backend URL.',
    errNeedAisStreamKey: 'Enter your AISStream.io API key to use AISStream.io.',
    // Toasts
    toastFavAdded: '★ Added to watchlist.',
    toastFavRemoved: 'Removed from watchlist.',
    toastVesselLinkCopied: 'Copied shareable vessel link.',
    toastViewLinkCopied: '🔗 Copied shareable view link.',
    toastUrlUpdated: 'Updated link in address bar.',
    toastMeasureFromVessel: '📏 Anchored at {name} — click destination for distance & ETA',
    toastMeasureStart: '📏 Ruler active — click start and destination points on the globe (Esc to exit)',
    toastMeasureEnd: 'Exited ruler mode.',
    toastPortApplied: '⚓ {name} {radius}NM port control filter active',
    toastPortCleared: 'Cleared port control filter.',
    toastSnapshotSaved: '📸 Saved 3D globe PNG snapshot.',
    toastSnapshotErr: 'Failed to capture PNG snapshot.',
    toastRateLimit: 'Rate limit detected — resuming automatically in {secs}s',
    toastFavDeparted: '★ {name} departed ({sog} kn)',
    toastFavMoored: '★ {name} moored / slowed ({sog} kn)',
    toastLangSwitched: 'Switched language to English.',
  },
  ko: {
    pageTitle: 'MarineGlobe 3D — 전 세계 실시간 AIS 선박 추적 (Live Only)',
    liveVesselsPrefix: '실선박 ',
    ratePrefix: '수신 ',
    statusLoading: '수신 중',
    statusConnectingGlobal: '전역 연결 중...',
    statusConnectingServer: '수신 연결 중...',
    statusGlobalSync: '전역 수신 {pct}%',
    statusFeedError: '피드 오류',
    statusReconnecting: '서버 재연결 중',
    statusRateWait: '호출 제한 대기 {secs}s',
    fleetTableDesktop: '전체 선박 표 ({count})',
    fleetTableDesktopInit: '전체 선박 표',
    fleetTableMobile: '선박표',
    feedConfigDesktop: 'AIS 피드 설정',
    feedConfigMobile: '피드',
    langToggleTitle: '언어 전환 (EN / 한국어)',
    themeToggleTitle: '라이트/다크 테마 전환',
    toggleSidebarTitle: '선박 목록 열기/닫기',
    closeSidebarTitle: '선박 목록 닫기',
    sidebarMobileTitle: '실시간 선박 검색 · 목록',
    searchPlaceholder: '선박명, MMSI, IMO, 호출부호, 목적지, 국적 검색...',
    sortRecent: '최근 수신순',
    sortSpeed: '속력 높은순',
    sortName: '선박명순',
    sortLength: '전장 큰순',
    sortType: '선종별',
    sortDest: '목적지순',
    filteredCount: '실시간 수신: {count}척',
    allFilter: '전체',
    favFilter: '관심',
    // Bottom toolbar
    btnZoomIn: '확대',
    btnZoomOut: '축소',
    btnScanView: '현재 화면 수신',
    btnScanViewTitle: '현재 3D 지구본 중앙 해역의 실시간 AIS 선박 수신',
    btnScanning: '수신 중...',
    btnLoadTracks: '화면 항적 로드',
    btnLoadTracksTitle: '현재 화면에 보이는 항해 선박들의 실제 24시간 AIS 항적 불러오기',
    btnLoadingTracks: '항적 수신 중 ({done}/{total})',
    btnRefresh: '새로고침',
    btnRefreshTitle: '전 세계 전역 실시간 재조회',
    btnMeasure: '측정',
    btnMeasureTitle: '대권 거리·방위·ETA 측정 도구 (두 지점 클릭)',
    btnShare: '공유',
    btnShareTitle: '현재 화면·선박 링크 복사',
    btnSnapshot: '캡처',
    btnSnapshotTitle: '현재 3D 지구본 PNG 스냅샷 저장',
    btnClusters: '클러스터',
    btnClustersTitle: '밀집 해역 자동 클러스터링',
    btnMovingOnly: '항해선만',
    btnMovingOnlyTitle: '항해 중인 선박(0.5kn 이상)만 표시',
    btnWakes: '항적',
    btnWakesTitle: '선박 항적(웨이크/실제 24시간 항적) 표시',
    btnCharts: '해도',
    btnChartsTitle: '고배율(12배+) 확대 시 상세 해도 및 OpenSeaMap 항로표지 표시',
    btnBorders: '국경선',
    btnBordersTitle: '국가 국경선 표시',
    btnDayNight: '주/야간',
    btnDayNightTitle: '실시간 태양 주/야간 음영',
    btnPorts: '주요항',
    btnPortsTitle: '세계 주요 항만 표시 (클릭 시 반경 15NM 관제 필터)',
    btnLabels: '라벨',
    btnLabelsTitle: '선박명 라벨 표시',
    btnAutoRotate: '회전',
    btnAutoRotateTitle: '지구본 자동 회전',
    // Summary & list
    summaryTracked: '수신 선박',
    summaryUnderway: '항해 중',
    summaryAvgSpeed: '평균 속력',
    summaryFastest: '최고 속력',
    emptyError: '실시간 수신 오류: {err}',
    emptyLoadingGlobal: '전 세계 16개 주요 해역에서 실제 AIS 선박 데이터를 수신하고 있습니다...',
    emptyLoadingServer: '실시간 AIS 선박 데이터를 수신하고 있습니다...',
    emptyFavorites: '현재 수신 중인 관심 선박이 없습니다. 선박 상세 패널에서 ☆를 눌러 등록하세요.',
    emptySearch: '검색 조건과 일치하는 실시간 선박이 없습니다.',
    // Tooltips
    tooltipDest: '목적지',
    tooltipUnderway: '항해 중',
    tooltipStatic: '정박/저속',
    tooltipShips: '{count}척',
    tooltipClickZoom: '클릭하면 개별 선박으로 확대됩니다',
    // Inspector
    inspectorLoading: '상세·24시간 항적 조회 중...',
    inspectorFavAdd: '관심 선박 등록',
    inspectorFavRemove: '관심 선박 해제',
    inspectorClose: '닫기',
    secLiveTelemetry: '실시간 항해 텔레메트리 (Live AIS)',
    lblGpsCoord: '실시간 GPS 좌표 (Decimal / DMS)',
    lblSog: '대지속력 (SOG)',
    lblCogHdg: '침로 (COG) / 선수 (HDG)',
    lblNavStatus: 'AIS 항해 상태 (Navigational Status)',
    secParticulars: '항차 및 선박 제원 (Static AIS / Particulars)',
    lblDest: 'AIS 보고 목적지',
    lblEta: 'AIS 보고 ETA',
    lblCallsign: '호출부호 (Call Sign)',
    lblLoaBeam: '전장(LOA) × 선폭(Beam)',
    lblDraughtTon: '흘수 / 등록 톤수',
    lblUnreported: '미보고',
    lblBuiltYear: '{year}년 건조',
    lblFirstSeen: '최초 포착 {date}',
    lblBuiltUnknown: '건조연도 미보고',
    lblDraughtShort: '흘수',
    lblDraughtNA: '흘수 미보고',
    lblDimRef: '선수:{a} 선미:{b} 좌현:{c} 우현:{d}m',
    secMarineWeather: '실시간 해상 기상 (Open-Meteo Marine)',
    lblWave: '유의파고 / 파주기',
    lblWavePeriod: '주기 {p}s',
    lblMarineData: '해역 데이터',
    lblWindTemp: '해상 풍속 / 수온',
    lblSeaTemp: '해수온 {t}°C',
    lblLiveWeather: '실시간 기상',
    secProvenance: '수신 기지국 및 출처 (Feed Provenance)',
    lblNetworkStation: '수신 네트워크 / 스테이션 / 채널',
    secTrackLog: '실제 수신 항적 좌표 ({count}개 지점)',
    noTrackLog: '수신된 항적 기록이 없습니다.',
    btnFollowOn: '추적 잠금 해제',
    btnFollowOff: '카메라 추적 잠금',
    btnCenter: '위치로 이동',
    btnMeasureFromVessel: '이 선박에서 거리·ETA 측정',
    btnShareVessel: '이 선박 링크 복사',
    ageJustNow: '방금 전',
    ageSecAgo: '{n}초 전',
    ageMinAgo: '{n}분 전',
    ageHrAgo: '{n}시간 전',
    // Port filter banner
    portBannerStats: '항해 {moving} · 정박 {moored}',
    portZoneRing: '{name} · {radius}NM 관제권',
    portClearTitle: '항만 관제 필터 해제',
    // Fleet modal
    fleetModalTitle: '전 세계 실시간 수신 선박 전체 현황',
    fleetModalSub: '실시간 수신 선박 총 {count}척 표시 중 · 헤더 클릭 정렬 · 행 클릭 시 3D 지구본 즉시 추적',
    fleetModalSubInit: '실제 수신된 모든 AIS 선박 데이터 (헤더 클릭 정렬 · 행 클릭 시 3D 지구본 즉시 추적)',
    fleetSearchPlaceholder: '표 내 선박명·MMSI·목적지 검색...',
    btnExportCsv: 'CSV 내보내기',
    btnClose: '닫기',
    colName: '선박명',
    colType: '선종',
    colClass: 'Class',
    colFlag: '국적',
    colMmsi: 'MMSI',
    colImo: 'IMO',
    colCallsign: '호출부호',
    colLat: '위도',
    colLon: '경도',
    colSog: '속력',
    colCog: '침로',
    colDest: '목적지',
    colDims: '전장×선폭 / 흘수',
    colSource: '수신 출처',
    colUpdated: '수신 시각',
    tableEmpty: '현재 수신된 실시간 선박이 없습니다.',
    // Settings modal
    modalTitlePages: '실시간 글로벌 AIS 피드 설정',
    modalDescPages:
      '가상 시뮬레이션 없이 <strong>100% 실제 AIS 선박 위치</strong>만 수신합니다. 기본 <strong>Open Waters AIS</strong>는 별도 API 키 없이 경량 전역 타일(16개) + 16개 주요 허브 + 확대 시 자동 비축약 타일(z=5/6)과 실시간 WebSocket 스트림을 수신하며, 다중 탭 공유 및 3분 캐시로 호출 제한을 방지합니다.',
    modalTitleServer: '실시간 AIS 피드 설정 (100% 실제 데이터)',
    modalDescServer:
      '가상 시뮬레이션 없이 <strong>100% 실제 AIS 데이터</strong>만 수신합니다. 기본 <strong>Open Waters AIS</strong>는 API 키 없이 전 세계 전역 타일 + 16개 주요 허브 + 실시간 WebSocket 스트림을 바로 수신합니다.',
    lblDataSource: '실시간 데이터 소스',
    optOpenWatersPages: 'Open Waters AIS (무료·키 불필요 · 전 세계 전역 타일 + WebSocket)',
    optDigitrafficPages: 'Fintraffic Digitraffic (무료·키 불필요 · 북유럽/발트해 공식)',
    optRemoteSse: 'MarineGlobe 커스텀 백엔드 SSE (Render/Docker/AISStream.io)',
    optOpenWatersServer: 'Open Waters AIS (기본 · 무료 · 전 세계 전역 타일 + WebSocket)',
    optDigitrafficServer: 'Fintraffic Digitraffic (무료 · 키 불필요 · 북유럽/발트해 공식)',
    optAisStreamServer: 'AISStream.io (무료 API 키 선택 · 전 세계 WebSocket)',
    lblOwToken: 'Open Waters 개인 토큰 (선택 — 실시간 수신 영역 4배 확장)',
    phOwToken: '선택 사항 (비우면 익명 무료 실시간 스트림)',
    lblBackendUrl: '커스텀 백엔드 URL (커스텀 백엔드 선택 시)',
    phBackendUrl: '예: https://marineglobe-3d.onrender.com',
    lblAisStreamKey: 'AISStream.io API 키 (AISStream.io 선택 시)',
    phAisStreamKey: 'aisstream.io에서 발급받은 API 키',
    btnApplyFeed: '실시간 피드 적용',
    errInvalidBackendUrl: '올바른 http:// 또는 https:// 백엔드 URL을 입력하세요.',
    errNeedAisStreamKey: 'AISStream.io 선택 시 API 키를 입력하세요.',
    // Toasts
    toastFavAdded: '★ 관심 선박에 등록했습니다.',
    toastFavRemoved: '관심 선박에서 해제했습니다.',
    toastVesselLinkCopied: '선박 공유 링크를 복사했습니다.',
    toastViewLinkCopied: '🔗 현재 화면 공유 링크를 복사했습니다.',
    toastUrlUpdated: '주소창 링크가 업데이트되었습니다.',
    toastMeasureFromVessel: '📏 {name} 출발점 고정 — 목적지를 클릭해 거리·ETA를 측정하세요',
    toastMeasureStart: '📏 거리·방위 측정 모드 — 지구본에서 출발지·목적지를 순서대로 클릭하세요 (Esc 종료)',
    toastMeasureEnd: '거리 측정을 종료했습니다.',
    toastPortApplied: '⚓ {name} 반경 {radius}NM 항만 관제 필터 적용',
    toastPortCleared: '항만 관제 필터를 해제했습니다.',
    toastSnapshotSaved: '📸 현재 3D 지구본 PNG 스냅샷을 저장했습니다.',
    toastSnapshotErr: 'PNG 캡처 중 오류가 발생했습니다.',
    toastRateLimit: '동시 접속 호출 제한 감지 — {secs}초 후 자동 재개됩니다',
    toastFavDeparted: '★ {name} 출항 감지 ({sog} kn)',
    toastFavMoored: '★ {name} 정박/감속 감지 ({sog} kn)',
    toastLangSwitched: '언어를 한국어로 전환했습니다.',
  },
};

export function resolveInitialLang(savedLang) {
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'ko' || q === 'en') return q;
  }
  if (savedLang === 'ko' || savedLang === 'en') return savedLang;
  return 'en'; // English default
}

export function getLang() {
  const g = globalThis.__mgLang;
  return g === 'ko' || g === 'en' ? g : currentLang;
}

export function setLang(lang) {
  currentLang = lang === 'ko' ? 'ko' : 'en';
  globalThis.__mgLang = currentLang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLang;
  }
  return currentLang;
}

export function t(key, params = null, langOverride = null) {
  const lang = langOverride || getLang();
  const table = DICT[lang] || DICT.en;
  let str = table[key] ?? DICT.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function getVesselTypeLabel(meta, short = false, langOverride = null) {
  const lang = langOverride || getLang();
  if (!meta) return '';
  if (lang === 'ko') return short ? meta.short : meta.label;
  return short ? (meta.shortEn || meta.short) : (meta.labelEn || meta.label);
}

export function getPortDisplayName(port, langOverride = null) {
  const lang = langOverride || getLang();
  if (!port) return '';
  return lang === 'ko' ? port.name : (port.nameEn || port.name);
}

export function getSeaDisplayName(sea, langOverride = null) {
  const lang = langOverride || getLang();
  if (!sea) return '';
  return lang === 'ko' ? sea.name : (sea.nameEn || sea.name);
}

export function getZoneLabel(zoneId, fallback = '', langOverride = null) {
  const lang = langOverride || getLang();
  const entry = ZONE_LABELS[zoneId];
  if (!entry) return fallback;
  return entry[lang] || entry.en || fallback;
}

/**
 * Applies translations to all static DOM elements annotated with data-i18n* attributes.
 */
export function applyStaticI18n(lang = getLang()) {
  const active = setLang(lang);
  if (typeof document === 'undefined') return;

  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria;
    if (key) el.setAttribute('aria-label', t(key));
  });

  const langBtn = document.getElementById('btn-lang');
  if (langBtn) {
    langBtn.textContent = active === 'en' ? 'KO' : 'EN';
    langBtn.title = t('langToggleTitle');
  }
}
