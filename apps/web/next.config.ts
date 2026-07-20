import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bitpix/contracts"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
