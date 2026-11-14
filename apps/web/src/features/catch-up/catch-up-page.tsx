import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { toast } from "@/lib/notify";
import {
  enableNativeNotifications,
  nativeNotificationState,
  refreshAttention,
} from "../attention/summary";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { ProposalCard, useProposalDecision } from "../chat/proposals-panel";
import { useApprovalMode } from "../preferences/preferences";
import { Loading } from "../shared/ui";
import { CATCH_UP_KEY, catchUpApi, catchUpQueries, type CatchUpEntry } from "./catch-up-api";
import { DecisionCard, SkipButton, SwipeShell } from "./catch-up-card";
import type { CatchUpSearch } from "./catch-up-search";
import { focusKey, mergeOrder, progressOf, skipKey } from "./queue-order";

/** A deny sent with a key or a swipe waits this long, so a slip can be undone. A click on the button sends at once. */
const UNDO_MS = 5000;
const NO_BOTS: Bot[] = [];
const FORM_KINDS = ["install_skills", "tool_resume"];

/** An approval that asks for a press-and-hold, or that needs the person to fill something in, is never approved by one key press. */
const needsCare = (entry: CatchUpEntry, mode: string) =>
  entry.source === "proposal" &&
  ((entry.proposal.confirm === "hold" && mode === "hold") ||
    FORM_KINDS.includes(entry.proposal.kind ?? ""));

/** A swipe right acts only when one tap is enough: no message to write, no hold, no form, no sign-in in another page. */
const canSwipeAct = (entry: CatchUpEntry, careful: boolean) =>
  !careful &&
  (entry.source === "proposal" ||
    (entry.actions.input === "none" && entry.actions.act !== "reconnect"));

/** Typing in a text box must never trigger a shortcut. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  t.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], .cm-editor') !==
    null;

/** Presses the card's main button. When it needs a message first, or care (a hold, a form), it moves focus there instead. */
function pressAct(root: HTMLElement | null, careful: boolean) {
  if (!root) return;
  const button = root.querySelector<HTMLButtonElement>('[data-catch-up="act"]');
  const field = root.querySelector<HTMLElement>('[data-catch-up-input] [contenteditable="true"]');
  if (button && !button.disabled && !careful) return button.click();
  if (button?.disabled && field) return field.focus();
  const first =
    button ?? root.querySelector<HTMLElement>("button, [contenteditable='true'], input");
  first?.focus();
}

function Progress({ position, total }: { position: number; total: number }) {
  return (
    <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
      {total > 0 ? `${position} of ${total}` : ""}
    </p>
  );
}

function NothingWaiting({ handled }: { handled: number }) {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">Nothing is waiting on you</h2>
      <p className="text-sm text-pretty text-muted-foreground">
        {handled > 0
          ? `You cleared ${handled} from your inbox. New ones show up here when a bot needs an answer or an approval.`
          : "No bot is waiting on you. When one needs an answer or an approval, it shows up here."}
      </p>
      <Link
        to="/studio/$tab"
        params={{ tab: "activity" }}
        search={{ view: "updates" }}
        className="text-sm underline underline-offset-2"
      >
        See your updates
      </Link>
    </div>
  );
}

function BotFilter({ bot, onClear }: { bot: Bot | undefined; onClear: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      Only what {bot?.name ?? "one bot"} asked.
      <Button size="sm" variant="outline" onClick={onClear}>
        Show everything
      </Button>
    </p>
  );
}

