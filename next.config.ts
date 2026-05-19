import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.ngrok-free.dev"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
