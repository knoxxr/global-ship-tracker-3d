/**
 * MarineGlobe 3D — Zero-Cost Cloudflare Workers Shared Edge Cache Relay for Open Waters AIS & NOAA VOS.
 *
 * Allows hundreds or thousands of concurrent GitHub Pages visitors to share cached
 * Open Waters MVT tiles, hub bounding boxes, vessel detail/track responses, and real-time
 * NOAA/WMO Voluntary Observing Ships (VOS) open-ocean reports directly from Cloudflare's
 * global Edge Cache (free tier: 100,000 req/day) without hitting upstream rate limits or CORS blocks.
 *
 * Usage with MarineGlobe 3D GitHub Pages:
 *   https://knoxxr.github.io/global-ship-tracker-3d/?relay=https://<your-worker>.workers.dev
 */

const UPSTREAM = 'https://ais.openwaters.io';
const NDBC_VOS_URL = 'https://www.ndbc.noaa.gov/ship_obs.php?uom=M&time=6';
const ALLOWED_PATH_RE = /^\/v1\/vessels(?:\/tiles\/\d+\/\d+\/\d+|\/\d{5,12}(?:\/track)?)?$/;

function getTtlSeconds(pathname) {
  if (pathname.startsWith('/v1/vessels/tiles/')) return 120;
  if (pathname.endsWith('/track')) return 180;
  if (/^\/v1\/vessels\/\d{5,12}$/.test(pathname)) return 90;
  return 120; // /v1/vessels?bbox=...
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    ...extra,
  };
}

function parseOptionalNum(tok) {
  if (!tok || tok === '-' || tok === 'MM' || tok === '----' || tok === '-----') return null;
  const n = Number(tok);
  return Number.isFinite(n) ? n : null;
}

