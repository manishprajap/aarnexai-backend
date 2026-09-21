import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  basePath: "/aarnexai-backend",
};

export default nextConfig;