function UndoBar({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-2 text-sm"
    >
      <span>{label}</span>
      <Button size="sm" variant="outline" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

export function CatchUpPage({
  search,
  onSearch,
  isAdmin,
}: {
  search: CatchUpSearch;
  onSearch: (next: CatchUpSearch) => void;
  /** Whether the person can change a plugin set up for the whole team (the setup panel inside a plugin card). */
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const approvalMode = useApprovalMode();
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const list = useQuery(catchUpQueries.list(search.bot));
  const entries = list.data;

  // The order of this visit: new cards go to the end, decided ones drop out, skipped ones go to the back.
  const [order, setOrder] = useState<string[]>([]);
  const [handled, setHandled] = useState(0);
  const keys = useMemo(() => entries?.map((e) => e.key) ?? [], [entries]);
  // Cards decided in this visit leave at once, without waiting for the list to be read again.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const ordered = useMemo(() => {
    const merged = mergeOrder(order, keys).filter((k) => !settled.has(k));
    // A deep link puts its card first until the person moves on.
    return order.length === 0 ? focusKey(merged, search.item) : merged;
  }, [order, keys, settled, search.item]);
  const current = entries?.find((e) => e.key === ordered[0]);
  const currentKey = current?.key;

  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [arming, setArming] = useState<string>();
  const [permission, setPermission] = useState(nativeNotificationState);
  const cardRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(currentKey);
  currentRef.current = currentKey;

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: CATCH_UP_KEY });
    void qc.invalidateQueries({ queryKey: ["proposals"] });
    void refreshAttention(true);
  }, [qc]);
  const finished = useCallback(
    (key: string) => {
      setHandled((n) => n + 1);
      setSettled((all) => new Set(all).add(key));
      setArming(undefined);
      setErrors(({ [key]: _gone, ...rest }) => rest);
      refresh();
    },
    [refresh],
  );

  const decide = useProposalDecision({
    onResolved: (id) => finished(`proposal:${id}`),
    onBotsChanged: () => void qc.invalidateQueries({ queryKey: ["bots"] }),
    notify: (m) => toast(m),
  });

  async function runCard(key: string, id: string, which: "act" | "deny", text = "") {
    setBusy(key);
    setErrors(({ [key]: _gone, ...rest }) => rest);
    try {
      if (which === "act") await catchUpApi.act(id, text || undefined);
      else await catchUpApi.deny(id);
      finished(key);
      const card = entries?.find((e) => e.key === key);
      // "Open chat" cards have nothing to run: acting means going there.
      if (
        which === "act" &&
        card?.source === "card" &&
        card.actions.act === "open_chat" &&
        card.resultLink
      )
        void navigate({ to: card.resultLink as never });
    } catch (e) {
      setErrors((prev) => ({ ...prev, [key]: errorMessage(e, "That did not work. Try again.") }));
    } finally {
      setBusy(undefined);
    }
  }

  /** After the person fixed something: read the queue again. A card still needed goes to the back with a note, and the next shows. */
  const recheck = useCallback(
    async (key: string) => {
      await qc.invalidateQueries({ queryKey: CATCH_UP_KEY });
      void qc.invalidateQueries({ queryKey: ["proposals"] });
      void refreshAttention(true);
      const fresh = qc.getQueryData<CatchUpEntry[]>(catchUpQueries.list(search.bot).queryKey);
      if (!fresh?.some((e) => e.key === key)) return;
      setErrors((prev) => ({
        ...prev,
        [key]: "Still not fixed. Finish the setup above, then check again.",
      }));
      setOrder((prev) =>
        skipKey(
          mergeOrder(
            prev,
            fresh.map((e) => e.key),
          ),
          key,
        ),
      );
    },
    [qc, search.bot],
  );

  const skip = useCallback(() => {
    if (!currentRef.current) return;
    setArming(undefined);
    setOrder(skipKey(ordered, currentRef.current));
  }, [ordered]);

  // A deny from a key or a swipe is only armed: it is sent when the undo window ends. Leaving the page drops it, which is safe.
  useEffect(() => {
    if (!arming) return;
    const timer = setTimeout(() => {
      setArming(undefined);
      if (currentRef.current === arming)
        cardRef.current?.querySelector<HTMLElement>('[data-catch-up="deny"]')?.click();
    }, UNDO_MS);
    return () => clearTimeout(timer);
  }, [arming]);

  const careful = current ? needsCare(current, approvalMode) : false;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "a") pressAct(cardRef.current, careful);
      else if (key === "d") setArming((k) => k ?? currentRef.current);
      else if (key === "j") skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [careful, skip]);

  const { position, total } = progressOf(handled, ordered.length);
  const swipeAct = current !== undefined && canSwipeAct(current, careful);
  const botOf = (id: string | null) => (id ? bots.find((b) => b.id === id) : undefined);

  return (
    <div className="h-full overflow-y-auto">
      <section aria-label="Inbox" className="mx-auto w-full max-w-7xl min-w-0 space-y-4 p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Inbox</h1>
          <Progress position={position} total={total} />
        </header>
        {search.bot && <BotFilter bot={botOf(search.bot)} onClear={() => onSearch({})} />}
        {permission === "default" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void enableNativeNotifications().then((r) => setPermission(r))}
          >
            Enable desktop notifications
          </Button>
        )}
        {list.isPending && <Loading />}
        {list.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(list.error, "Could not load your inbox. Try again.")}
          </p>
        )}
        {entries && !current && <NothingWaiting handled={handled} />}
        {current && (
          <SwipeShell
            canAct={swipeAct}
            onAct={() => pressAct(cardRef.current, careful)}
            onDeny={() => setArming(current.key)}
          >
            <div ref={cardRef} key={current.key}>
              {current.source === "proposal" ? (
                <ProposalCard
                  proposal={current.proposal}
                  bots={bots}
                  busy={decide.busy === current.id}
                  error={decide.errors[current.id]}
                  decide={decide.decide}
                  leading={ordered.length > 1 ? <SkipButton onSkip={skip} /> : undefined}
                />
              ) : (
                <DecisionCard
                  card={current}
                  bot={botOf(current.botId)}
                  bots={bots}
                  busy={busy === current.key}
                  error={errors[current.key]}
                  onAct={(text) => void runCard(current.key, current.id, "act", text)}
                  onDeny={() => void runCard(current.key, current.id, "deny")}
                  isAdmin={isAdmin}
                  onChanged={refresh}
                  onRecheck={() => void recheck(current.key)}
                  onSkip={ordered.length > 1 ? skip : undefined}
                />
              )}
            </div>
          </SwipeShell>
        )}
        {arming && <UndoBar label="Denying this." onUndo={() => setArming(undefined)} />}
      </section>
    </div>
  );
}
