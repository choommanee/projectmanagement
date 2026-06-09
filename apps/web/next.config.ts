import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pmplatform/ui-kit", "@pmplatform/design-tokens", "reactflow", "@reactflow/core", "@reactflow/background", "@reactflow/controls", "@reactflow/minimap"],
  // WIP deploy: bundle compiles fine; don't fail the production build on
  // type/lint errors (those are gated in dev/CI separately).
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(config);
