import { Alert } from "@g4rcez/components/alert";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { AdvancedSection } from "@/components/advanced-section";
import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import type { FormCardData } from "../chat/form-card-data";
import { Guidance } from "./mail-connect-page";
import { mailApi, type Detection } from "./mail-api";
import {
  draftFromDetection,
  EMPTY_SERVERS,
  saveFailure,
  ServerFieldset,
  serverFields,
  type SaveFailure,
  type ServerDraft,
  type ServerProblem,
} from "./mail-servers";

type Props = {
  data: FormCardData;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
};

/**
 * The form the Chief opens to connect a mailbox (`zetta:mailbox` connect). The address and the name it suggested are only a start: the
 * servers are looked up here, in the browser, with the person's own session, and the password is typed here and sealed before it leaves
 * (`mailApi.connect`), so the chat and the model never see it.
 */
export function MailConnectCard({ data, busy, setBusy, onDone, onCancel }: Props) {
  const qc = useQueryClient();
  const [address, setAddress] = useState(data.prefill.address ?? "");
  const [label, setLabel] = useState(data.prefill.label ?? "");
  const [password, setPassword] = useState("");
  const [servers, setServers] = useState<ServerDraft>(EMPTY_SERVERS);
  const [touched, setTouched] = useState(false);
  const [detection, setDetection] = useState<Detection>();
  const [detected, setDetected] = useState("");
  const [addressError, setAddressError] = useState<string>();
  const [problem, setProblem] = useState<ServerProblem>();
  const [failure, setFailure] = useState<SaveFailure>();
  const ownerBotId = data.prefill.ownerBotId;

  async function detect(raw: string, keepTouched: boolean) {
    const a = raw.trim();
    if (!a || a === detected) return;
    setDetected(a);
    setAddressError(undefined);
    try {
      const found = await mailApi.detect(a);
      setDetection(found);
      if (found.status !== "microsoft" && !keepTouched)
        setServers((s) => draftFromDetection(found, a, s));
    } catch (e) {
      setDetection(undefined);
      setAddressError(errorMessage(e));
    }
  }
  // An address the Chief suggested is looked up at once, so the servers are filled in when the person sees the form.
  useEffect(() => {
    if (data.prefill.address) void detect(data.prefill.address, false);
    // Once, on first show.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(undefined);
    setProblem(undefined);
    if (!address.trim()) return setAddressError("Enter the e-mail address.");
    if (!password) return setFailure({ field: "password", message: "Enter the password." });
    const checked = serverFields(servers);
    if (!checked.ok) return setProblem(checked.problem);
    setBusy(true);
    try {
      await mailApi.connect({
        address: address.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        password,
        ...checked.fields,
        ...(ownerBotId ? { botId: ownerBotId } : {}),
      });
      void qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
      onDone();
    } catch (x) {
      const f = saveFailure(x);
      setFailure(f);
      setBusy(false);
    } finally {
      // The password field is always cleared, whatever the answer: it is typed again.
      setPassword("");
    }
  }

  const blocked = detection?.status === "microsoft";
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="Connect a mailbox">
      <p className="text-muted-foreground">
        Type the password here. It is sealed in your browser, so the chat and the bots never see it.
        {data.prefill.ownerBotName ? ` ${data.prefill.ownerBotName} will own this mailbox.` : ""}
      </p>
      <Input
        title="E-mail address"
        name="address"
        type="email"
        autoComplete="off"
        value={address}
        error={addressError}
        onChange={(e) => setAddress(e.target.value)}
        onBlur={() => void detect(address, touched)}
      />
      {detection && <Guidance detection={detection} />}
      {!blocked && (
        <>
          <Input
            title="Name (optional)"
            name="label"
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            title="Password"
            name="password"
            type="password"
            autoComplete="off"
            value={password}
            error={failure?.field === "password" ? failure.message : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          <AdvancedSection
            title="Advanced: mail servers"
            defaultOpen={failure?.field === "servers" || Boolean(problem)}
          >
            <div className="p-3 pt-0">
              <ServerFieldset
                draft={servers}
                onChange={(patch) => {
                  setTouched(true);
                  setServers((s) => ({ ...s, ...patch }));
                }}
                {...(problem ? { problem } : {})}
                {...(failure?.field === "servers" ? { serversError: failure.message } : {})}
              />
            </div>
          </AdvancedSection>
        </>
      )}
      {failure?.field === "form" && <Alert theme="danger">{failure.message}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        {!blocked && (
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Connect
          </Button>
        )}
      </div>
    </form>
  );
}
