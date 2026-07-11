import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  experimental: {
    middlewareClientMaxBodySize: "50mb",
    serverActions: {
      bodySizeLimit: "50mb"
    }
  }
};

export default nextConfig;
