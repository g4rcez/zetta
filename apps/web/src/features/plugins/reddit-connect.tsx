import {
  BookOpenIcon,
  CheckCircleIcon,
  PencilLineIcon,
  ShieldCheckIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Check } from "./google-connect";
import { pluginsApi, type PluginTest } from "./plugins-api";
import { Alert } from "@g4rcez/components/alert";

/** Reddit orange (brand "OrangeRed"). */
const ORANGE = "#FF4500";

/** Reddit mark: the Snoo head on the orange circle. */
export function RedditLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="12" fill={ORANGE} />
      <circle cx="16.6" cy="6.3" r="1.25" fill="#fff" />
      <path
        d="M12.3 8.6 13 5.4l3.1.7"
        fill="none"
        stroke="#fff"
        strokeWidth=".8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.9" cy="11.2" r="1.5" fill="#fff" />
      <circle cx="17.1" cy="11.2" r="1.5" fill="#fff" />
      <ellipse cx="12" cy="13.6" rx="5.8" ry="4.2" fill="#fff" />
      <circle cx="9.7" cy="13" r=".95" fill={ORANGE} />
      <circle cx="14.3" cy="13" r=".95" fill={ORANGE} />
      <path
        d="M9.6 15.4c1.4.9 3.4.9 4.8 0"
        fill="none"
        stroke={ORANGE}
        strokeWidth=".7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mirrors the server's scope ids (plugins/reddit/oauth.ts). Nothing is requested until the user ticks it. */
const SCOPES: { id: string; label: string; group: "Read" | "Act" }[] = [
  { id: "read", group: "Read", label: "Browse, search and read posts and comments" },
  { id: "history", group: "Read", label: "Your saved, upvoted, posts and comments" },
  { id: "mysubreddits", group: "Read", label: "Subreddits you joined" },
  { id: "privatemessages", group: "Read", label: "Your inbox (sending also needs Allow actions)" },
  { id: "submit", group: "Act", label: "Create posts and comments" },
  { id: "vote", group: "Act", label: "Upvote and downvote" },
  { id: "edit", group: "Act", label: "Edit and delete your posts and comments" },
  { id: "save", group: "Act", label: "Save and unsave" },
  { id: "subscribe", group: "Act", label: "Join and leave subreddits" },
];
const GROUPS: Record<"Read" | "Act", { icon: PhosphorIcon; hint: string }> = {
  Read: { icon: BookOpenIcon, hint: "What bots may read" },
  Act: { icon: PencilLineIcon, hint: "What bots may do as you" },
};
const WRITE = new Set(["submit", "vote", "edit", "save", "subscribe", "privatemessages"]);
const REASON: Record<string, string> = {
  ACCESS_DENIED: "Reddit access was declined.",
  INVALID_STATE: "That sign-in link expired. Try again.",
  STATE_EXPIRED: "That sign-in took too long. Try again.",
  EXCHANGE_FAILED:
    "Reddit rejected the sign-in. Check the app's id, secret and redirect uri, then try again.",
  NO_REFRESH_TOKEN:
    "Reddit did not grant permanent access. Remove Zetta from your authorized apps on Reddit and try again.",
  NOT_CONFIGURED: "Add your Reddit app's client id and secret in Settings first.",
  REDDIT_ERROR: "Reddit refused the sign-in. Check the app's redirect uri.",
};

type Info = {
  username?: string | null;
  scopes?: string[];
  allowNsfw?: boolean;
  allowWrite?: boolean;
  subreddits?: string;
  over18?: boolean;
};

