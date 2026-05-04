import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@ignislink/contracts", "@ignislink/geospatial", "@ignislink/ui"],
  // typedRoutes is unsupported under Turbopack today.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "*.tiles.mapbox.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
