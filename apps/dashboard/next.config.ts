import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dashboard is linted via the repo-root eslint.config.mjs in CI, not by Next's
  // own lint step (which would need eslint-config-next). Keep them from doubling up.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
