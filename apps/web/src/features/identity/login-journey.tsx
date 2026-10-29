import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";
import { getIdentityError, identityClient, type IdentityStatus } from "@/lib/identity-client";

import { installationApi } from "../onboarding/installation-api";
import { EnrollmentForm } from "./enrollment-form";

export function LoginJourney() {
  const navigate = useNavigate();
  const { refetch: refreshSession } = authClient.useSession();
  const [identity, setIdentity] = useState<IdentityStatus | null>(null);
  const [showSignUp, setShowSignUp] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // An administrator whose install onboarding is unfinished resumes it instead of landing in chat.
  const enter = useCallback(
    async (status: Extract<IdentityStatus, { state: "active" }>) => {
      const installation = status.isAdmin ? await installationApi.get().catch(() => null) : null;
      if (installation?.onboarding === "pending")
        await navigate({ to: "/onboarding", replace: true });
      else await navigate({ to: "/chat/{-$chatId}", replace: true });
    },
    [navigate],
  );

  const checkStatus = useCallback(async () => {
    const status = await identityClient.status();
    setIdentity(status);
    if (status.state === "active") {
      setToken("");
      await enter(status);
    }
    return status;
  }, [enter]);

  useEffect(() => {
    let alive = true;
    identityClient
      .status()
      .then(async (status) => {
        if (!alive) return;
        setIdentity(status);
        if (status.state === "anonymous") {
          const setup = await identityClient.setup().catch(() => ({ required: false }));
          if (alive && setup.required) await navigate({ to: "/onboarding", replace: true });
        }
        if (status.state === "active") await enter(status);
      })
      .catch((failure: unknown) => {
        if (alive) setError(getIdentityError(failure));
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [navigate, enter]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(getIdentityError(failure));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function authenticated(invitationToken?: string) {
    setIdentity(null);
    const invitationToAccept = invitationToken ?? token;
    if (invitationToken) setToken(invitationToken);
    await run(async () => {
      if (invitationToken) await refreshSession({ query: { disableCookieCache: true } });
      const status = await checkStatus();
      if (status.state === "anonymous") {
        setShowSignUp(false);
        setError(
          invitationToken
            ? "Your account was created. Sign in to finish accepting your invitation."
            : "Your session could not be confirmed. Sign in again or contact the installation operator.",
        );
      }
      if (status.state === "unenrolled" && invitationToAccept) {
        await identityClient.accept(invitationToAccept.trim());
        setToken("");
        await checkStatus();
      }
    });
  }

  const signOut = () =>
    run(async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign out failed");
      setToken("");
      setIdentity({ state: "anonymous" });
      setShowSignUp(false);
    });

  if (identity?.state === "unenrolled") {
    return (
      <EnrollmentForm
        token={token}
        onTokenChange={setToken}
        pending={pending}
        error={error}
        onSignOut={signOut}
        onRetry={() =>
          run(async () => {
            await checkStatus();
          })
        }
        onAccept={() =>
          run(async () => {
            await identityClient.accept(token.trim());
            setToken("");
            await checkStatus();
          })
        }
      />
    );
  }
  if (identity === null || identity.state === "active") {
    return (
      <section
        className="mx-auto mt-16 w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-sm"
        aria-busy={pending}
      >
        <h1 className="text-2xl font-bold">Checking your access</h1>
        {pending && <p role="status">Checking your membership…</p>}
        {error && (
          <>
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await checkStatus();
                  })
                }
              >
                Retry status
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </>
        )}
      </section>
    );
  }
  return (
    <div>
      {error && (
        <p role="alert" className="mx-auto mt-6 max-w-md px-6 text-sm text-destructive">
          {error}
        </p>
      )}
      {showSignUp ? (
        <SignUpForm onAuthenticated={authenticated} onSwitchToSignIn={() => setShowSignUp(false)} />
      ) : (
        <SignInForm onAuthenticated={authenticated} onSwitchToSignUp={() => setShowSignUp(true)} />
      )}
    </div>
  );
}
