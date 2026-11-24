import { ZoomImage } from "@/components/zoom-image";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { ApiError, errorMessage } from "../chat/chat-client";
import { usePluginApi, usePluginScope } from "./plugins-api";
import { Modal } from "../shared/ui";
import { Alert } from "@g4rcez/components/alert";
import { Step, Steps } from "@g4rcez/components/step";

type Phase = "checking" | "connected" | "scan" | "error";
const STEPS = ["Reach WAHA", "Key accepted", "Scan the QR code", "Session working"];

/** The step that failed and what to do about it, from the code the server answers (see `wahaRaw` in the WhatsApp plugin). */
function failure(e: unknown): { step: number; hint: string } {
  const code = e instanceof ApiError ? e.code : "";
  if (code === "AUTH")
    return {
      step: 1,
      hint: "WAHA is running but refused the key. An administrator saves the key of the WAHA server (its WAHA_API_KEY) in Studio > Plugins > WhatsApp > Server for everyone, then press Try again.",
    };
  if (code === "BLOCKED_URL")
    return {
      step: 0,
      hint: "A local address you typed is blocked. An administrator turns on Let the server call private network addresses in Studio > Server settings, or clears the address under Advanced to use the shared server.",
    };
  if (code === "BAD_URL")
    return {
      step: 0,
      hint: "The WAHA address is not a valid http(s) address. Fix it under Advanced.",
    };
  return {
    step: 0,
    hint: "Nothing answered at the WAHA address. Start the WAHA container (default http://127.0.0.1:3010) and press Try again.",
  };
}

/** The library Steps: done steps are checked, the current one is active, and the one that failed shows the error mark. `step` is 0-based. */
function PairingSteps({ step, failed }: { step: number; failed: number | undefined }) {
  const current = Math.min(step, STEPS.length - 1) + 1;
  return (
    <Steps currentStep={current} steps={STEPS.length}>
      {STEPS.map((title, i) => (
        <Step
          key={title}
          step={i + 1}
          currentStep={current}
          title={title}
          type="button"
          tabIndex={-1}
          status={
            step >= STEPS.length || i < step
              ? "complete"
              : i === failed
                ? "error"
                : i === step
                  ? "active"
                  : "inactive"
          }
        />
      ))}
    </Steps>
  );
}

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

  const failed = pairing.error ? failure(pairing.error) : undefined;
  // WAHA answered and took the key as soon as a QR code (or a working session) comes back; the scan is the current step until then.
  const step = phase === "connected" ? 4 : phase === "scan" ? 2 : failed ? failed.step : 0;
  return (
    <Modal title="Pair WhatsApp" onClose={onClose}>
      <div className="space-y-3">
        <p role="status" className="sr-only">
          {phase === "connected"
            ? "All steps done"
            : `Step ${Math.min(step + 1, STEPS.length)} of ${STEPS.length}: ${STEPS[Math.min(step, STEPS.length - 1)]}`}
        </p>
        <PairingSteps step={step} failed={failed?.step} />
        {phase === "connected" ? (
          <Alert theme="success">WhatsApp is connected. Bots can now use it.</Alert>
        ) : phase === "error" ? null : (
          <p className="text-muted-foreground">
            Open WhatsApp on your phone, go to Linked devices, choose Link a device and scan the
            code. This window updates by itself once the scan works.
          </p>
        )}
        {qr && (
          <ZoomImage
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
        {error && (
          <Alert theme="danger">
            <p>{error}</p>
            {failed && <p className="mt-1 text-xs">{failed.hint}</p>}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            {phase === "connected" ? "Done" : "Close"}
          </Button>
          {phase !== "connected" && (
            <Button size="sm" loading={busy} disabled={busy} onClick={() => void pairing.refetch()}>
              {qr ? "Refresh code" : error ? "Try again" : "Show QR code"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
