# MarineGlobe 3D — Cloudflare Workers Shared Edge Cache Relay

서버 유지비 없이(Cloudflare 무료 티어 100,000 req/일) 다수의 동시 접속자가 Open Waters AIS 타일(`z=2~6`)과 BBOX/선박 상세 응답을 **Cloudflare Edge Cache(2~3분 TTL)**에서 공유하도록 해주는 단일 파일 프록시입니다.

## 배포 방법

```bash
cd workers
npx wrangler login
npx wrangler deploy
```

선택적으로 Open Waters 개인 토큰을 워커 시크릿으로 등록하면 수신 영역이 4배 확장됩니다:

```bash
npx wrangler secret put OPENWATERS_TOKEN
```

## MarineGlobe 3D 연동

배포된 워커 URL을 GitHub Pages 주소의 `?relay=` 파라미터로 전달하면 즉시 공유 엣지 캐시 모드로 동작합니다:

```text
https://knoxxr.github.io/global-ship-tracker-3d/?relay=https://marineglobe-ais-relay.<your-subdomain>.workers.dev
```
