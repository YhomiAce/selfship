import path from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

/** Where the NestJS API listens. The browser never calls it directly. */
// `||` (not `??`) so an empty `API_URL=` line also falls back to the default.
const API_URL = process.env.API_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Docs pages are MDX files (src/app/docs/**/page.mdx).
  pageExtensions: ['ts', 'tsx', 'mdx'],
  // Docker images use the self-contained server (`node apps/web/server.js`);
  // local `next start` keeps the normal output.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../..') }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  // The shared package is built to CommonJS in dist/; let Next bundle it.
  transpilePackages: ['@selfship/shared'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  /**
   * Proxy `/api/*` to the NestJS API so the browser only ever talks to the web
   * origin. Auth cookies are then first-party and readable by server components.
   */
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${API_URL}/:path*` }]);
  },
};

/**
 * MDX for the public docs. Plugins are named as strings: Turbopack can't take
 * JavaScript functions. remark-gfm adds tables; rehype-slug gives headings
 * ids, used by the "On this page" list and for linking to a section.
 */
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: ['rehype-slug'],
  },
});

export default withMDX(nextConfig);
