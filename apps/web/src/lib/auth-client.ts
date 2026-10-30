import { createAuthClient } from "better-auth/react";

import { ENV } from "../env";
import { invalidateAuthGuard } from "./auth-guard";
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

// Any sign-in, sign-out or other write changes who the guard in routes/_auth/route.tsx should let in: forget its cached result.
const authFetch = createAuthenticationFetch();
const customFetchImpl: typeof authFetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method === "GET") return authFetch(input, init);
  invalidateAuthGuard();
  try {
    return await authFetch(input, init);
  } finally {
    invalidateAuthGuard();
  }
};

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", getServerUrl(ENV.VITE_SERVER_URL)).toString(),
  fetchOptions: { customFetchImpl, retry: 0 },
});
