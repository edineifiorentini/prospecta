import type { NextConfig } from "next";

// Em produção (Docker) o gateway nginx encaminha /api para a API.
// No desenvolvimento local, defina API_PROXY_URL (ex.: http://127.0.0.1:4000) para o Next fazer o proxy.
const apiProxy = process.env.API_PROXY_URL;

// Domínios exigidos pela Maps JavaScript API (lista oficial do Google para CSP baseada em domínios)
const GOOGLE_MAPS = {
  script: "https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com blob:",
  img: "https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com",
  connect: "https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:",
};

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${GOOGLE_MAPS.script}` + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org ${GOOGLE_MAPS.img}`,
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src 'self' ${GOOGLE_MAPS.connect}` + (process.env.NODE_ENV === "development" ? " ws: wss:" : ""),
      "frame-src *.google.com",
      "worker-src blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return apiProxy ? [{ source: "/api/:path*", destination: `${apiProxy}/api/:path*` }] : [];
  },
};

export default nextConfig;
