import { useState, type FormEvent } from "react";
import { Alert } from "@g4rcez/components/alert";

import { BotAvatar } from "@/components/bot-avatar";
import { Button, Input } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Panel } from "../shared/ui";
import { usePluginApi, type PluginMeta } from "./plugins-api";
import { ToggleCard } from "./toggle-card";

type SendMode = "read" | "send";
const MODES: { id: SendMode; title: string; body: string }[] = [
  { id: "read", title: "Read only", body: "Bots can read your chats but never send a message." },
  { id: "send", title: "Read and send", body: "Bots can also send messages on your behalf." },
];
/** Placeholder only: when the field stays empty the server uses its own WAHA (ZETTA_WAHA_URL / ZETTA_WAHA_API_KEY, default the bundled container). */
const DEFAULT_URL = "http://127.0.0.1:3010";

/** Simple WhatsApp install: choose read-only or send, then scan the QR code. The WAHA server details stay behind "Advanced". */
export function WhatsappInstall({
  meta,
  bots,
  onClose,
  onInstalled,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onClose: () => void;
  /** The plugin is stored; the caller opens the QR pairing next. */
  onInstalled: () => void;
}) {
  const pluginsApi = usePluginApi();
  const [mode, setMode] = useState<SendMode>("read");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (key: string) => String(f.get(key) ?? "").trim();
    const config = {
      baseUrl: text("baseUrl"),
      apiKey: text("apiKey"),
      session: text("session"),
      timeFormat: text("timeFormat"),
      allowSend: mode === "send" ? "yes" : "no",
      sendAllowlist: mode === "send" ? text("sendAllowlist") : "",
    };
    setBusy(true);
    setLocal(undefined);
    try {
      await pluginsApi.install(meta.id, config, [...chosen]);
      onInstalled();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Connect WhatsApp">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Connect WhatsApp">
        <p className="text-muted-foreground">
          Link your phone by scanning a QR code. Choose what bots may do, then scan on the next
          screen.
        </p>
        <div role="radiogroup" aria-label="What bots may do" className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${mode === m.id ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30"}`}
            >
              <span className="font-medium">{m.title}</span>
              <span className="text-xs text-muted-foreground">{m.body}</span>
            </button>
          ))}
        </div>
        {bots.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium">Let these bots use it (optional)</legend>
            {bots.map((b) => (
              <ToggleCard
                key={b.id}
                leading={<BotAvatar bot={b} size={40} />}
                title={b.name}
                description={b.description}
                label={`${b.name} can use ${meta.name}`}
                checked={chosen.has(b.id)}
                onChange={(on) =>
                  setChosen((s) => {
                    const n = new Set(s);
                    if (on) n.add(b.id);
                    else n.delete(b.id);
                    return n;
                  })
                }
              />
            ))}
          </fieldset>
        )}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Leave these empty to use the WhatsApp server your administrator set up. Unofficial
              API: WhatsApp may restrict accounts that automate messaging.
            </p>
            <Input
              title="WAHA base URL"
              name="baseUrl"
              type="url"
              placeholder={DEFAULT_URL}
              info="Private addresses such as localhost require the administrator to enable private networks."
              autoComplete="off"
            />
            <Input
              title="WAHA API key"
              name="apiKey"
              type="password"
              placeholder="Optional"
              info="Sent as X-Api-Key. Leave empty if your WAHA has no key. Stored encrypted."
              autoComplete="off"
            />
            <Input title="Session name" name="session" placeholder="default" />
            <Input title="Time format (24h/12h)" name="timeFormat" placeholder="24h" />
            {mode === "send" && (
              <Input
                title="Send only to"
                name="sendAllowlist"
                placeholder="5511999999999, 1203630...@g.us"
                info="Comma separated numbers or chat ids. Empty means any chat."
              />
            )}
          </div>
        </details>
        {local && <Alert theme="danger">{local}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Continue to QR code
          </Button>
        </div>
      </form>
    </Panel>
  );
}
