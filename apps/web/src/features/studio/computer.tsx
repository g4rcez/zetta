import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VmPanel } from "./desktop";
import { MachinesPanel } from "./machines";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";
import { computerQueries, useLoadError, type ComputerSession as Session } from "./studio-queries";

/** Friendly wording for the computer errors (409 HUMAN_IN_CONTROL / STALE_CONTROL, 410 REVOKED). */
export function computerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "HUMAN_IN_CONTROL")
      return "A person is in control of this browser right now. Hand it back to the bots before they can use it.";
    if (e.code === "REVOKED" || e.status === 410)
      return "This browser profile was revoked, so it cannot be used. Reset it in the profile list to start fresh.";
    if (e.code === "STALE_CONTROL")
      return "Control changed while you were clicking, so nothing happened. The view was refreshed; try again.";
  }
  return errorMessage(e);
}

const ownBrowserUrl = (name: string) =>
  `/api/computer/profiles/${encodeURIComponent(name)}/own-browser`;

/**
 * Points a profile at the person's own browser (Chrome, Brave, Helium or another Chromium browser started with remote debugging).
 * The bot then works in a tab of its own there, signed in as the person is.
 */
function OwnBrowserForm({ onSave }: { onSave: (name: string, port: number) => Promise<void> }) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await onSave(String(f.get("name") || "default"), Number(f.get("port") || 9222));
  }
  return (
    <form
      aria-label="Use your own browser"
      onSubmit={(e) => void submit(e)}
      className="mt-3 space-y-2 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">Use your own browser</p>
      <p className="text-xs text-muted-foreground">
        Start your browser with remote debugging on a port (for example{" "}
        <code>--remote-debugging-port=9222</code>, or turn it on at{" "}
        <code>chrome://inspect/#remote-debugging</code>). Bots then work in a tab of their own,
        signed in as you are, and never touch your other tabs.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Input name="name" title="Profile" defaultValue="default" required={false} />
        <Input
          name="port"
          title="Port"
          type="number"
          min={1024}
          max={65535}
          defaultValue="9222"
          required={false}
        />
        <Button type="submit" size="sm">
          Use my browser
        </Button>
      </div>
    </form>
  );
}

