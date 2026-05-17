import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pmplatform/ui-kit", "@pmplatform/design-tokens"],
};
export default config;
