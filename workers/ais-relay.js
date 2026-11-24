/**
 * MarineGlobe 3D — Zero-Cost Cloudflare Workers Shared Edge Cache Relay for Open Waters AIS.
 *
 * Allows hundreds or thousands of concurrent GitHub Pages visitors to share cached
 * Open Waters MVT tiles, hub bounding boxes, and vessel detail/track responses directly
 * from Cloudflare's global Edge Cache (free tier: 100,000 req/day) without hitting
 * Open Waters per-IP rate limits.
 *
 * Usage with MarineGlobe 3D GitHub Pages:
 *   https://knoxxr.github.io/global-ship-tracker-3d/?relay=https://<your-worker>.workers.dev
 */

const UPSTREAM = 'https://ais.openwaters.io';
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
      return new Response(JSON.stringify({ ok: true, service: 'marineglobe-ais-relay' }), {
        status: 200,
        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
      });
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
