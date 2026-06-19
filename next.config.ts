import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.ngrok-free.dev"],
  experimental: {
    proxyClientMaxBodySize: '500mb',
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images-api.printify.com" },
      { protocol: "https", hostname: "*.amazonaws.com" },
      { protocol: "https", hostname: "images.printify.com" },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
