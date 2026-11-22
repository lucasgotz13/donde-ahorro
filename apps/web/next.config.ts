import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@donde-ahorro/core"],
};

export default config;
