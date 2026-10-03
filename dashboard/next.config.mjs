/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // End-to-end tests build a separate demo-mode bundle into its own directory
  // so it never overwrites the production build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The browser reaches the MMR API only through the server-side proxy in
  // app/api/mmr/[...path]/route.ts; there is no rewrite to the API.
  async redirects() {
    return [
      { source: '/settings', destination: '/system', permanent: false },
      // The discrepancy list became the Inbox; old links (and their ?id=) keep working.
      { source: '/discrepancies', destination: '/inbox', permanent: false },
    ];
  },
};

export default nextConfig;
