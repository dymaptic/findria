/** @type {import('next').NextConfig} */
const buildDate = new Date().toISOString().slice(0, 10); // e.g. "2026-02-24"

// Optional analytics: allow the configured Plausible script's origin in the CSP
// (plausible.io is always allowed; this adds self-hosted Plausible instances).
let analyticsOrigin = 'https://plausible.io';
try {
  if (process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL) {
    const origin = new URL(process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL).origin;
    if (origin !== analyticsOrigin) analyticsOrigin += ` ${origin}`;
  }
} catch {
  // Invalid URL - ignore and keep the default
}

const nextConfig = {
  output: 'standalone',

  env: {
    NEXT_PUBLIC_BUILD_DATE: buildDate,
  },

  // Empty turbopack config to allow --turbopack flag for dev
  turbopack: {},

  outputFileTracingIncludes: {
    '/': ['./dist/**/*'],
  },

  serverExternalPackages: ['duckdb-async'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.arcgis.com ${analyticsOrigin}`,
              "style-src 'self' 'unsafe-inline' https://js.arcgis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://js.arcgis.com",
              "connect-src 'self' https: https://plausible.io",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
