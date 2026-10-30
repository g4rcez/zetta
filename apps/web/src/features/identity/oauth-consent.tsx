import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { isAppUrl, signedOAuthQuery } from "./oauth";

const SCOPES: Record<string, string> = {
  "mcp:read": "See your bots, chats, integrations, routines, wiki and tasks",
  "mcp:write":
    "Create and change bots, chats, integrations, routines, wiki pages and tasks for you",
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you disconnect it",
};

type Client = { client_id: string; client_name?: string; client_uri?: string };
type State =
  | { kind: "loading" }
  | { kind: "ready"; client: Client }
  | { kind: "signed-out" }
  | { kind: "invalid" };

/**
 * An MCP client asks to act for the signed-in member. The client's name is its own claim, so the page also shows the host that
 * published it (the CIMD client id is an HTTPS URL on that host).
 */
export function OAuthConsent() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("client_id") ?? "";
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);

  useEffect(() => {
    if (!clientId || !signedOAuthQuery()) return setState({ kind: "invalid" });
    let alive = true;
    authClient
      .$fetch<Client>("/oauth2/public-client", { query: { client_id: clientId } })
      .then(({ data, error: failure }) => {
        if (!alive) return;
        if (data) setState({ kind: "ready", client: data });
        else setState({ kind: failure?.status === 401 ? "signed-out" : "invalid" });
      })
      .catch(() => alive && setState({ kind: "invalid" }));
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (state.kind !== "loading") heading.current?.focus();
  }, [state.kind]);

  async function decide(accept: boolean) {
    setPending(true);
    setError(null);
    try {
      const { data } = await authClient.$fetch<{ url?: string }>("/oauth2/consent", {
        method: "POST",
        body: { accept, oauth_query: signedOAuthQuery() },
      });
      if (!data?.url) throw new Error("no redirect");
      if (isAppUrl(data.url)) {
        const url = new URL(data.url);
        await navigate({ href: url.pathname + url.search, replace: true });
      } else window.location.assign(data.url);
    } catch {
      setError("Could not reach Zetta. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <section className="mx-auto mt-16 w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-sm">
      <Logo size={56} className="mx-auto" />
      {state.kind === "loading" && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          Loading the request…
        </p>
      )}
      {state.kind === "invalid" && (
        <>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-center text-2xl font-semibold tracking-tight outline-none"
          >
            This request is not valid
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            The link expired or was changed. Start the connection again from your app.
          </p>
        </>
      )}
      {state.kind === "signed-out" && (
        <>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-center text-2xl font-semibold tracking-tight outline-none"
          >
            Sign in to continue
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            Your session ended. Sign in, then start the connection again from your app.
          </p>
          <Link
            to="/login"
            className="block text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to sign in
          </Link>
        </>
      )}
      {state.kind === "ready" && (
        <>
          <div className="space-y-2 text-center">
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              Connect {state.client.client_name || "this app"} to Zetta?
            </h1>
            <p className="text-sm text-muted-foreground">
              Published by{" "}
              <span className="font-medium text-foreground">{hostOf(state.client.client_id)}</span>.
              Only allow apps you started connecting yourself.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">It will be able to:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {scopes.map((scope) => (
                <li key={scope}>{SCOPES[scope] ?? scope}</li>
              ))}
            </ul>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() => void decide(false)}
            >
              Deny
            </Button>
            <Button className="flex-1" disabled={pending} onClick={() => void decide(true)}>
              {pending ? "Connecting…" : "Allow"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function hostOf(clientId: string) {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}
