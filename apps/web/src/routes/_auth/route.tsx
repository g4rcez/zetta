import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

import { AppShell } from "@/components/app-shell";
import { inApp } from "@/components/header";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { cachedAuthGuard } from "@/lib/auth-guard";
import { SidebarDataProvider } from "@/features/chat/sidebar-data";
import { IdentityRequestError, getIdentityError, identityClient } from "@/lib/identity-client";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  pendingComponent: () => (
    <p className="p-6" role="status">
      Checking your membership…
    </p>
  ),
  errorComponent: AccessError,
  beforeLoad: () =>
    cachedAuthGuard(async () => {
      // Both requests start together. The identity result still decides first, so its errors and redirect keep priority.
      const sessionRequest = authClient.getSession();
      sessionRequest.catch(() => {}); // surfaced below only when the identity is active
      const identity = await statusWithRetry();
      if (identity.state !== "active") throw redirect({ to: "/login" });
      const session = await sessionRequest;
      if (!session.data) throw redirect({ to: "/login" });
      return { session, identity };
    }),
});

const RETRY_DELAYS_MS = [400, 1200];

// The status check is an idempotent GET, so transient network blips are retried before surfacing an error.
async function statusWithRetry() {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await identityClient.status();
    } catch (error) {
      if (!(error instanceof IdentityRequestError) || error.code !== "IDENTITY_UNAVAILABLE")
        throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return identityClient.status();
}

function AccessError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const retry = () => {
    setRetrying(true);
    reset();
    void router.invalidate().finally(() => setRetrying(false));
  };

  // Recover on its own once the connection is back.
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  });

  return (
    <section className="mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-6 rounded-xl border bg-card p-8 text-center">
      <Logo size={72} />
      <div className="space-y-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-balance outline-none"
        >
          Zetta cannot confirm your access
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Zetta could not finish checking your access, so it cannot open your workspace yet.
        </p>
      </div>
      <p
        role="alert"
        className="flex w-full items-start gap-2 rounded-lg bg-destructive/10 p-3 text-left text-sm text-destructive"
      >
        <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{getIdentityError(error)}</span>
      </p>
      <div className="flex w-full flex-col gap-3">
        <Button onClick={retry} disabled={retrying} aria-busy={retrying} className="w-full">
          {retrying ? "Checking…" : "Retry access check"}
        </Button>
        <Link
          to="/login"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Return to sign in
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Zetta retries by itself when your connection returns.
      </p>
    </section>
  );
}

function AuthLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <SidebarDataProvider>
      {inApp(pathname) ? (
        <AppShell>
          <Outlet />
        </AppShell>
      ) : (
        <Outlet />
      )}
    </SidebarDataProvider>
  );
}
