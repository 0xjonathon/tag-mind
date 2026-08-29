import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the app to stay interactive when the local dev server is opened
  // through loopback or the current LAN address instead of `localhost`.
  allowedDevOrigins: ['127.0.0.1', '::1', '192.168.18.196'],
};

export default nextConfig;
