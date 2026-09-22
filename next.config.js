const path = require("path")

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  images: {
    // The app only serves a static logo; disabling the optimizer removes the
    // Image Optimization API attack surface entirely.
    unoptimized: true,
  },
  outputFileTracingIncludes: {
    "/*": [path.join(__dirname, "node_modules/.prisma/client/**/*")],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error"] }
        : false,
  },
}

module.exports = nextConfig
