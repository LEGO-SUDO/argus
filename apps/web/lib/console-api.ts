// console-api — client-safe barrel for the console REST client.
//
// Re-exports ONLY the browser helpers (`console-api.client`). Next.js cannot
// safely have a single module that both imports `server-only` and exports
// browser-callable helpers (Webpack tracks the static import graph, not the
// runtime branch — see lib/use-conversation-history.ts for the same hazard).
// So the server helpers live in `console-api.server.ts` and are imported there
// directly by the `/console` pages; client components import `@/lib/console-api`
// and stay free of `server-only`.

export * from './console-api.client';
