import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite-plus";
import { zettaWellKnown } from "./vite/well-known";

export default defineConfig(({ mode }) => {
  // The browser only talks to this dev server (https://localhost:3000). It forwards /api to the API on localhost:6000, so there is no
  // cross-origin call. HTTPS uses the ZETTA_TLS_CERT/KEY pair when set (see `bun run certs`), otherwise a self-signed basic-ssl certificate.
  const {
    ZETTA_TLS_CERT: cert,
    ZETTA_TLS_KEY: key,
    ZETTA_HOST: host,
    VITE_SERVER_URL: serverUrl,
  } = loadEnv(mode, process.cwd(), ["ZETTA_", "VITE_SERVER_URL"]);
  if (!cert !== !key)
    throw new Error("Set both ZETTA_TLS_CERT and ZETTA_TLS_KEY in apps/web/.env, or neither.");
  return {
    server: {
      port: 3000,
      strictPort: true,
      // ZETTA_HOST=0.0.0.0 (written by `bun run setup --mode lan`) lets other devices on the network open the dev server.
      host: host || undefined,
      https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
      // No changeOrigin: Host and Origin stay localhost:3000, which is what Better Auth checks against BETTER_AUTH_URL.
      proxy: { "/api": { target: "http://127.0.0.1:6000", ws: true } },
    },
    resolve: {
      tsconfigPaths: true,
      // three-render-objects imports the WebGPU renderer for an option the memory graph never uses (it draws with WebGL). The real one is
      // 2.4 MB of source in the 3D chunk, so it is replaced by a stub.
      alias: {
        "three/webgpu": fileURLToPath(new URL("./src/lib/three-webgpu-stub.ts", import.meta.url)),
      },
    },
    plugins: [
      varlockVitePlugin({ ssrInjectMode: "auto-load" }),
      tailwindcss(),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      zettaWellKnown(serverUrl),
      ...(cert && key ? [] : [basicSsl()]),
    ],
  };
});
