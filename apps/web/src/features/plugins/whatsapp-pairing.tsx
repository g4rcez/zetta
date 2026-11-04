import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { usePluginApi, usePluginScope } from "./plugins-api";
import { Modal } from "../shared/ui";
import { Alert } from "@g4rcez/components/alert";

type Phase = "checking" | "connected" | "scan" | "error";
const STEPS = ["Reach WAHA", "Scan the QR code", "Session working"];

/** Pairing step for the WhatsApp (WAHA) plugin: the server fetches the QR (the API key never reaches the browser) and returns it as a data URL. The dialog polls the session so the user sees live feedback. */
export function WhatsappPairing({
  onClose,
  onPaired,
}: {
  onClose: () => void;
  onPaired: () => void;
}) {
  const pluginsApi = usePluginApi();
  const scope = usePluginScope();
  const [connected, setConnected] = useState(false);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setConnected(true);
    onPaired();
  }, [onPaired]);

  // Opening the session returns the QR code. WAHA rotates the code about every 20 seconds, so it is fetched again while a code shows.
  const pairing = useQuery({
    queryKey: ["whatsapp-pairing", scope, "session"],
    queryFn: () => pluginsApi.connect("whatsapp"),
    enabled: !connected,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.qrDataUrl ? 18_000 : false),
  });
  const qr = connected ? undefined : pairing.data?.qrDataUrl;
  const message = pairing.data?.message;
  const error = pairing.error ? errorMessage(pairing.error) : undefined;
  const busy = pairing.isFetching;
  const phase: Phase = connected ? "connected" : pairing.error ? "error" : qr ? "scan" : "checking";
  useEffect(() => {
    if (pairing.data && !pairing.data.qrDataUrl) finish();
  }, [pairing.data, finish]);
  // Live status: stop once WAHA reports the session as working.
  const status = useQuery({
    queryKey: ["whatsapp-pairing", scope, "status"],
    queryFn: () => pluginsApi.test("whatsapp"),
    enabled: !connected && pairing.isSuccess,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status.state === "connected" ? false : 3000),
  });
  const statusState = status.data?.status.state;
  useEffect(() => {
    if (statusState === "connected") finish();
  }, [statusState, finish]);

  const step = phase === "connected" ? 3 : phase === "scan" ? 1 : phase === "error" ? 0 : 0;
  return (
    <Modal title="Pair WhatsApp" onClose={onClose}>
      <div className="space-y-3">
        <ol aria-label="Pairing progress" className="flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={`flex-1 rounded-md border px-2 py-1 text-center ${i < step ? "border-primary bg-accent text-foreground" : i === step ? (phase === "error" ? "border-destructive text-destructive" : "border-primary font-medium") : "text-muted-foreground"}`}
            >
              {i < step ? "✓ " : ""}
              {s}
            </li>
          ))}
        </ol>
        {phase === "connected" ? (
          <Alert theme="success">WhatsApp is connected. Bots can now use it.</Alert>
        ) : (
          <p className="text-muted-foreground">
            Open WhatsApp on your phone, go to Linked devices, choose Link a device and scan the
            code. This window updates by itself once the scan works.
          </p>
        )}
        {qr && (
          <img
            src={qr}
            alt="WhatsApp pairing QR code"
            className="mx-auto size-64 rounded-md border bg-white p-2"
          />
        )}
        {phase === "checking" && (
          <p role="status" className="text-xs text-muted-foreground">
            Starting the WhatsApp session...
          </p>
        )}
        {message && phase !== "connected" && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
        {error && <Alert theme="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            {phase === "connected" ? "Done" : "Close"}
          </Button>
          {phase !== "connected" && (
            <Button size="sm" loading={busy} disabled={busy} onClick={() => void pairing.refetch()}>
              {qr ? "Refresh code" : "Show QR code"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
