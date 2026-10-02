/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The browser reaches the MMR API only through the server-side proxy in
  // app/api/mmr/[...path]/route.ts — there is no rewrite to the API.
  async redirects() {
    return [{ source: '/settings', destination: '/system', permanent: false }];
  },
};

export default nextConfig;
