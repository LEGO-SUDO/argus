import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: copies just-what's-needed into .next/standalone for a
  // slim Docker runtime that doesn't need pnpm/node_modules at all.
  output: 'standalone',
  // `@argus/contracts` is a workspace package shipped as TS source — Next
  // needs to compile it through SWC alongside the app.
  transpilePackages: ['@argus/contracts'],
  // Silence the "multiple lockfiles" warning in worktrees by anchoring file
  // tracing at this worktree's repo root (two levels up from apps/web).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // In dev, point /api/* at the api service. The default keeps the local
  // compose URL (http://api:4000) overridable via NEXT_PUBLIC_API_URL.
  // Production deployments typically front the api on the same origin so
  // the rewrite is a no-op there.
  async rewrites() {
    // Rewrites run server-side (in the Next server inside the web container).
    // Use INTERNAL_API_URL (compose: http://api:4000) so the proxy can reach
    // the api over the container network. Fall back to localhost for hybrid
    // and host-only dev modes where the api is on the host.
    const apiOrigin =
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
