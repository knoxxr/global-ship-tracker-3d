# MarineGlobe 3D — 전 세계 실시간 3D 선박 위치 추적 프로그램

전 세계 선박의 실시간 AIS(Automatic Identification System) 위치 데이터를 수신하여 인터랙티브 **3D 지구본** 위에 선종·침로·속력·항적과 함께 시각화하는 해양 관제 웹 애플리케이션입니다.

- **라이브 데모 (GitHub Pages)**: `https://knoxxr.github.io/global-ship-tracker-3d/`
- 외부 npm 의존성 없이 **Node.js 22 내장 WebSocket + HTTP/SSE 서버**와 **고해상도 3D 구면 투영 캔버스 엔진**으로 구성되어 있습니다.

## 주요 기능

- **3D 인터랙티브 지구본 엔진 (`src/public/globe-engine.js`)**
  - 마우스 드래그 회전(관성 포함), 스크롤 확대/축소, 자동 회전
  - 실시간 UTC 태양 위치 기반 **주/야간 경계(Solar Terminator)** 및 야간 항만 조명 표현
  - 한반도·동북아, 말라카·싱가포르, 수에즈·지중해, 유럽·북해, 파나마·미주 등 **주요 해역 카메라 프리셋**
  - 선박의 실제 침로(COG)를 3D 구면 접평면에 투영하여 정확한 진행 방향과 항적(Wake) 표시
- **이중 실시간 AIS 데이터 파이프라인 (`src/server.js`)**
  - **실시간 Live 모드**: [AISStream.io](https://aisstream.io/) 무료 API 키 입력 시 Node.js 22 내장 WebSocket으로 전 세계 실제 선박 AIS(`PositionReport`, `ClassB`, `ShipStaticData`)를 실시간 수신하여 브라우저로 SSE 스트리밍
  - **글로벌 해운 시뮬레이터 모드**: API 키 없이도 12개 주요 국제 해상 항로에서 대권 항법(SLERP)으로 항해하는 336척 선박을 실시간 시뮬레이션
- **선박 검색 · 선종 필터 · 텔레메트리 추적**
  - 선박명, MMSI, IMO, 목적지 항구 코드(UN/LOCODE), 국적별 즉시 검색
  - 6개 선종(컨테이너선, 유조선/LNG, 벌크선, 여객/크루즈, 어선, 특수선) 필터링 및 실시간 척수 집계
  - 선박 클릭 시 상세 텔레메트리(위도/경도, SOG, COG, HDG, 제원, 흘수, 출발지→목적지, ETA) 표시 및 **카메라 자동 추적 잠금**

## 배포 가이드

### 1. GitHub Pages (정적 프론트엔드 자동 배포)
`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 `docs/` 번들을 자동으로 빌드하여 GitHub Pages에 배포합니다.

### 2. Render.com (1-Click 백엔드 + Live AIS 배포)
저장소 루트의 [`render.yaml`](./render.yaml) Blueprint를 사용하면 무료 웹 서비스로 즉시 배포할 수 있습니다.
1. [Render Dashboard](https://dashboard.render.com/) → **New +** → **Blueprint** 선택
2. 이 GitHub 저장소 연결 후 `AISSTREAM_API_KEY` 환경 변수 입력 (선택)

### 3. Docker / Docker Compose
```bash
# Docker 단독 실행
docker build -t marineglobe-3d .
docker run -p 3000:3000 -e AISSTREAM_API_KEY="YOUR_KEY" marineglobe-3d

# Docker Compose 실행
AISSTREAM_API_KEY="YOUR_KEY" docker compose up -d
```

### 4. Fly.io
```bash
fly launch --copy-config --no-deploy
fly secrets set AISSTREAM_API_KEY="YOUR_KEY"
fly deploy
```

## 로컬 실행 및 테스트

```bash
# 기본 실행 (시뮬레이터 모드)
npm start

# 실제 AISStream.io 연동 실행
AISSTREAM_API_KEY="YOUR_API_KEY" npm start

# 단위/통합 테스트 실행
npm test

# GitHub Pages 정적 번들 동기화
npm run build:pages
```
