import {
  ArrowRight,
  ArrowsLeftRight,
  CheckCircle,
  Copy,
  FolderOpen,
  HardDrives,
  Key,
  LockSimple,
  Plus,
  Robot,
  ShieldCheck,
  Terminal,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { EditorField } from "@/components/editor/editor";
import { Button, Input, Select } from "@/components/ui";

import { call, errorMessage, sendSealed, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { ConfirmButton } from "../shared/ui";
import { BotPicker } from "../skills/bot-picker";
import {
  computerQueries,
  useLoadError,
  type HostKeyCandidate,
  type Machine,
  type MachineKind,
} from "./studio-queries";

const KINDS: Record<
  MachineKind,
  { label: string; Icon: Icon; summary: string; detail: string; secret: "key" | "password" }
> = {
  ssh: {
    label: "SSH",
    Icon: Terminal,
    summary: "Run commands and move files",
    detail: "The most flexible. A bot can run commands and copy files in both directions.",
    secret: "key",
  },
  sftp: {
    label: "SFTP",
    Icon: FolderOpen,
    summary: "Browse and copy files",
    detail: "Same private key as SSH, but a bot can only list, download and upload files.",
    secret: "key",
  },
  ftp: {
    label: "FTP",
    Icon: ArrowsLeftRight,
    summary: "Older file servers",
    detail: "Signs in with a password. Prefer SFTP when the server offers it.",
    secret: "password",
  },
};
const KIND_ORDER: MachineKind[] = ["ssh", "sftp", "ftp"];
const usesKey = (kind: MachineKind) => KINDS[kind].secret === "key";

/** The icon of a kind of access, on a quiet tile. */
function KindTile({ kind, size = 40 }: { kind: MachineKind; size?: 32 | 40 }) {
  const { Icon: Glyph } = KINDS[kind];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ${size === 40 ? "size-10" : "size-8"}`}
    >
      <Glyph size={size === 40 ? 24 : 20} weight="duotone" />
    </span>
  );
}

/** Who does what, so nobody has to guess where the key goes. */
function HowItWorks() {
  const steps: { Icon: Icon; title: string; text: string }[] = [
    { Icon: Robot, title: "Your bot", text: "Asks for a machine by name." },
    {
      Icon: ShieldCheck,
      title: "Zetta",
      text: "Keeps the key encrypted and runs the command for it.",
    },
    { Icon: HardDrives, title: "Your server", text: "Does the work and answers." },
  ];
  return (
    <div className="space-y-3">
      <ol className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {steps.flatMap(({ Icon: Glyph, title, text }, i) => [
          <li key={title} className="flex items-start gap-3">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            >
              <Glyph size={20} weight="duotone" />
            </span>
            <span className="text-sm">
              <strong className="block font-medium">{title}</strong>
              <span className="text-muted-foreground">{text}</span>
            </span>
          </li>,
          i < steps.length - 1 ? (
            <li
              key={`${title}-next`}
              aria-hidden
              className="hidden self-center text-muted-foreground sm:block"
            >
              <ArrowRight size={16} />
            </li>
          ) : null,
        ])}
      </ol>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LockSimple size={16} aria-hidden />
        The bot never sees the key or password. It only names the machine.
      </p>
    </div>
  );
}

/** The kind of access, as three cards a person can compare. */
function KindPicker({
  kind,
  onChange,
}: {
  kind: MachineKind;
  onChange: (kind: MachineKind) => void;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3">
      <legend className="sr-only">Kind of access</legend>
      {KIND_ORDER.map((k) => {
        const { label, summary, detail } = KINDS[k];
        const picked = k === kind;
        return (
          <label
            key={k}
            className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${picked ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
          >
            <input
              type="radio"
              name="machine-kind"
              value={k}
              checked={picked}
              onChange={() => onChange(k)}
              className="sr-only"
            />
            <span className="flex items-center gap-3">
              <KindTile kind={k} size={32} />
              <span className="text-sm font-medium">{label}</span>
              {picked && (
                <CheckCircle
                  size={20}
                  weight="fill"
                  aria-label="Selected"
                  className="ml-auto text-primary"
                />
              )}
            </span>
            <span className="text-sm font-medium">{summary}</span>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** A numbered part of the form: what to do, and why, before the fields. */
function Part({
  n,
  Glyph,
  title,
  hint,
  children,
}: {
  n: number;
  Glyph: Icon;
  title: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
        >
          {n}
        </span>
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Glyph size={16} aria-hidden className="text-muted-foreground" />
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </header>
      <div className="space-y-3 pl-9">{children}</div>
    </section>
  );
}

/** The secret box: a private key is pasted text, a password is a password field. Both are sealed before they leave the page. */
function SecretField({ kind, name, title }: { kind: MachineKind; name: string; title: string }) {
  return usesKey(kind) ? (
    // Plain on purpose: a pasted private key. It is not natural-language text and must never be sent to the chat.
    <EditorField
      title={title}
      name={name}
      required
      rows={6}
      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
      info="Use a key without a passphrase. It is stored encrypted and never shown again."
    />
  ) : (
    <Input
      title={title}
      name={name}
      type="password"
      required
      maxLength={512}
      autoComplete="new-password"
      spellCheck={false}
      info="It is stored encrypted and never shown again."
    />
  );
}

/** The bots a machine is shared with, drawn as bots (avatar and name), or a plain sentence when there are none. */
function SharedWith({ ids, bots }: { ids: string[]; bots: Bot[] }) {
  const shared = bots.filter((b) => ids.includes(b.id));
  if (!shared.length)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LockSimple size={16} aria-hidden />
        Not shared with any bot yet, so no bot can use it.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <UsersThree size={16} aria-hidden />
        Shared with
      </span>
      {shared.map((b) => (
        <BotIdentity key={b.id} bot={b} size={20} />
      ))}
    </div>
  );
}

/** Machines your bots can reach through Zetta: the server holds the key or password, the bot only names the machine. */
export function MachinesPanel({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: machines, error } = useQuery(computerQueries.machines());
  const { data: bots = [] } = useQuery(chatQueries.bots());
  useLoadError(error, onError);
  const reload = () => qc.invalidateQueries({ queryKey: computerQueries.machines().queryKey });
  const form = useRef<HTMLFormElement>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<MachineKind>("ssh");
  const [keys, setKeys] = useState<HostKeyCandidate[]>();
  const [hostKey, setHostKey] = useState("");
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; publicKey?: string }>();
  const [publicKeys, setPublicKeys] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; what: "secret" | "share" }>();
  const [draftBots, setDraftBots] = useState<string[]>([]);

  const formOpen = adding || machines?.length === 0;
  const values = () => {
    const f = new FormData(form.current!);
    return {
      host: String(f.get("host") ?? "").trim(),
      port: String(f.get("port") ?? "").trim(),
    };
  };
  async function scan() {
    const { host, port } = values();
    if (!host) return;
    setBusy("scan");
    setKeys(undefined);
    try {
      const r = await call<{ keys: HostKeyCandidate[] }>("/api/computer/machines/scan", "POST", {
        host,
        port: Number(port) || 22,
      });
      setKeys(r.keys);
      setHostKey(r.keys[0]?.key ?? "");
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // React clears `currentTarget` after the first await, so the form is kept here.
    const element = e.currentTarget;
    const f = new FormData(element);
    setBusy("create");
    setNotice(undefined);
    try {
      const secret = String(f.get("secret"));
      const port = String(f.get("port") ?? "").trim();
      const r = await sendSealed(`machine.create:${kind}`, { secret }, (sealed) =>
        call<{ machine: Machine & { publicKey: string | null } }>(
          "/api/computer/machines",
          "POST",
          {
            name: String(f.get("name")).trim(),
            kind,
            host: String(f.get("host")).trim(),
            ...(port ? { port: Number(port) } : {}),
            username: String(f.get("username")).trim(),
            ...(usesKey(kind) ? { hostKey } : {}),
            botIds: shareWith,
            sealed,
          },
        ),
      );
      setNotice({
        text: `Added ${r.machine.name}.`,
        ...(r.machine.publicKey ? { publicKey: r.machine.publicKey } : {}),
      });
      setKeys(undefined);
      setShareWith([]);
      setAdding(false);
      await reload();
    } catch (x) {
      onError(errorMessage(x));
    } finally {
      // The secret field is always cleared, success or not.
      element.reset();
      setBusy(undefined);
    }
  }
  async function replace(m: Machine, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const secret = String(new FormData(e.currentTarget).get("secret"));
    setBusy(m.id);
    try {
      const r = await sendSealed(`machine.secret:${m.id}`, { secret }, (sealed) =>
        call<{ machine: { publicKey: string | null } }>(
          `/api/computer/machines/${m.id}/secret`,
          "PUT",
          { sealed },
        ),
      );
      if (r.machine.publicKey) setPublicKeys((p) => ({ ...p, [m.id]: r.machine.publicKey! }));
      setEditing(undefined);
      setNotice({ text: `Replaced the ${usesKey(m.kind) ? "key" : "password"} of ${m.name}.` });
    } catch (x) {
      onError(errorMessage(x));
    } finally {
      setBusy(undefined);
    }
  }
  async function saveShare(m: Machine) {
    setBusy(m.id);
    try {
      await call(`/api/computer/machines/${m.id}/bots`, "PUT", { botIds: draftBots });
      setEditing(undefined);
      setNotice({
        text: draftBots.length
          ? `${m.name} is shared with ${draftBots.length} ${draftBots.length === 1 ? "bot" : "bots"}.`
          : `${m.name} is not shared with any bot now.`,
      });
      await reload();
    } catch (x) {
      onError(errorMessage(x));
    } finally {
      setBusy(undefined);
    }
  }
  async function showPublicKey(m: Machine) {
    try {
      const r = await call<{ publicKey: string }>(`/api/computer/machines/${m.id}/public-key`);
      setPublicKeys((p) => ({ ...p, [m.id]: r.publicKey }));
    } catch (x) {
      onError(errorMessage(x));
    }
  }
  async function remove(m: Machine) {
    try {
      await call(`/api/computer/machines/${m.id}`, "DELETE");
      setNotice({ text: `Deleted ${m.name}. Its saved secret was revoked.` });
    } catch (x) {
      onError(errorMessage(x));
    }
    await reload();
  }
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  return (
    <section aria-label="Machines" className="space-y-4 rounded-lg border bg-card p-4">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <HardDrives size={24} weight="duotone" />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-medium">Machines</h2>
          <p className="text-sm text-muted-foreground">
            Servers your bots can work on over SSH, SFTP or FTP. You choose which bots may use each
            one.
          </p>
        </div>
        {!formOpen && (
          <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add a machine
          </Button>
        )}
      </header>

      <HowItWorks />

      {notice && (
        <div role="status" className="space-y-2 border-l-2 border-primary pl-4 text-sm">
          <p className="flex items-center gap-2">
            <CheckCircle size={20} weight="fill" aria-hidden className="text-primary" />
            {notice.text}
          </p>
          {notice.publicKey && (
            <div className="space-y-1 pl-7">
              <p className="text-xs text-muted-foreground">
                Last step: add this public key to the machine, in the file{" "}
                <code>~/.ssh/authorized_keys</code> of the user you chose.
              </p>
              <div className="flex items-start gap-2">
                <code className="block min-w-0 flex-1 select-all break-all rounded bg-muted/50 px-2 py-1 text-xs">
                  {notice.publicKey}
                </code>
                {/* No hint: it shows the text Copy. */}
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy the public key"
                  onClick={() => copy(notice.publicKey!)}
                >
                  <Copy size={16} aria-hidden /> Copy
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {machines && machines.length > 0 && (
        <ul aria-label="Your machines" className="divide-y border-y">
          {machines.map((m) => (
            <li key={m.id} className="space-y-3 py-4 text-sm">
              <div className="flex flex-wrap items-start gap-3">
                <KindTile kind={m.kind} />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-medium">{m.name}</strong>
                    <span className="rounded-sm bg-muted px-2 text-xs font-medium">
                      {KINDS[m.kind].label}
                    </span>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    {m.username}@{m.host}:{m.port}
                  </p>
                  {m.fingerprint && (
                    <p className="flex items-center gap-1 break-all text-xs text-muted-foreground">
                      <ShieldCheck size={16} aria-hidden className="shrink-0" />
                      Host key {m.fingerprint}
                    </p>
                  )}
                </div>
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraftBots(m.botIds);
                      setEditing(
                        editing?.id === m.id && editing.what === "share"
                          ? undefined
                          : { id: m.id, what: "share" },
                      );
                    }}
                  >
                    <UsersThree size={16} aria-hidden /> Share
                  </Button>
                  {usesKey(m.kind) && (
                    <Button size="sm" variant="outline" onClick={() => void showPublicKey(m)}>
                      <Key size={16} aria-hidden /> Public key
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing(
                        editing?.id === m.id && editing.what === "secret"
                          ? undefined
                          : { id: m.id, what: "secret" },
                      )
                    }
                  >
                    {usesKey(m.kind) ? "Replace key" : "Replace password"}
                  </Button>
                  <ConfirmButton
                    label="Delete"
                    question={`Delete ${m.name}? Its saved secret is revoked.`}
                    confirmLabel="Delete"
                    onConfirm={() => remove(m)}
                  />
                </span>
              </div>
              <SharedWith ids={m.botIds} bots={bots} />
              {publicKeys[m.id] && (
                <code className="block select-all break-all rounded bg-muted/50 px-2 py-1 text-xs">
                  {publicKeys[m.id]}
                </code>
              )}
              {editing?.id === m.id && editing.what === "share" && (
                <div className="space-y-3 border-l-2 pl-4">
                  <p className="text-xs text-muted-foreground">
                    Only the bots you pick can see or use {m.name}. Everyone else is told it does
                    not exist.
                  </p>
                  <BotPicker bots={bots} selected={draftBots} onChange={setDraftBots} />
                  <Button size="sm" disabled={busy === m.id} onClick={() => void saveShare(m)}>
                    {busy === m.id ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
              {editing?.id === m.id && editing.what === "secret" && (
                <form
                  autoComplete="off"
                  className="space-y-3 border-l-2 pl-4"
                  onSubmit={(e) => void replace(m, e)}
                >
                  <SecretField
                    kind={m.kind}
                    name="secret"
                    title={usesKey(m.kind) ? "New private key" : "New password"}
                  />
                  <Button type="submit" size="sm" disabled={busy === m.id}>
                    {busy === m.id ? "Saving…" : "Save"}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <form
          ref={form}
          autoComplete="off"
          aria-label="Add a machine"
          className="space-y-6 border-t pt-6"
          onSubmit={(e) => void create(e)}
        >
          <Part
            n={1}
            Glyph={Terminal}
            title="What should bots be able to do?"
            hint="Pick the way Zetta will reach the machine."
          >
            <KindPicker
              kind={kind}
              onChange={(k) => {
                setKind(k);
                setKeys(undefined);
              }}
            />
          </Part>

          <Part
            n={2}
            Glyph={HardDrives}
            title="Where is it?"
            hint="The name is what a bot writes to pick this machine, so keep it short."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                title="Name"
                name="name"
                required
                maxLength={60}
                placeholder="e.g. Web server"
              />
              <Input title="User" name="username" required maxLength={64} autoComplete="off" />
              <Input
                title="Host"
                name="host"
                required
                maxLength={253}
                placeholder="server.example.com"
                onChange={() => setKeys(undefined)}
              />
              <Input
                title="Port"
                name="port"
                required={false}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={kind === "ftp" ? "21" : "22"}
                onChange={() => setKeys(undefined)}
              />
            </div>
          </Part>

          <Part
            n={3}
            Glyph={Key}
            title={usesKey(kind) ? "How does Zetta sign in?" : "What is the password?"}
            hint={
              usesKey(kind) ? (
                <>
                  Make a key just for Zetta, for example{" "}
                  <code>ssh-keygen -t ed25519 -N "" -f zetta_key</code>, and paste the private part
                  here. After saving, Zetta shows the public part to add to the machine.
                </>
              ) : (
                "Zetta uses TLS when the server offers it. Without TLS the password crosses the network as clear text."
              )
            }
          >
            <SecretField
              kind={kind}
              name="secret"
              title={usesKey(kind) ? "Private key" : "Password"}
            />
          </Part>

          {usesKey(kind) && (
            <Part
              n={4}
              Glyph={ShieldCheck}
              title="Is this the right machine?"
              hint="Zetta remembers the machine's host key and refuses to connect if it ever changes."
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === "scan"}
                onClick={() => void scan()}
              >
                {busy === "scan" ? "Checking…" : "Check host key"}
              </Button>
              {keys && (
                <div className="space-y-2 border-l-2 pl-4">
                  <p className="flex items-center gap-2 text-sm">
                    <CheckCircle size={20} weight="fill" aria-hidden className="text-primary" />
                    The machine answered. Compare its fingerprint with the one your administrator
                    knows.
                  </p>
                  {keys.length > 1 ? (
                    <Select
                      title="Host key to trust"
                      required={false}
                      value={hostKey}
                      onChange={(e) => setHostKey(e.target.value)}
                      options={keys.map((k) => ({
                        value: k.key,
                        label: `${k.type} ${k.fingerprint}`,
                      }))}
                    />
                  ) : (
                    <code className="block break-all text-xs">
                      {keys[0]!.type} {keys[0]!.fingerprint}
                    </code>
                  )}
                </div>
              )}
            </Part>
          )}

          <Part
            n={usesKey(kind) ? 5 : 4}
            Glyph={UsersThree}
            title="Which bots can use it?"
            hint="Only the bots you pick can see or use this machine. You can change this later."
          >
            <BotPicker bots={bots} selected={shareWith} onChange={setShareWith} />
          </Part>

          <div className="flex items-center gap-2 pl-9">
            <Button type="submit" disabled={busy === "create" || (usesKey(kind) && !keys)}>
              {busy === "create" ? "Adding…" : "Add machine"}
            </Button>
            {machines && machines.length > 0 && (
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            )}
            {usesKey(kind) && !keys && (
              <span className="text-xs text-muted-foreground">Check the host key first.</span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
