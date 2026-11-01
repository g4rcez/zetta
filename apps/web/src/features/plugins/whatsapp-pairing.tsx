import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { usePluginApi, type PluginTest } from "./plugins-api";
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
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [phase, setPhase] = useState<Phase>("checking");
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setPhase("connected");
    setQr(undefined);
    onPaired();
  }, [onPaired]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await pluginsApi.connect("whatsapp");
      setMessage(r.message);
      if (r.qrDataUrl) {
        setQr(r.qrDataUrl);
        setPhase("scan");
      } else finish();
    } catch (e) {
      setError(errorMessage(e));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [finish]);

  useEffect(() => {
    void load();
  }, [load]);
  // Live status: stop once WAHA reports the session as working.
  useEffect(() => {
    const t = setInterval(() => {
      if (done.current) return;
      pluginsApi
        .test("whatsapp")
        .then((r: PluginTest) => {
          if (r.status.state === "connected") finish();
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [finish]);
  // WAHA rotates the code about every 20 seconds.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => void load(), 18_000);
    return () => clearInterval(t);
  }, [qr, load]);

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
            <Button size="sm" loading={busy} disabled={busy} onClick={() => void load()}>
              {qr ? "Refresh code" : "Show QR code"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