function parseNdBcVosHtml(html, nowMs = Date.now()) {
  const m = html.match(/to\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2})\s+GMT/i);
  const refEndMs = m
    ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), 0)
    : nowMs;
  const ref = new Date(refEndMs);
  const byPos = new Map();
  let totalObservations = 0;

  for (const raw of html.split(/\r?\n/)) {
    if (!raw.includes('<span>')) continue;
    const cleaned = raw.replace(/<[^>]+>/g, '').trim();
    if (!cleaned || cleaned.startsWith('SHIP ID') || cleaned.startsWith('---')) continue;
    const cols = cleaned.split(/\s+/);
    if (cols.length < 13) continue;
    const callsign = cols[0];
    const hourUtc = Number(cols[1]);
    const lat = Number(cols[2]);
    const lon = Number(cols[3]);
    if (
      !Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23 ||
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -85 || lat > 85 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)
    ) continue;

    totalObservations++;
    let observedAt = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), hourUtc, 0, 0);
    if (observedAt - refEndMs > 3600000) observedAt -= 86400000;

    const windDir = parseOptionalNum(cols[4]);
    const windMs = parseOptionalNum(cols[5]);
    const gustMs = parseOptionalNum(cols[6]);
    const waveM = parseOptionalNum(cols[7]);
    const waveSec = parseOptionalNum(cols[8]);
    const presHpa = parseOptionalNum(cols[9]);
    const airTempC = parseOptionalNum(cols[11]);
    const seaTempC = parseOptionalNum(cols[12]);
    const visKm = cols.length > 14 ? parseOptionalNum(cols[14]) : null;

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const ship = {
      id: `vos_${lat.toFixed(1)}_${lon.toFixed(1)}`,
      callsign,
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      hourUtc,
      observedAt,
      windDir: windDir !== null ? Math.round(windDir) : null,
      windMs: windMs !== null ? Math.round(windMs * 10) / 10 : null,
      windKn: windMs !== null ? Math.round(windMs * 1.94384 * 10) / 10 : null,
      gustMs: gustMs !== null ? Math.round(gustMs * 10) / 10 : null,
      waveM: waveM !== null ? Math.round(waveM * 10) / 10 : null,
      waveSec: waveSec !== null ? Math.round(waveSec * 10) / 10 : null,
      presHpa: presHpa !== null ? Math.round(presHpa * 10) / 10 : null,
      airTempC: airTempC !== null ? Math.round(airTempC * 10) / 10 : null,
      seaTempC: seaTempC !== null ? Math.round(seaTempC * 10) / 10 : null,
      visKm: visKm !== null ? Math.round(visKm * 10) / 10 : null,
      source: 'NOAA/WMO VOS',
    };

    const prev = byPos.get(key);
    if (!prev || ship.observedAt > prev.observedAt) {
      byPos.set(key, ship);
    }
  }

  const ships = Array.from(byPos.values()).sort((a, b) => b.observedAt - a.observedAt);
  return { updatedAt: refEndMs, source: 'NOAA/WMO VOS', windowHours: 6, totalObservations, count: ships.length, ships };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'marineglobe-ais-relay', vos: true }), {
        status: 200,
        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
      });
    }

    // Real-time NOAA/WMO Voluntary Observing Ships (VOS) open-ocean feed (10-min Edge Cache)
    if (url.pathname === '/vos' || url.pathname === '/v1/vos') {
      const cacheKey = new Request('https://marineglobe-edge-cache/vos-v1', { method: 'GET' });
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set('X-MarineGlobe-Cache', 'HIT');
        for (const [k, v] of Object.entries(corsHeaders())) hitHeaders.set(k, v);
        return new Response(cached.body, { status: cached.status, headers: hitHeaders });
      }
      try {
        const upstreamRes = await fetch(NDBC_VOS_URL, {
          headers: { 'User-Agent': 'MarineGlobe3D-EdgeRelay/1.0' },
        });
        if (!upstreamRes.ok) {
          return new Response(JSON.stringify({ error: `NOAA VOS HTTP ${upstreamRes.status}` }), {
            status: 502,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
          });
        }
        const html = await upstreamRes.text();
        const payload = JSON.stringify(parseNdBcVosHtml(html));
        const resToReturn = new Response(payload, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=600, s-maxage=600',
            'X-MarineGlobe-Cache': 'MISS',
          }),
        });
        ctx.waitUntil(cache.put(cacheKey, resToReturn.clone()));
        return resToReturn;
      } catch (err) {
        return new Response(JSON.stringify({ error: err?.message || 'NOAA VOS fetch failed' }), {
          status: 502,
          headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
        });
      }
    }

    if (!ALLOWED_PATH_RE.test(url.pathname)) {
      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    }

    // Strip any user-supplied token from the shared cache key unless explicitly configured in Worker env
    const upstreamUrl = new URL(`${UPSTREAM}${url.pathname}${url.search}`);
    if (env?.OPENWATERS_TOKEN && !upstreamUrl.searchParams.has('key')) {
      upstreamUrl.searchParams.set('key', env.OPENWATERS_TOKEN);
    }

    const cacheKeyUrl = new URL(upstreamUrl.toString());
    cacheKeyUrl.searchParams.delete('key');
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hitHeaders = new Headers(cached.headers);
      hitHeaders.set('X-MarineGlobe-Cache', 'HIT');
      for (const [k, v] of Object.entries(corsHeaders())) hitHeaders.set(k, v);
      return new Response(cached.body, { status: cached.status, headers: hitHeaders });
    }

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: request.headers.get('Accept') || '*/*',
        'User-Agent': 'MarineGlobe3D-EdgeRelay/1.0',
      },
    });

    const ttl = getTtlSeconds(url.pathname);
    const respHeaders = new Headers(upstreamRes.headers);
    for (const [k, v] of Object.entries(corsHeaders())) respHeaders.set(k, v);
    respHeaders.set('X-MarineGlobe-Cache', 'MISS');

    if (upstreamRes.status === 200) {
      respHeaders.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
      const resToReturn = new Response(upstreamRes.body, {
        status: 200,
        headers: respHeaders,
      });
      ctx.waitUntil(cache.put(cacheKey, resToReturn.clone()));
      return resToReturn;
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: respHeaders,
    });
  },
};
