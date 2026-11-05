import {
  CheckCircleIcon,
  ArrowSquareOutIcon,
  MegaphoneIcon,
  ArrowsClockwiseIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { Button, Input } from "@/components/ui";
import { errorCode, errorMessage, type Bot } from "../chat/chat-client";
import { Panel } from "../shared/ui";
import { Check } from "./google-connect";
import { usePluginApi, type PluginMeta, type PluginTest } from "./plugins-api";
import { TELEGRAM, TelegramLogo } from "./telegram-logo";
import { ToggleCard } from "./toggle-card";
import { Alert } from "@g4rcez/components/alert";

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
  >
    {children}
    <ArrowSquareOutIcon aria-hidden className="size-3" />
  </a>
);
const FOOTNOTE =
  "Telegram is a trademark of Telegram FZ-LLC. Zetta is not affiliated with or endorsed by Telegram.";

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="-mx-1 flex items-center gap-3 rounded-lg px-3 py-3"
      style={{
        backgroundImage: `linear-gradient(135deg, ${TELEGRAM.light}26, ${TELEGRAM.base}0d)`,
      }}
    >
      <TelegramLogo className="size-10 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

/** Studio > Plugins > Telegram install: BotFather steps, the token, what bots may do, and which bots get it. */
export function TelegramInstall({
  meta,
  bots,
  onClose,
  onDone,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onClose: () => void;
  onDone: () => void;
}) {
  const pluginsApi = usePluginApi();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [allowSend, setAllowSend] = useState(false);
  const [allowManage, setAllowManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config = {
      token: String(f.get("token") ?? "").trim(),
      allowSend: allowSend ? "yes" : "",
      allowManage: allowManage ? "yes" : "",
      chatAllowlist: String(f.get("chatAllowlist") ?? "").trim(),
    };
    setBusy(true);
    setLocal(undefined);
    try {
      await pluginsApi.install(meta.id, config, [...chosen]);
      await pluginsApi.connect(meta.id).catch(() => undefined); // first sync; a webhook is reported (and can be removed) from the installed card
      onDone();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Connect Telegram">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Connect Telegram">
        <Header
          title="Telegram"
          subtitle="Control and read your chats and groups with your own bot"
        />
        <ol className="space-y-1.5 text-sm">
          {[
            <>
              Open <Link href="https://t.me/BotFather">@BotFather</Link> in Telegram.
            </>,
            <>
              Send <code>/newbot</code> and choose a name and a username.
            </>,
            <>Copy the bot token it gives you and paste it below.</>,
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
              >
                {i + 1}
              </span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
        <Input
          title="Bot token"
          name="token"
          type="password"
          required
          placeholder="123456789:AAH..."
          info="Stored encrypted for your account only. It is never shown again."
          autoComplete="off"
        />
        <fieldset className="space-y-2 rounded-lg border p-3 accent-primary">
          <legend className="px-1 text-xs font-medium">
            What bots may do (you can change this later)
          </legend>
          <p className="text-xs text-muted-foreground">
            Reading chats and groups is always on. Everything that changes something in Telegram is
            off until you allow it.
          </p>
          <Check checked={allowSend} onChange={setAllowSend}>
            Send, edit and forward messages and send files
          </Check>
          <Check checked={allowManage} onChange={setAllowManage}>
            Delete and pin messages (the bot also needs those rights in the chat)
          </Check>
          <Input
            title="Only act in these chats (optional)"
            name="chatAllowlist"
            placeholder="-1001234567890, @mychannel"
            info="Comma separated chat ids or @usernames. Empty means any chat the bot is in."
            autoComplete="off"
          />
        </fieldset>
        {meta.notes && <p className="text-xs text-muted-foreground">{meta.notes}</p>}
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
        {local && <Alert theme="danger">{local}</Alert>}
        <div className="flex items-center justify-between gap-2">
          <Link href="https://core.telegram.org/bots/tutorial">Bot API docs</Link>
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Connect Telegram
            </Button>
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{FOOTNOTE}</p>
      </form>
    </Panel>
  );
}

type Info = {
  username: string | null;
  name: string;
  readsAllGroupMessages: boolean;
  allowSend: boolean;
  allowManage: boolean;
  chatAllowlist: string;
  webhook: boolean;
  chats: { id: string; type: string; title: string; username?: string }[];
};
const TYPE: Record<string, { icon: typeof UsersIcon; label: string }> = {
  private: { icon: UserIcon, label: "Private" },
  group: { icon: UsersIcon, label: "Group" },
  supergroup: { icon: UsersIcon, label: "Group" },
  channel: { icon: MegaphoneIcon, label: "Channel" },
};

/** Installed-card panel: the bot, the chats and groups it can see, a sync button, and the permissions bots have. */
export function TelegramConnect({
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
  const [busy, setBusy] = useState<"sync" | "save">();
  const [notice, setNotice] = useState<string>();
  const [confirmHook, setConfirmHook] = useState(false);
  const [allowSend, setAllowSend] = useState(false);
  const [allowManage, setAllowManage] = useState(false);
  const [allowlist, setAllowlist] = useState("");
  useEffect(() => {
    if (info) {
      setAllowSend(info.allowSend);
      setAllowManage(info.allowManage);
      setAllowlist(info.chatAllowlist);
    }
  }, [info?.allowSend, info?.allowManage, info?.chatAllowlist]);
  const dirty = info
    ? allowSend !== info.allowSend ||
      allowManage !== info.allowManage ||
      allowlist.trim() !== info.chatAllowlist
    : false;
  const groups = (info?.chats ?? []).filter((c) => c.type !== "private" && c.type !== "channel");

  async function sync(removeWebhook = false) {
    setBusy("sync");
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect(
        "telegram",
        removeWebhook ? { removeWebhook: true } : undefined,
      );
      setConfirmHook(false);
      setNotice(r.message);
      onChanged();
    } catch (e) {
      if (errorCode(e) === "WEBHOOK_ACTIVE") setConfirmHook(true);
      else onError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function save() {
    setBusy("save");
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect("telegram", {
        settings: { allowSend, allowManage, chatAllowlist: allowlist.trim() },
      });
      setNotice(r.message);
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Telegram connection">
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
        style={{
          backgroundImage: `linear-gradient(135deg, ${TELEGRAM.light}1f, ${TELEGRAM.base}0a)`,
        }}
      >
        <TelegramLogo className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          {info ? (
            <p className="truncate font-medium">
              {info.name}
              {info.username && (
                <>
                  {" "}
                  <Link href={`https://t.me/${info.username}`}>@{info.username}</Link>
                </>
              )}
            </p>
          ) : (
            <p className="font-medium">Telegram bot</p>
          )}
          <p className="text-xs text-muted-foreground">
            {probe?.status.state === "connected" ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircleIcon aria-hidden className="size-3.5 text-primary" />
                Connected. Bots can read your chats{info?.allowSend ? " and send messages" : ""}.
              </span>
            ) : (
              (probe?.status.detail ?? "Checking...")
            )}
          </p>
        </div>
        <Button loading={busy === "sync"} onClick={() => void sync()}>
          <ArrowsClockwiseIcon aria-hidden className="size-3.5" />
          Sync chats
        </Button>
      </div>

      {confirmHook && (
        <div
          role="alertdialog"
          aria-label="Remove webhook"
          className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs"
        >
          <p>
            This bot has a webhook set, so Telegram delivers its messages there instead of to Zetta.
            Reading needs polling, which means removing the webhook. Anything else using this bot's
            webhook will stop receiving messages.
          </p>
          <div className="flex gap-2">
            <Button loading={busy === "sync"} onClick={() => void sync(true)}>
              Remove webhook and sync
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmHook(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
      {notice && <Alert theme="info">{notice}</Alert>}

      <section aria-label="Chats and groups" className="space-y-1.5">
        <h4 className="text-xs font-medium">
          Chats and groups the bot can see{info ? ` (${info.chats.length})` : ""}
        </h4>
        {!info || info.chats.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No chats yet. Add the bot to a group or send it a message in Telegram, then press Sync
            chats.
          </p>
        ) : (
          <ul className="max-h-56 divide-y overflow-auto rounded-lg border bg-card">
            {info.chats.map((c) => {
              const t = TYPE[c.type] ?? TYPE.group!;
              return (
                <li key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                  <t.icon aria-hidden className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    {c.title || c.id}
                    {c.username && <span className="text-muted-foreground"> @{c.username}</span>}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t.label}
                  </span>
                  <code className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {c.id}
                  </code>
                </li>
              );
            })}
          </ul>
        )}
        {info && groups.length > 0 && !info.readsAllGroupMessages && (
          <p role="note" className="text-xs text-muted-foreground">
            Group Privacy is on, so in groups the bot only sees commands and messages that mention
            it. To let it read everything, send <code>/setprivacy</code> to{" "}
            <Link href="https://t.me/BotFather">@BotFather</Link>, choose this bot and Disable, then
            remove and re-add the bot to each group.
          </p>
        )}
      </section>

      <fieldset className="space-y-2 rounded-lg border p-3 accent-primary" disabled={!info}>
        <legend className="px-1 text-xs font-medium">What bots may do</legend>
        <Check checked={allowSend} onChange={setAllowSend}>
          Send, edit and forward messages and send files
        </Check>
        <Check checked={allowManage} onChange={setAllowManage}>
          Delete and pin messages
        </Check>
        <Input
          title="Only act in these chats (optional)"
          value={allowlist}
          onChange={(e) => setAllowlist(e.target.value)}
          placeholder="-1001234567890, @mychannel"
          info="Comma separated chat ids or @usernames. Empty means any chat the bot is in."
          autoComplete="off"
        />
        <div className="flex items-center gap-2">
          <Button loading={busy === "save"} disabled={!dirty} onClick={() => void save()}>
            Save permissions
          </Button>
          {!dirty && info && <span className="text-xs text-muted-foreground">Saved</span>}
        </div>
      </fieldset>
      <p className="text-xs leading-snug text-muted-foreground">{FOOTNOTE}</p>
    </div>
  );
}