export function Profiles({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: profiles, error } = useQuery(computerQueries.profiles());
  const { data: caps } = useQuery(computerQueries.capabilities());
  useLoadError(error, onError, computerError);
  const [status, setStatus] = useState<string>();
  const load = () => qc.invalidateQueries({ queryKey: computerQueries.profiles().queryKey });
  const run = async (work: () => Promise<unknown>, done: string) => {
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      onError(computerError(e));
    }
    await load();
  };
  return (
    <Panel
      title="Browser profiles"
      label="Browser profiles"
      description="Each profile keeps its own sign-ins and cookies. Reset clears them; revoke stops all use of the profile."
    >
      {profiles?.length === 0 && (
        <Empty>No profiles yet. One is created when you start a browser.</Empty>
      )}
      <ul className={list}>
        {profiles?.map((p) => (
          <li
            key={p.name}
            className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2 break-words">
              <strong>{p.name}</strong>
              <span className="text-muted-foreground">
                {p.mode === "shared" ? "Shared by your bots" : "For one bot"}
              </span>
              {p.revoked && <Badge tone="danger">Revoked</Badge>}
              {p.kind === "own" && <Badge>Your browser, port {p.cdpPort}</Badge>}
            </span>
            <span className="flex flex-wrap gap-1">
              {p.kind === "own" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(
                      () => call(ownBrowserUrl(p.name), "PUT", { port: null }),
                      `${p.name} uses an isolated browser again.`,
                    )
                  }
                >
                  Use an isolated browser
                </Button>
              )}
              <ConfirmButton
                size="xs"
                label="Reset"
                question="Clear sign-ins and cookies for this profile?"
                confirmLabel="Reset"
                onConfirm={() =>
                  run(
                    () =>
                      call(`/api/computer/profiles/${encodeURIComponent(p.name)}/reset`, "POST"),
                    `Reset ${p.name}.`,
                  )
                }
              />
              {!p.revoked && (
                <ConfirmButton
                  size="xs"
                  label="Revoke"
                  question="Revoke this profile? Bots will lose access."
                  confirmLabel="Revoke"
                  onConfirm={() =>
                    run(
                      () => call(`/api/computer/profiles/${encodeURIComponent(p.name)}`, "DELETE"),
                      `Revoked ${p.name}.`,
                    )
                  }
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      {caps?.ownBrowser && (
        <OwnBrowserForm
          onSave={(name, port) =>
            run(
              () => call(ownBrowserUrl(name), "PUT", { port }),
              `${name} now uses your browser on port ${port}.`,
            )
          }
        />
      )}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
    </Panel>
  );
}

export function Computer({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const sessionsKey = computerQueries.sessions().queryKey;
  const [profile, setProfile] = useState("default");
  const [session, setSession] = useState<Session>();
  const [png, setPng] = useState<string>();
  const { data: caps } = useQuery(computerQueries.capabilities());
  const { data: sessions } = useQuery({
    ...computerQueries.sessions(),
    // The session shown here is a draft that actions update; a focus refetch must not replace it.
    refetchOnWindowFocus: false,
  });
  const base = `/api/computer/sessions/${profile}`;
  // The screenshot is a live capture taken on demand, not a cached read.
  const refresh = useCallback(
    (p?: string) =>
      call<{ png: string }>(`/api/computer/sessions/${p ?? profile}/screenshot`)
        .then((r) => setPng(r.png))
        .catch((e) => onError(computerError(e))),
    [profile, onError],
  );
  // Keeps the cached list and the session on screen equal.
  const putSession = (next: Session | undefined, gone = profile) => {
    setSession(next);
    qc.setQueryData(sessionsKey, (list = []) => {
      if (!next) return list.filter((x) => x.profile !== gone);
      return list.some((x) => x.profile === next.profile)
        ? list.map((x) => (x.profile === next.profile ? next : x))
        : [...list, next];
    });
  };
  const reloadSession = () => qc.invalidateQueries({ queryKey: sessionsKey });
  useEffect(() => {
    if (!sessions) return;
    /* a bot's own session (b-<botId>) is listed too, so a handoff from chat can be taken over here */
    const s =
      sessions.find((x) => x.profile === profile) ??
      sessions.find((x) => x.profile === "default") ??
      sessions[0];
    // A change made here already updated both: only a difference from the server needs a new look.
    const same = s && session && s.profile === session.profile && s.control === session.control;
    if (same && s.url === session.url) return;
    setSession(s);
    if (s) {
      setProfile(s.profile);
      void refresh(s.profile);
    }
    // Runs when the list changes; `profile` and `refresh` are the values of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);
  const act = (body: object) =>
    call<{ session: Session }>(`${base}/action`, "POST", body).then(
      (r) => {
        putSession(r.session);
        return refresh();
      },
      (e) => {
        onError(computerError(e));
        void reloadSession();
      },
    );
  async function start() {
    try {
      putSession(
        (await call<{ session: Session }>("/api/computer/sessions", "POST", { profile })).session,
      );
      void qc.invalidateQueries({ queryKey: computerQueries.profiles().queryKey });
    } catch (e) {
      onError(computerError(e));
    }
  }
  async function takeover() {
    if (!session) return;
    try {
      putSession(
        (
          await call<{ session: Session }>(`${base}/takeover`, "POST", {
            human: session.control !== "human",
            expected: session.control,
          })
        ).session,
      );
    } catch (e) {
      onError(computerError(e));
      await reloadSession();
    } // STALE_CONTROL: show what the control really is now
  }
  return (
    <section aria-label="Computer" className="space-y-6">
      <Panel
        title="Remote browser"
        description={
          <>
            An isolated browser with its own profile, only for you. Bots with Computer use turned on
            (in their settings) open pages here, one browser per bot; here you can look, take over,
            and hand it back. /browse in chat and workflow browse steps use it too. Only public web
            addresses are allowed.
          </>
        }
      >
        {caps && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Badge tone={caps.browser ? "success" : "danger"}>
              {caps.browser ? "Browser available" : "Browser unavailable"}
            </Badge>{" "}
            {caps.desktop
              ? "Desktop control: available (private Linux desktop)."
              : (caps.note ??
                "Controlling the whole desktop is not available; only isolated browser sessions are.")}
          </p>
        )}
        {caps?.desktop && <VmPanel onError={onError} />}
        <MachinesPanel onError={onError} />
        {!session ? (
          <Button size="sm" onClick={() => void start()}>
            Start browser
          </Button>
        ) : (
          <div className="space-y-2">
            <form
              className="flex items-end gap-2 [&>div:first-child]:flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const url = String(new FormData(e.currentTarget).get("url"));
                void act({ type: "open", url });
              }}
            >
              <Input
                title="Address"
                hiddenLabel
                name="url"
                defaultValue={session.url === "about:blank" ? "" : session.url}
                placeholder="https://example.com"
              />
              <Button size="sm" type="submit">
                Go
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span role="status" className="mr-auto">
                <Badge tone={session.control === "human" ? "warning" : "success"}>
                  {session.control === "human"
                    ? "You are in control (bots paused)"
                    : "Bots may use this browser"}
                </Badge>
              </span>
              <Button size="sm" variant="outline" onClick={() => void takeover()}>
                {session.control === "human" ? "Hand back to bots" : "Take over"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act({ type: "scroll", dy: 400 })}
              >
                Scroll down
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void call(base, "DELETE").then(
                    () => {
                      putSession(undefined);
                      setPng(undefined);
                    },
                    (e) => onError(computerError(e)),
                  )
                }
              >
                Close browser
              </Button>
            </div>
            {/* No zoom: a click on the picture is sent to the remote browser. */}
            {png && (
              <img
                alt="Remote browser screen"
                src={`data:image/png;base64,${png}`}
                className="h-auto w-full max-w-[1024px] cursor-crosshair rounded-lg border shadow-xs"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  void act({
                    type: "click",
                    x: Math.round(((e.clientX - r.left) / r.width) * 1024),
                    y: Math.round(((e.clientY - r.top) / r.height) * 640),
                  });
                }}
              />
            )}
            <form
              className="flex items-end gap-2 [&>div:first-child]:flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const text = String(new FormData(e.currentTarget).get("text"));
                e.currentTarget.reset();
                void act({ type: "type", text });
              }}
            >
              <Input
                title="Type into the page"
                hiddenLabel
                name="text"
                placeholder="Type into the focused field"
              />
              <Button size="sm" type="submit">
                Type
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void act({ type: "key", key: "Enter" })}
              >
                Enter
              </Button>
            </form>
          </div>
        )}
      </Panel>
      <Profiles onError={onError} />
    </section>
  );
}
