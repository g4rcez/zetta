import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite-plus";

export default defineConfig(({ mode }) => {
  // HTTPS for the dev server: the same certificate pair as the API (see apps/server/.env.schema and `bun run certs`).
  const { ZETTA_TLS_CERT: cert, ZETTA_TLS_KEY: key } = loadEnv(mode, process.cwd(), "ZETTA_TLS_");
  if (!cert !== !key)
    throw new Error("Set both ZETTA_TLS_CERT and ZETTA_TLS_KEY in apps/web/.env, or neither.");
  return {
    server: {
      port: 3001,
      https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      varlockVitePlugin({ ssrInjectMode: "auto-load" }),
      tailwindcss(),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
    ],
  };
});
