import { Link } from "@tanstack/react-router";
import { motion, useDragControls, useReducedMotion } from "motion/react";
import { lazy, Suspense, useState, type ReactNode } from "react";

import type { DecisionKind } from "@zetta/core/attention-kinds";
import type { CatchUpContext } from "@zetta/core/catch-up";
import { BotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import type { Bot } from "../chat/chat-client";
import { MentionField } from "../chat/mention";
import { relativeTime } from "../shared/relative-time";
import { Badge, Loading } from "../shared/ui";
import type { CatchUpCard } from "./catch-up-api";

// The plugin's own setup panel is large (Google, Telegram, the install forms): it loads only when a card needs it.
const PluginSetup = lazy(() =>
  import("../plugins/plugin-page").then((m) => ({ default: m.PluginSetup })),
);
/** Cards about a plugin that stopped working: the plugin's configuration is attached, so the fix is made in the card. */
const PLUGIN_KINDS: readonly DecisionKind[] = ["connection_lost", "inbound_stopped"];

/** How far a card is dragged, in pixels, before it counts as a swipe. */
const SWIPE_PX = 120;

const PLACEHOLDER: Partial<Record<DecisionKind, string>> = {
  room_stuck: "What should it do next? Type @ to mention a bot.",
  room_failed: "What should it do next? Type @ to mention a bot.",
  permission_request: "Your answer to the request",
  task_ask: "Your answer (optional)",
  loop_paused: "Your answer (optional)",
};

function ContextLines({ context }: { context: CatchUpContext }) {
  const lines = [
    context.subject,
    context.status,
    context.pending ? `${context.pending} waiting` : undefined,
    context.extra,
  ].filter((l): l is string => Boolean(l));
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm text-pretty">
      {lines.map((l) => (
        <li key={l} className="break-words">
          {l}
        </li>
      ))}
    </ul>
  );
}

/** A key hint on a button. Phones have no keyboard, so it hides there. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-2 hidden rounded border border-current/30 px-1 text-[10px] font-medium opacity-70 sm:inline">
      {children}
    </kbd>
  );
}

/** "Skip for now": the card stays pending and goes to the back. It sits in the action row of every kind of card. */
export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <Button variant="outline" onClick={onSkip}>
      Skip for now
      <Key>J</Key>
    </Button>
  );
}

/**
 * One decision card, big and with its context: who asks, what it is about, and the two things the person can do. The buttons carry
 * `data-catch-up` so the page's keys (A, D) press the same buttons a click does, for every kind of card.
 */
export function DecisionCard({
  card,
  bot,
  bots,
  busy,
  error,
  isAdmin,
  onAct,
  onDeny,
  onChanged,
  onRecheck,
  onSkip,
}: {
  card: CatchUpCard;
  bot: Bot | undefined;
  bots: Bot[];
  busy: boolean;
  error: string | undefined;
  isAdmin: boolean;
  onAct: (text: string) => void;
  onDeny: () => void;
  /** The plugin was configured or connected: refresh what the queue shows. */
  onChanged: () => void;
  /** "Check again": look at the queue again; if the card is still needed it goes to the back and the next one shows. */
  onRecheck: () => void;
  /** Absent when there is no other card to go to. */
  onSkip: (() => void) | undefined;
}) {
  const [text, setText] = useState("");
  const { act, actLabel, denyLabel, input } = card.actions;
  const takesText = input === "text" || input === "optional_text";
  const missingText = input === "text" && text.trim() === "";
  // "Reconnect" has nothing to run here: the person fixes it in the plugin panel below, and this asks the queue to look again.
  const reconnect = act === "reconnect";
  const plugin = PLUGIN_KINDS.includes(card.kind) ? card.context.plugin : undefined;
  return (
    <article
      aria-label={card.title}
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <header className="flex items-start justify-between gap-3">
        {bot ? (
          <BotIdentity bot={bot} size={32} sub={relativeTime(card.createdAt)} />
        ) : (
          <span className="text-sm text-muted-foreground">{relativeTime(card.createdAt)}</span>
        )}
        {card.occurrences > 1 && <Badge tone="warning">Happened {card.occurrences} times</Badge>}
      </header>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">{card.title}</h2>
        {card.detail && (
          <p className="whitespace-pre-wrap text-sm text-pretty text-muted-foreground">
            {card.detail}
          </p>
        )}
      </div>
      <ContextLines context={card.context} />
      {card.nextAction && <p className="text-sm text-pretty">{card.nextAction}</p>}
      {plugin && (
        <section aria-label={`Set up ${plugin}`} className="rounded-xl border bg-muted/30 p-4">
          <Suspense fallback={<Loading />}>
            <PluginSetup pluginId={plugin} isAdmin={isAdmin} onChanged={onChanged} />
          </Suspense>
        </section>
      )}
      {takesText && (
        <div data-catch-up-input>
          <MentionField
            bots={bots}
            value={text}
            onChange={setText}
            rows={3}
            disabled={busy}
            placeholder={PLACEHOLDER[card.kind] ?? "Write a message"}
            aria-label={actLabel}
            wrapperClassName="rounded-lg border bg-background px-3 py-2"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2">
        {card.resultLink ? (
          <Link
            to={card.resultLink as never}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Open in chat
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onSkip && <SkipButton onSkip={onSkip} />}
          <Button variant="destructive" disabled={busy} data-catch-up="deny" onClick={onDeny}>
            {denyLabel}
            <Key>D</Key>
          </Button>
          <Button
            variant={act === "open_chat" || reconnect ? "default" : "success"}
            disabled={busy || missingText}
            data-catch-up="act"
            onClick={() => (reconnect ? onRecheck() : onAct(text.trim()))}
          >
            {actLabel}
            <Key>A</Key>
          </Button>
        </div>
      </footer>
    </article>
  );
}

/**
 * Lets a touch swipe decide the card: right acts (only when one tap is enough), left denies. A mouse never drags it, and a drag that
 * starts on a control, a link or the text box is left to that control. The card snaps back; the page does the rest.
 */
export function SwipeShell({
  canAct,
  onAct,
  onDeny,
  children,
}: {
  canAct: boolean;
  onAct: () => void;
  onDeny: () => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion();
  return (
    <motion.div
      drag="x"
      dragControls={controls}
      dragListener={false}
      dragSnapToOrigin
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={reduce ? 0 : 0.25}
      className="touch-pan-y"
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.pointerType !== "touch") return;
        if (target.closest("button, a, input, textarea, select, [contenteditable], .cm-editor"))
          return;
        controls.start(e);
      }}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_PX && canAct) onAct();
        else if (info.offset.x < -SWIPE_PX) onDeny();
      }}
    >
      {children}
    </motion.div>
  );
}
