import { NextRequest, NextResponse } from 'next/server';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

function apiOrigin(): string {
  const configured = (
    process.env.INTERNAL_API_URL ||
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    ''
  ).replace(/\/+$/, '');
  if (configured) return configured;
  // Hardcoded prod fallback so the proxy works even if Vercel doesn't surface
  // the env var. This runs in the Node serverless runtime, so the fetch below
  // resolves DNS normally (no edge DNS_HOSTNAME_RESOLVED_PRIVATE).
  return process.env.NODE_ENV === 'production'
    ? 'https://api-argus.duckdns.org'
    : 'http://localhost:4000';
}

function copyRequestHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers(headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    nextHeaders.delete(header);
  }
  nextHeaders.delete('host');
  return nextHeaders;
}

function copyResponseHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      nextHeaders.append(key, value);
    }
  });
  return nextHeaders;
}

async function proxyApiRequest(req: NextRequest, context: RouteContext): Promise<Response> {
  const origin = apiOrigin();
  if (!origin) {
    return NextResponse.json(
      {
        error: {
          code: 'api_origin_missing',
          message: 'Set INTERNAL_API_URL to the deployed API origin.',
        },
      },
      { status: 502 },
    );
  }

  const { path = [] } = await context.params;
  const upstreamUrl = new URL(`/${path.map(encodeURIComponent).join('/')}`, origin);
  upstreamUrl.search = new URL(req.url).search;

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: copyRequestHeaders(req.headers),
    cache: 'no-store',
    redirect: 'manual',
    ...(hasBody ? { body: await req.arrayBuffer() } : {}),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyResponseHeaders(upstream.headers),
  });
}

export const GET = proxyApiRequest;
export const POST = proxyApiRequest;
export const PUT = proxyApiRequest;
export const PATCH = proxyApiRequest;
export const DELETE = proxyApiRequest;
export const OPTIONS = proxyApiRequest;
export const HEAD = proxyApiRequest;
