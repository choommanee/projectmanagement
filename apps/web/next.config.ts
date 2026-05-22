import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pmplatform/ui-kit", "@pmplatform/design-tokens"],
};

export default withNextIntl(config);
