// ─── Server-side proxy to the MMR API ────────────────────────────────────────
// The browser calls /api/mmr/<path>; this handler forwards the request to
// MMR_API_URL/<path> and, when MMR_API_KEY is set, injects it as X-API-Key.
// The key lives only in server env and never reaches the client bundle.
// Upstream status codes and bodies are passed through unchanged.
//
// Note: anyone who can reach this dashboard can use the key's permissions
// through this proxy. In any shared deployment, put the dashboard itself
// behind authentication.

import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Only the read/resolve surface the dashboard uses is reachable. */
const ALLOWED_PREFIXES = ['health/', 'v1/reconciliation/', 'v1/reports/'];
const ALLOWED_EXACT = new Set(['health', 'health/ready']);

/** Response headers worth passing back to the browser. */
const PASS_RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-request-id', 'cache-control'];

const UPSTREAM_TIMEOUT_MS = 15_000;

function upstreamBase(): string {
  return (process.env.MMR_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
}

function json(status: number, detail: string): Response {
  return Response.json({ detail }, { status, headers: { 'cache-control': 'no-store' } });
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (path.some((seg) => seg === '..' || seg === '.' || seg === '')) {
    return json(400, 'Invalid path');
  }
  if (!ALLOWED_EXACT.has(joined) && !ALLOWED_PREFIXES.some((p) => joined.startsWith(p))) {
    return json(404, 'Not proxied');
  }

  // State-changing requests must come from this dashboard's own pages: a
  // cross-site form or fetch would otherwise act with the server-side key.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== req.headers.get('host')) {
      return json(403, 'Cross-origin request rejected');
    }
  }

  const target = `${upstreamBase()}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  // Build headers from scratch: client-supplied credentials are never forwarded.
  const headers = new Headers({ accept: req.headers.get('accept') ?? 'application/json' });
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const requestId = req.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);
  const apiKey = process.env.MMR_API_KEY;
  if (apiKey) headers.set('x-api-key', apiKey);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return json(504, 'The MMR API did not respond in time.');
    }
    return json(502, 'Could not reach the MMR API. Check that it is running and that MMR_API_URL is correct.');
  }

  const responseHeaders = new Headers();
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has('cache-control')) responseHeaders.set('cache-control', 'no-store');

  // Buffer the body: fetch transparently decompresses, so streaming it back
  // with upstream framing headers could corrupt the response.
  const body = upstream.status === 204 || upstream.status === 304 ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export { proxy as GET, proxy as POST };
