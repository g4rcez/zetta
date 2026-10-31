import { CheckCircleIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Check } from "./google-connect";
import { usePluginApi, type PluginTest } from "./plugins-api";
import { Alert } from "@g4rcez/components/alert";

const REASON: Record<string, string> = {
  ACCESS_DENIED: "The sign-in was not finished. Connect again and allow access.",
  INVALID_STATE: "That sign-in link expired. Try again.",
  STATE_EXPIRED: "That sign-in took too long. Try again.",
  EXCHANGE_FAILED: "Composio could not confirm the account. Try again.",
};

type Toolkit = { slug: string; name: string };
type Info = { toolkits?: (Toolkit & { connected: boolean })[]; allowWrite?: boolean };

/** Studio > Plugins > Composio: choose the toolkits bots may use, sign in to each through Composio's page, switch actions on. The API key never reaches the browser. */
export function ComposioConnect({
  probe,
  onChanged,
  onError,
}: {
  probe?: PluginTest;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const pluginsApi = usePluginApi();
  const info = probe?.status.info as Info | undefined;
  const saved = info?.toolkits ?? [];
  const [allowed, setAllowed] = useState<Toolkit[]>([]);
  const [allowWrite, setAllowWrite] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Toolkit[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const savedKey = saved.map((t) => t.slug).join(",");
  useEffect(() => {
    setAllowed(saved.map(({ slug, name }) => ({ slug, name })));
    setAllowWrite(Boolean(info?.allowWrite));
  }, [savedKey, info?.allowWrite]);
  useEffect(() => {
    // result of the redirect from the server callback: only a flag, never a token
    const q = new URLSearchParams(window.location.search);
    if (q.get("plugin") !== "composio") return;
    const reason = q.get("reason");
    setNotice(
      q.get("status") === "ok"
        ? "Account connected."
        : (REASON[reason ?? ""] ?? "The account could not be connected."),
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const dirty =
    allowed.map((t) => t.slug).join(",") !== savedKey || allowWrite !== Boolean(info?.allowWrite);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const search = () =>
    run(async () => {
      const r = await pluginsApi.connect("composio", { action: "search", query });
      setFound((r.data?.toolkits as Toolkit[] | undefined) ?? []);
    });
  const save = () =>
    run(async () => {
      const r = await pluginsApi.connect("composio", {
        action: "save",
        toolkits: allowed.map((t) => t.slug),
        allowWrite,
      });
      setNotice(r.message ?? "Saved.");
      onChanged();
    });
  const link = (toolkit: string) =>
    run(async () => {
      const r = await pluginsApi.connect("composio", { action: "link", toolkit });
      if (r.authorizeUrl) window.location.assign(r.authorizeUrl);
    });
  const unlink = (toolkit: string) =>
    run(async () => {
      await pluginsApi.connect("composio", { action: "unlink", toolkit });
      onChanged();
    });
  const disconnect = () =>
    run(async () => {
      await pluginsApi.disconnect("composio");
      onChanged();
    });
  const state = (slug: string) => saved.find((t) => t.slug === slug);
  const connectedCount = saved.filter((t) => t.connected).length;
  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Composio connection">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {probe?.status.state === "error" ? (
          probe.status.detail
        ) : saved.length ? (
          <>
            <CheckCircleIcon aria-hidden className="size-4 text-primary" />
            {connectedCount} of {saved.length} allowed toolkits connected
          </>
        ) : (
          "No toolkit allowed yet. Search for the apps bots may use, then save."
        )}
      </p>
      {notice && <Alert theme={notice.endsWith("connected.") ? "success" : "info"}>{notice}</Alert>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            title="Find a toolkit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="github, slack, gmail"
          />
        </div>
        <Button size="sm" type="submit" variant="outline" loading={busy} disabled={busy}>
          <MagnifyingGlassIcon aria-hidden className="size-4" />
          Search
        </Button>
      </form>
      {found.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Search results">
          {found.map((t) => {
            const on = allowed.some((a) => a.slug === t.slug);
            return (
              <li key={t.slug}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={on}
                  onClick={() => setAllowed((a) => [...a, t])}
                >
                  <PlusIcon aria-hidden className="size-3.5" />
                  {t.name}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {allowed.length > 0 && (
        <ul className="space-y-1.5" aria-label="Allowed toolkits">
          {allowed.map((t) => {
            const s = state(t.slug);
            return (
              <li
                key={t.slug}
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                {s ? (
                  s.connected ? (
                    <>
                      <span className="text-xs text-primary">Connected</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void unlink(t.slug)}
                        disabled={busy}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => void link(t.slug)} disabled={busy}>
                      Connect
                    </Button>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">Save to connect</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${t.name}`}
                  onClick={() => setAllowed((a) => a.filter((x) => x.slug !== t.slug))}
                  disabled={busy}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Check checked={allowWrite} disabled={allowed.length === 0} onChange={setAllowWrite}>
        Allow bots to act on my accounts (send, post, create, delete). Off by default; reading needs
        no switch.
      </Check>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} loading={busy} disabled={busy || !dirty}>
          Save
        </Button>
        {saved.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
            Reset session
          </Button>
        )}
      </div>
    </div>
  );
}
