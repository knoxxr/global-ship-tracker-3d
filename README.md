# MarineGlobe 3D — 전 세계 실시간 AIS 선박 추적 (100% Live Data Only)

가상 시뮬레이션 데이터 없이 **실제 전 세계 AIS 네트워크**에서 수신되는 선박 위치와 텔레메트리만 3D 지구본 위에 실시간으로 시각화하는 해양 관제 웹 애플리케이션입니다.

- **라이브 웹 앱 (GitHub Pages)**: https://knoxxr.github.io/global-ship-tracker-3d/

## 실시간 데이터 소스 (시뮬레이션 없음)

1. **Open Waters AIS (기본 · 무료 · API 키 불필요)**
   - 글로벌 주요 9개 해역(한반도·대한해협, 말라카·싱가포르, 유럽·북해, 노르웨이, 발트해, 지중해, 미동부, 미서부, 일본)의 실시간 스냅샷(`/v1/vessels`) 및 실시간 WebSocket 푸시(`wss://ais.openwaters.io/v1/stream`)
   - 선박 클릭 시 실제 등록 제원(`/v1/vessels/{mmsi}`) 및 **실제 24시간 AIS 항적(`/track`)** 자동 조회
   - 하단 **`현재 화면 수신`** 버튼으로 3D 지구본에서 보고 있는 임의의 해역을 실시간 스캔·구독
2. **Fintraffic Digitraffic Marine API (무료 · API 키 불필요)**
   - 핀란드 교통인프라청 공식 오픈 AIS REST 피드(`meri.digitraffic.fi`) 직접 수신 및 자동 폴백
3. **AISStream.io (선택 · 무료 API 키)**
   - Node.js 22 백엔드에서 `AISSTREAM_API_KEY` 설정 시 전 세계 WebSocket 실시간 수신

## 데이터 출처 및 라이선스 (Attribution)

- **Open Waters AIS**: https://openwaters.io/ais/
- **Kystverket**: Contains data under the Norwegian licence for Open Government data (NLOD 2.0) distributed by the Norwegian Coastal Administration.
- **BarentsWatch**: Data delivered by BarentsWatch (NLOD 2.0).
- **Fintraffic Digitraffic**: Source: Fintraffic / digitraffic.fi, license CC BY 4.0.
- **AISHub**: AISHub community contributors (https://www.aishub.net/).

## 로컬 실행 및 배포

```bash
# 1. 실시간 Open Waters AIS 서버 실행 (API 키 불필요)
npm start

# 2. AISStream.io 글로벌 실시간 연동 실행
AISSTREAM_API_KEY="YOUR_API_KEY" npm start

# 3. 단위/통합 테스트 실행
npm test

# 4. GitHub Pages 정적 번들 동기화
npm run build:pages
```

Docker / Render / Fly.io 배포 설정은 [`Dockerfile`](./Dockerfile), [`docker-compose.yml`](./docker-compose.yml), [`render.yaml`](./render.yaml), [`fly.toml`](./fly.toml)에 포함되어 있습니다.
