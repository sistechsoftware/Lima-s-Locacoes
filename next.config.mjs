/** @type {import('next').NextConfig} */
const nextConfig = {
  // necessario para o opennextjs-cloudflare empacotar o app para o Workers
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};
export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Soma o contexto do Cloudflare (wrangler/miniflare) apenas no `next dev`.
// Em `next build`/`next start` o workerd nao e necessario (producao roda no
// entrypoint do Workers) — e nesta maquina o binario do workerd quebra com
// access violation, derrubando o build.
const emDesenvolvimento =
  process.argv.includes("dev") || process.env.npm_lifecycle_event === "dev";
if (emDesenvolvimento) {
  initOpenNextCloudflareForDev();
}
