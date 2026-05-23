import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '**.mzstatic.com' },
      { protocol: 'https', hostname: 'via.placeholder.com' },
    ],
  },
  // Next 16 blockt cross-origin Requests auf /_next/* per Default. Wenn das
  // Phone den Mac über LAN-IP erreicht, scheitert die Hydration mit 403, die
  // Seite rendert SSR-only und reagiert auf nichts. Private RFC1918-Bereiche
  // explizit erlauben.
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*', '172.17.*.*', '172.18.*.*', '172.19.*.*',
    '172.20.*.*', '172.21.*.*', '172.22.*.*', '172.23.*.*',
    '172.24.*.*', '172.25.*.*', '172.26.*.*', '172.27.*.*',
    '172.28.*.*', '172.29.*.*', '172.30.*.*', '172.31.*.*',
  ],
};

export default nextConfig;
