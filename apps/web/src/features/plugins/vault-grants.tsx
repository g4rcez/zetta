import { KeyIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton } from "../shared/ui";
import { Check } from "./google-connect";
import { pluginsApi, type PluginTest } from "./plugins-api";
import { Alert } from "@g4rcez/components/alert";

type Field = "username" | "password" | "totp";
type Grant = { id: string; title: string; origins: string[]; fields: Field[] };
type Item = { id: string; title: string; urls: string[]; fields: Field[]; grant: Grant | null };
const LABEL: Record<Field, string> = {
  username: "Username",
  password: "Password",
  totp: "One-time code",
};

/** Share or edit one login: which sites it may be typed on and which fields. */
function GrantForm({
  pluginId,
  item,
  onSaved,
  onCancel,
  onError,
}: {
  pluginId: string;
  item: Item;
  onSaved: (m?: string) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [fields, setFields] = useState<Set<Field>>(
    new Set(item.grant?.fields ?? item.fields.filter((f) => f !== "totp")),
  );
  const [busy, setBusy] = useState(false);
  const defaults =
    item.grant?.origins.join(", ") ??
    item.urls
      .map((u) => {
        try {
          return new URL(u.includes("://") ? u : `https://${u}`).hostname;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .join(", ");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sites = String(new FormData(e.currentTarget).get("sites") ?? "")
      .split(/[\s,;]+/)
      .filter(Boolean);
    setBusy(true);
    try {
      const r = await pluginsApi.connect(pluginId, {
        grant: { id: item.id, origins: sites, fields: [...fields] },
      });
      onSaved(r.message);
    } catch (x) {
      onError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-2 space-y-2 rounded-md bg-muted/40 p-3"
      aria-label={`Share ${item.title}`}
    >
      <Input
        title="Sites where bots may sign in with it"
        name="sites"
        defaultValue={defaults}
        required
        placeholder="github.com, *.example.com"
        info="Exact hosts, or *.example.com for its subdomains. Only https pages; anything else is refused."
        autoComplete="off"
      />
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 text-xs font-medium">Bots may fill</legend>
        {item.fields.map((f) => (
          <Check
            key={f}
            checked={fields.has(f)}
            onChange={(on) =>
              setFields((s) => {
                const n = new Set(s);
                if (on) n.add(f);
                else n.delete(f);
                return n;
              })
            }
          >
            {LABEL[f]}
          </Check>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy || fields.size === 0}>
          {item.grant ? "Save" : "Share with bots"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Installed-card panel for password managers (1Password, Bitwarden): the logins shared with bots and a vault browser to share more.
 * Values never reach the browser: the server lists titles, sites and which fields exist, and types values itself on the matching site.
 */
export function VaultGrants({
  pluginId,
  name,
  probe,
  onChanged,
  onError,
}: {
  pluginId: string;
  name: string;
  probe?: PluginTest;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const info = probe?.status.info as { mode?: string; grants?: Grant[] } | undefined;
  const grants = info?.grants ?? [];
  const [items, setItems] = useState<Item[]>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setItems(undefined);
  }, [pluginId]);

  async function browse(q = query) {
    setBusy(true);
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect(pluginId, { browse: { query: q.trim() } });
      setItems((r.data?.items as Item[] | undefined) ?? []);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      const r = await pluginsApi.connect(pluginId, { revoke: { id } });
      setNotice(r.message);
      onChanged();
      if (items) void browse();
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  const saved = (m?: string) => {
    setEditing(undefined);
    setNotice(m);
    onChanged();
    if (items) void browse();
  };
  const asItem = (g: Grant): Item =>
    items?.find((i) => i.id === g.id) ?? {
      id: g.id,
      title: g.title,
      urls: g.origins,
      fields: g.fields,
      grant: g,
    };

  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label={`${name} shared logins`}>
      <p className="text-xs text-muted-foreground">
        Bots only see the titles and sites below, never the values. When a bot signs in, Zetta types
        the value itself, and only on these https sites into a matching input.
        {info?.mode ? ` Connected as ${info.mode.replace("-", " ")}.` : ""}
      </p>
      {notice && <Alert theme="info">{notice}</Alert>}

      <section aria-label="Shared logins" className="space-y-1.5">
        <h4 className="text-xs font-medium">Shared logins ({grants.length})</h4>
        {grants.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            Nothing is shared yet. Find a login below and share it with bots.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {grants.map((g) => (
              <li key={g.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                  <span className="text-xs text-muted-foreground">{g.origins.join(", ")}</span>
                  {g.fields.map((f) => (
                    <Badge key={f}>{LABEL[f]}</Badge>
                  ))}
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEditing(editing === g.id ? undefined : g.id)}
                  >
                    Edit
                  </Button>
                  <ConfirmButton
                    size="xs"
                    label="Stop sharing"
                    question={`Stop letting bots use "${g.title}"?`}
                    confirmLabel="Stop sharing"
                    onConfirm={() => revoke(g.id)}
                  />
                </div>
                {editing === g.id && (
                  <GrantForm
                    pluginId={pluginId}
                    item={asItem(g)}
                    onSaved={saved}
                    onCancel={() => setEditing(undefined)}
                    onError={onError}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={`Logins in ${name}`} className="space-y-1.5">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void browse();
          }}
        >
          <Input
            title={`Find a login in ${name}`}
            container="min-w-0 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="github, bank..."
            autoComplete="off"
          />
          <Button type="submit" size="sm" variant="outline" loading={busy}>
            <MagnifyingGlassIcon aria-hidden className="size-3.5" />
            {items ? "Search" : "Browse vault"}
          </Button>
        </form>
        {items &&
          (items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No logins match, or this connection cannot read any.
            </p>
          ) : (
            <ul className="max-h-72 divide-y overflow-auto rounded-lg border bg-card">
              {items.map((i) => (
                <li key={i.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.urls[0] ?? "No website saved"}
                      </span>
                    </span>
                    {i.grant ? (
                      <Badge tone="success">Shared</Badge>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setEditing(editing === i.id ? undefined : i.id)}
                      >
                        Share
                      </Button>
                    )}
                  </div>
                  {editing === i.id && !i.grant && (
                    <GrantForm
                      pluginId={pluginId}
                      item={i}
                      onSaved={saved}
                      onCancel={() => setEditing(undefined)}
                      onError={onError}
                    />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
