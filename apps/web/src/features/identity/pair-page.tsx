import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { redeemPairing } from "../preferences/pair-phone";

const EXPIRED = "This code is not valid anymore. Make a new one on your computer.";

/**
 * Where the QR code of Preferences leads. It trades the code in the address for a session, then moves on. The route passes what
 * happens next, so this page never reads the router.
 */
export function PairPage({
  code,
  onDone,
  onSignIn,
  redeem = redeemPairing,
}: {
  code: string;
  onDone: () => void;
  onSignIn: () => void;
  redeem?: (code: string) => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  // The code works once: a second run of this effect must not spend it again and replace the result with a failure.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Drop the code from the address bar and the history at once.
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) return setError(EXPIRED);
    redeem(code).then(onDone, (e) => setError(e instanceof Error ? e.message : EXPIRED));
  }, [code, onDone, redeem]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-medium">This phone was not signed in</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
          <Button type="button" onClick={onSignIn}>
            Sign in with your email
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-lg font-medium">Signing in…</h1>
          <p role="status" className="text-sm text-muted-foreground">
            Pairing this phone with your account.
          </p>
        </>
      )}
    </main>
  );
}
