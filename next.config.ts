import type { NextConfig } from "next";

const aiHubGatewayPort = process.env.AI_HUB_GATEWAY_PORT || "8215";
const aiHubGatewayOrigin =
  process.env.AI_HUB_GATEWAY_ORIGIN || `http://127.0.0.1:${aiHubGatewayPort}`;

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.ngrok-free.dev"],
  async rewrites() {
    return [
      {
        source: "/__backend/:path*",
        destination: `${aiHubGatewayOrigin}/__backend/:path*`,
      },
    ];
  },
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
