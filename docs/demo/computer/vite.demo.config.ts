// Dev-server config for the computer demos: the app's own config with a different port, API target and cache.
//
// apps/web/vite.config.ts fixes the port (3000) and proxies /api to 127.0.0.1:6000, which is where a developer's own Zetta runs. Using it as
// it is would send the demo to that server. The cache moves too: two dev servers must not write the same node_modules/.vite folder.
import base from "../../../apps/web/vite.config.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (docs/demo/computer/stack.sh sets it)`);
  return value;
};

export default async (env: Record<string, unknown>) => {
  const config = await (typeof base === "function" ? (base as (e: unknown) => unknown)(env) : base);
  const c = config as { server?: Record<string, unknown> };
  return {
    ...c,
    cacheDir: required("ZETTA_DEMO_VITE_CACHE"),
    server: {
      ...c.server,
      port: Number(required("ZETTA_DEMO_WEB_PORT")),
      host: "127.0.0.1",
      proxy: { "/api": { target: required("ZETTA_DEMO_API_URL"), ws: true } },
    },
  };
};
