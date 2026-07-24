/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      // Serve the marketing landing page at the root URL (servio.tn).
      // Only the exact "/" path is rewritten — /api/*, /signup, /account,
      // /dashboard and every other route are untouched.
      beforeFiles: [
        { source: '/', destination: '/landing.html' },
      ],
    }
  },
}
module.exports = nextConfig