/** Studio > Plugins > Reddit: choose permissions and switches, connect through Reddit's consent page, see the account, disconnect. Tokens never reach the browser. */
export function RedditConnect({
  probe,
  onChanged,
  onError,
}: {
  probe?: PluginTest;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const info = probe?.status.info as Info | undefined;
  const connected = probe?.status.state === "connected";
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [allowNsfw, setAllowNsfw] = useState(false);
  const [allowWrite, setAllowWrite] = useState(false);
  const [subreddits, setSubreddits] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (!info?.scopes) return;
    setScopes(new Set(info.scopes));
    setAllowNsfw(Boolean(info.allowNsfw));
    setAllowWrite(Boolean(info.allowWrite));
    setSubreddits(info.subreddits ?? "");
  }, [info?.scopes?.join(" "), info?.allowNsfw, info?.allowWrite, info?.subreddits]);
  useEffect(() => {
    // result of the redirect from the server callback: only a flag, never a token
    const q = new URLSearchParams(window.location.search);
    if (q.get("plugin") !== "reddit") return;
    const ok = q.get("status") === "ok";
    const reason = q.get("reason");
    setNotice(
      ok ? "Reddit connected." : (REASON[reason ?? ""] ?? "Reddit could not be connected."),
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const canWrite = [...scopes].some((s) => WRITE.has(s));
  const toggle = (id: string, on: boolean) =>
    setScopes((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      if (![...n].some((x) => WRITE.has(x))) setAllowWrite(false);
      return n;
    });
  async function connect() {
    setBusy(true);
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect("reddit", {
        scopes: [...scopes],
        allowNsfw,
        allowWrite,
        subreddits,
      });
      if (r.authorizeUrl) {
        window.location.assign(r.authorizeUrl);
        return;
      }
      setNotice(r.message ?? "Saved.");
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await pluginsApi.disconnect("reddit");
      setScopes(new Set());
      setAllowNsfw(false);
      setAllowWrite(false);
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Reddit connection">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {connected ? (
          <>
            <CheckCircleIcon aria-hidden className="size-4 text-primary" />
            Connected as{" "}
            <strong className="text-foreground">
              {info?.username ? `u/${info.username}` : "your Reddit account"}
            </strong>
          </>
        ) : probe?.status.state === "error" ? (
          probe.status.detail
        ) : (
          "Not connected. Choose what bots may do, then connect."
        )}
      </p>
      {notice && (
        <Alert theme={notice === "Reddit connected." ? "success" : "info"}>{notice}</Alert>
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {(["Read", "Act"] as const).map((g) => {
          const G = GROUPS[g];
          return (
            <fieldset key={g} className="min-w-0 space-y-2.5 rounded-lg border bg-muted/20 p-3">
              <legend className="sr-only">{g}</legend>
              <div className="flex items-center gap-2" aria-hidden>
                <G.icon className="size-4 shrink-0" style={{ color: ORANGE }} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-none">{g}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{G.hint}</p>
                </div>
              </div>
              {SCOPES.filter((s) => s.group === g).map((s) => (
                <Check key={s.id} checked={scopes.has(s.id)} onChange={(on) => toggle(s.id, on)}>
                  {s.label}
                </Check>
              ))}
            </fieldset>
          );
        })}
      </div>
      <div className="space-y-2">
        <Check checked={allowNsfw} onChange={setAllowNsfw}>
          Allow NSFW content (hidden from bots by default)
        </Check>
        {allowNsfw && connected && info?.over18 === false && (
          <Alert theme="warn">
            Reddit still hides NSFW content until you turn on "I'm over eighteen" in your Reddit
            preferences.
          </Alert>
        )}
        <Check checked={allowWrite} disabled={!canWrite} onChange={setAllowWrite}>
          Allow bots to act on my account (post, comment, vote, edit, save, join, message). Off by
          default; actions are rate limited.
        </Check>
        {allowWrite && (
          <Input
            title="Only act in these subreddits (optional)"
            value={subreddits}
            onChange={(e) => setSubreddits(e.target.value)}
            placeholder="test, typescript"
            info="Comma separated. Applies to posts, comments, votes and joins. Empty means any subreddit."
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void connect()}
          loading={busy}
          disabled={busy || (scopes.size === 0 && !connected)}
        >
          {connected ? (
            <>
              <ShieldCheckIcon aria-hidden className="size-4" />
              Update permissions
            </>
          ) : (
            <>
              <RedditLogo className="size-4" />
              Connect with Reddit
            </>
          )}
        </Button>
        {connected && (
          <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
