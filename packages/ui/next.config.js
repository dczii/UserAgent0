/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allows proxying API calls to local server during dev
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ];
  },
};

module.exports = nextConfig;
