import { Alert } from "@g4rcez/components/alert";
import { lazy, Suspense, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { pairingLink, startPairing } from "./pair-phone";

// Loaded when a code is shown, so the QR encoder stays out of the main bundle.
const QrCode = lazy(() => import("@/components/qr-code").then((m) => ({ default: m.QrCode })));
const isLocal = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Shows a QR code that signs a phone in to this account. The code works once and for 3 minutes. */
export function PairPhoneCard({
  start: startCode = startPairing,
}: {
  start?: typeof startPairing;
}) {
  const [pairing, setPairing] = useState<{ url: string; expiresAt: number }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!pairing) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const made = await startCode();
      setPairing({
        url: pairingLink(window.location.origin, made.code),
        expiresAt: new Date(made.expiresAt).getTime(),
      });
    } catch (e) {
      setPairing(undefined);
      setError(e instanceof Error ? e.message : "Could not make a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const expired = pairing !== undefined && left === 0;
  return (
    <div className="space-y-3 pt-4">
      <h3 className="text-sm font-medium">Pair a phone</h3>
      <p className="text-sm text-muted-foreground">
        Scan the code with your phone camera to open Zetta there, already signed in. The phone gets
        its own session, so signing out here does not sign it out.
      </p>
      {isLocal(window.location.hostname) && (
        <p className="text-xs text-muted-foreground">
          This address only works on this computer. Open Zetta from its network address, then make
          the code.
        </p>
      )}
      {error && <Alert theme="danger">{error}</Alert>}
      {pairing && !expired && (
        <div className="space-y-2">
          <Suspense fallback={<div className="size-48 rounded-md border" />}>
            <QrCode
              text={pairing.url}
              label="QR code that signs in a phone"
              className="size-48 rounded-md border"
            />
          </Suspense>
          <p role="status" className="text-xs text-muted-foreground">
            Works once. Valid for {clock(left)}.
          </p>
        </div>
      )}
      {expired && (
        <p role="status" className="text-sm text-muted-foreground">
          The code expired.
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        type="button"
        disabled={busy}
        onClick={() => void start()}
      >
        {pairing ? "New code" : "Pair a phone"}
      </Button>
    </div>
  );
}
