import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  output: "export",
  typedRoutes: true,
  ...(isDevelopment
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://127.0.0.1:3001/api/:path*",
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
