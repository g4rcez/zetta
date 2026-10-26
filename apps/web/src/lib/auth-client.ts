import { createAuthClient } from "better-auth/react";

import { ENV } from "../env";
import { createAuthenticationFetch } from "./auth-transport";

function getServerUrl(url: string) {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  if (typeof window === "undefined" && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith("/")
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", getServerUrl(ENV.VITE_SERVER_URL)).toString(),
  fetchOptions: { customFetchImpl: createAuthenticationFetch(), retry: 0 },
});
