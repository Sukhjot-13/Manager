import type { NextConfig } from "next";

// The tracker script and the two ingest endpoints are consumed by other origins on purpose.
// Everything else keeps CORP same-origin.
const crossOriginHeaders = [
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Listed after the catch-all so it wins for these paths.
      { source: "/t.js", headers: crossOriginHeaders },
      { source: "/api/t.js", headers: crossOriginHeaders },
    ];
  },
};

export default nextConfig;
