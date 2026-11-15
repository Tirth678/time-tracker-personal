import type { NextConfig } from "next";

/**
 * Extra hostnames allowed to load dev-only assets, as a comma-separated list
 * (e.g. `*.example.dev`). Only needed when `next dev` is opened through a
 * tunnel, cloud IDE or another device; it has no effect on production builds.
 */
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  allowedDevOrigins,
  // Every corner of the screen is in use on a phone, so the floating badge of
  // `next dev` would cover part of the app. Errors still show up without it.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
