import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  WarningCircleIcon,
  FilePlusIcon,
  PencilLineIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { BotAvatar, type AvatarValue } from "@/components/bot-avatar";
import { Button, Input, Progress, Select } from "@/components/ui";
import "../code/register";
import "../computer/register";
import "../plugins/register";
import "../discussions/register";
import "../inbound/register";
import { BotAccounts } from "../chat/bot-accounts";
import { BotAvatarPicker } from "../chat/bot-avatar-picker";
import { BotDecision } from "../chat/bot-decision";
import { BotHooks } from "../chat/bot-hooks";
import { duplicateOf, isAllowedModel, modelOptions } from "../chat/bot-presets";
import { registeredBotSections } from "../chat/bot-sections";
import { chatClient, errorMessage, type Bot, type OutputStyleKey } from "../chat/chat-client";
import { OutputStylePicker } from "../output-styles/output-style-picker";
import { styleLabel } from "../output-styles/output-styles-api";
import { MentionTextarea } from "../chat/mention";
import { useSidebarData } from "../chat/sidebar-data";
import { Badge, Choice, field } from "../shared/ui";
import { harnessQueries } from "../studio/studio-queries";
import { usePlugins } from "../plugins/plugins-api";
import {
  BOT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  sameAvatar,
  templateById,
  templateInput,
  templateSettings,
  templateTools,
  type BotTemplate,
} from "./bot-templates";
import { TemplatePreview, type TemplateEngine } from "./template-preview";
import type { BotsNewSearch } from "./bots-new-search";
import { grokApi, localTimezone, type BotImportDraft } from "./grok-api";
import { GrokCatalog, GrokPreviewPanel } from "./grok-market";
import { GrokReview } from "./grok-review";
import { extractActions, reviewInstructions, reviewScore } from "./instruction-review";
import { FRESH_INTERVIEW, type InterviewState } from "./interview-flow";
import { InstructionsInterview } from "./instructions-interview";
import { Response } from "../chat/response";
import { Alert } from "@g4rcez/components/alert";
import { IconHint } from "@/components/icon-hint";

export type Draft = {
  name: string;
  description: string;
  harness: string;
  model: string;
  personality: string;
  instructions: string;
  outputStyle: OutputStyleKey;
  outputStyleId: string | null;
  visibility: "private" | "team";
};
const BLANK: Draft = {
  name: "",
  description: "",
  harness: "fixture",
  model: "",
  personality: "",
  instructions: "",
  outputStyle: "default",
  outputStyleId: null,
  visibility: "team",
};

/** Steps before "Create" edit a local draft; steps after it configure the bot that now exists (plugins, accounts and extras need its id). */
const STEPS = [
  {
    id: "start",
    title: "Starting point",
    question: "How do you want to start?",
    lede: "A template fills in the personality and instructions. Everything stays editable.",
  },
  {
    id: "identity",
    title: "Identity",
    question: "Who is this bot?",
    lede: "People pick bots by name and description, and so does your chief of staff when it routes requests.",
  },
  {
    id: "engine",
    title: "Engine",
    question: "What runs it?",
    lede: "The harness reads the instructions, calls tools and writes the answers.",
  },
  {
    id: "instructions",
    title: "Instructions",
    question: "What should it do?",
    lede: "Personality is who it is. Instructions are what it does and how. Answer a few questions and we'll draft them.",
  },
  {
    id: "review",
    title: "Review & create",
    question: "Ready to create it?",
    lede: "Check the essentials. Tools, accounts and extras come right after.",
  },
  {
    id: "plugins",
    title: "Plugins & tools",
    question: "Which tools may it use?",
    lede: "Plugins and MCP servers let it search, read files, use calendars and more. Your choices only apply to you.",
  },
  {
    id: "accounts",
    title: "Accounts",
    question: "Which accounts does it need?",
    lede: "Declare the provider keys it needs. Everyone who chats with it connects their own.",
  },
  {
    id: "extras",
    title: "Extras",
    question: "Anything extra?",
    lede: "Power features most bots don't need. Each can be changed later in the bot's settings.",
  },
  {
    id: "done",
    title: "Test drive",
    question: "Take it for a test drive",
    lede: "Send it a real task and see how it answers. You can change its settings at any time.",
  },
] as const;
const CREATE_AT = STEPS.findIndex((s) => s.id === "review");

/** Verified harnesses get their own row; the rest share one "experimental" group so the same caveat isn't repeated five times. */
const PRIMARY_HARNESSES = [
  {
    id: "claude-code",
    name: "Claude Code",
    badge: "Recommended",
    blurb: "Verified. Strong at reasoning, code and tool use.",
  },
  {
    id: "decision",
    name: "Decision model",
    badge: undefined,
    blurb: "Laya or Jev pick one of your answers. Fast and zero tokens; no free text.",
  },
  {
    id: "fixture",
    name: "Offline test",
    badge: undefined,
    blurb: "Canned replies, no provider needed. Good to try the flow, not for real work.",
  },
] as const;
/** A flat tile for choices that are not a bot (start blank). Templates show the picture the bot will get. */
const ArtTile = ({ icon: Icon, tint }: { icon: PhosphorIcon; tint: string }) => (
  <span
    aria-hidden="true"
    className={`grid size-11 shrink-0 place-items-center rounded-lg ${tint}`}
  >
    <Icon className="size-5" />
  </span>
);

const EXPERIMENTAL_HARNESSES = [
  "codex",
  "pi",
  "omp",
  "opencode",
  "cursor",
  "hermes",
  "deepseek",
] as const;

/** Full-page, step-by-step "new bot" experience: explains each choice, reviews the instructions, then wires plugins, accounts and extras. */
export function BotOnboarding({
  search = {},
  setSearch = () => {},
}: {
  /** The Grok Bot marketplace view (source, search, category, pick) as the address holds it. */
  search?: BotsNewSearch;
  setSearch?: (
    patch: Partial<Record<keyof BotsNewSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
} = {}) {
  const navigate = useNavigate();
  // The sidebar's list: a bot added here shows in the sidebar at once.
  const { bots, setBots } = useSidebarData();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [origin, setOrigin] = useState<string>("blank");
  const [avatar, setAvatar] = useState<AvatarValue | null>(null);
  const [interview, setInterview] = useState<InterviewState>(FRESH_INTERVIEW);
  const [bot, setBot] = useState<Bot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  // A marketplace bot adapted into a draft the person is reviewing, and what the page is doing about it.
  const [grokDraft, setGrokDraft] = useState<BotImportDraft | null>(null);
  const [grokWork, setGrokWork] = useState<"idle" | "adapting" | "creating">("idle");
  const reviewing = grokDraft !== null && !bot;
  // The engine the person did not pick yet follows what works here: Claude Code when it is ready, else the offline test engine.
  const engineChosen = useRef(false);
  const harnesses = useQuery(harnessQueries.list());
  const claudeReady = harnesses.data?.some(
    (h) => h.harness === "claude-code" && h.status === "ready",
  );
  useEffect(() => {
    if (claudeReady && !engineChosen.current && !bot)
      setDraft((d) => (d.harness === "fixture" ? { ...d, harness: "claude-code", model: "" } : d));
  }, [claudeReady, bot]);
  const set = (patch: Partial<Draft>) => {
    if (patch.harness !== undefined) engineChosen.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };
  const template = templateById(origin);
  const engine: TemplateEngine =
    draft.harness === "fixture"
      ? { label: "the offline test engine", ready: false }
      : { label: draft.harness === "claude-code" ? "Claude Code" : draft.harness, ready: true };
  const checks = useMemo(
    () => reviewInstructions(draft.personality, draft.instructions),
    [draft.personality, draft.instructions],
  );
  const current = STEPS[step]!;
  const canNext = current.id === "identity" ? draft.name.trim().length > 0 : true;

  function choose(id: string) {
    setOrigin(id);
    if (id === "blank") {
      setDraft((d) => ({ ...BLANK, name: d.name, description: d.description }));
      return;
    }
    const chosen = templateById(id);
    if (chosen) {
      // Switching templates replaces what the last one filled in; a name or description the person typed is kept.
      const previous = template;
      setDraft((d) => ({
        ...d,
        personality: chosen.personality,
        instructions: chosen.instructions,
        outputStyle: chosen.outputStyle,
        outputStyleId: null,
        description:
          !d.description || d.description === previous?.description
            ? chosen.description
            : d.description,
        name: !d.name || d.name === previous?.title ? chosen.title : d.name,
      }));
      // Keep a picture the person chose themselves; take the template's when there is none or it was the last template's.
      setAvatar((a) => (a === null || sameAvatar(a, previous?.avatar) ? chosen.avatar : a));
      return;
    }
    const source = bots.find((b) => b.id === id);
    if (source) {
      setDraft(duplicateOf(source));
      setAvatar(source.avatar ?? null);
    }
  }
  /** Creates the bot from the draft. With `fromTemplate`, the template's own settings (computer use, code access) come along. */
  async function create(fromTemplate?: BotTemplate) {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await chatClient.createBot({
        ...(fromTemplate ? templateInput(fromTemplate) : {}),
        avatar,
        name: draft.name.trim(),
        description: draft.description,
        visibility: draft.visibility,
        harness: draft.harness,
        model: draft.model.trim() || null,
        personality: draft.personality,
        instructions: draft.instructions,
        outputStyle: draft.outputStyle,
        outputStyleId: draft.outputStyleId,
      });
      setBot(created);
      setBots((l) => [...l, created]);
      // Suggested plugins are the next useful thing to set up; with none, go straight to the test drive.
      setStep(fromTemplate && fromTemplate.tools.length === 0 ? STEPS.length - 1 : CREATE_AT + 1);
      setNotice(
        `${created.name} is created. The next steps are optional: skip any of them and change it later in its settings.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  /** Has the person's Chief adapt a marketplace bot into a draft to review. Nothing is created yet; it can take a minute or two. */
  async function adaptGrok(id: string) {
    if (grokWork !== "idle") return;
    setGrokWork("adapting");
    setError(undefined);
    try {
      setGrokDraft(await grokApi.analyze(id, localTimezone()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGrokWork("idle");
    }
  }
  /** Creates what the reviewed draft says, then carries on at the plugins step with the bot that now exists. */
  async function createFromGrok() {
    if (!grokDraft || grokWork !== "idle") return;
    setGrokWork("creating");
    setError(undefined);
    try {
      const result = await grokApi.install(grokDraft);
      const created = (await chatClient.bots()).find((b) => b.id === result.bot.id);
      if (!created)
        throw new Error("The bot was created, but it could not be opened. Find it in the sidebar.");
      setBot(created);
      setBots((l) => (l.some((b) => b.id === created.id) ? l : [...l, created]));
      setDraft({
        ...BLANK,
        name: created.name,
        description: created.description,
        harness: created.harness,
        model: created.model ?? "",
        personality: created.personality,
        instructions: created.instructions,
        visibility: created.visibility,
      });
      setAvatar(grokDraft.avatar);
      const running = result.routines.filter((r) => r.state === "active").length;
      const paused = result.routines.length - running;
      setGrokDraft(null);
      setStep(CREATE_AT + 1);
      setNotice(
        `${created.name} is created with ${result.skills.length} skill${result.skills.length === 1 ? "" : "s"}, ${result.notes} note${result.notes === 1 ? "" : "s"} and ${result.routines.length} routine${result.routines.length === 1 ? "" : "s"}` +
          `${result.routines.length ? ` (${running} running${paused ? `, ${paused} paused` : ""})` : ""}.` +
          `${result.integrations.length ? ` It needs ${result.integrations.map((i) => i.name).join(", ")}: connect them under Plugins.` : ""}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGrokWork("idle");
    }
  }
  const go = (to: number) => {
    setError(undefined);
    setStep(to);
  };
  const replaceBot = (b: Bot) => {
    setBot((prev) => ({ ...prev, ...b, canEdit: true }));
    setBots((l) => l.map((x) => (x.id === b.id ? { ...x, ...b, canEdit: true } : x)));
  };
  // "new" opens an empty chat with this bot; a bare /chat ignores ?bot= and reopens the last chat.
  const finish = () =>
    void navigate(
      bot
        ? { to: "/chat/{-$chatId}", params: { chatId: "new" }, search: { bot: bot.id } }
        : { to: "/chat/{-$chatId}" },
    );
  const reachable = (i: number) =>
    reviewing
      ? false
      : bot
        ? i > CREATE_AT
        : i <= step || (i <= CREATE_AT && draft.name.trim().length > 0);
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full w-full md:grid-cols-[15rem_minmax(0,1fr)] md:gap-12 md:px-8 xl:gap-16 xl:px-12">
        <aside className="px-4 pt-4 md:sticky md:top-0 md:self-start md:px-0 md:pt-8">
          <Link
            to="/chat/{-$chatId}"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            {bot ? "Back to chat" : "Cancel"}
          </Link>
          <div className="mt-6 flex items-baseline justify-between gap-2">
            <h1 className="text-sm font-semibold">New bot</h1>
            <span className="text-xs tabular-nums text-muted-foreground">
              {step + 1} of {STEPS.length}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <nav aria-label="Steps" className="mt-5 hidden md:block">
            <StepGroup
              label="Create"
              from={0}
              to={CREATE_AT}
              step={step}
              reachable={reachable}
              onGo={go}
            />
            <StepGroup
              label="Then connect"
              from={CREATE_AT + 1}
              to={STEPS.length - 1}
              step={step}
              reachable={reachable}
              onGo={go}
            />
          </nav>
        </aside>

        <main className="flex min-w-0 flex-col px-4 md:px-0">
          <header className="flex items-start gap-4 pt-6 pb-8 md:pt-16">
            {(bot || draft.name.trim()) && (
              <BotAvatar
                bot={bot ?? { id: "new-bot", avatar }}
                size={44}
                square
                className="mt-0.5 shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight text-balance">
                {reviewing ? "Read it over before it exists" : current.question}
              </h2>
              <p className="mt-1.5 max-w-[72ch] text-pretty text-muted-foreground">
                {reviewing
                  ? "Your Chief adapted this bot. Change anything, or leave parts out. Nothing is created until you press Create."
                  : current.lede}
              </p>
            </div>
          </header>
          <div className="flex-1 space-y-4 pb-10">
            {notice && (
              <Alert theme="success" onClose={() => setNotice(undefined)}>
                {notice}
              </Alert>
            )}
            {error && !reviewing && <Alert theme="danger">{error}</Alert>}

            {reviewing && grokDraft ? (
              <GrokReview
                draft={grokDraft}
                onChange={setGrokDraft}
                bots={bots}
                busy={grokWork === "creating"}
                error={error}
                onBack={() => {
                  setError(undefined);
                  setGrokDraft(null);
                }}
                onCreate={() => void createFromGrok()}
              />
            ) : (
              <>
                {current.id === "start" && (
                  <StartStep
                    origin={origin}
                    bots={bots.filter((b) => b.canEdit)}
                    onChoose={choose}
                    engine={engine}
                    busy={busy}
                    onCreate={(t) => void create(t)}
                    onCustomize={() => go(step + 1)}
                    search={search}
                    setSearch={setSearch}
                    adapting={grokWork === "adapting"}
                    onAdapt={(id) => void adaptGrok(id)}
                  />
                )}
                {current.id === "identity" && (
                  <IdentityStep draft={draft} set={set} avatar={avatar} setAvatar={setAvatar} />
                )}
                {current.id === "engine" && <EngineStep draft={draft} set={set} />}
                {current.id === "instructions" && (
                  <InstructionsStep
                    draft={draft}
                    set={set}
                    avatar={avatar}
                    interview={interview}
                    setInterview={setInterview}
                    checks={checks}
                  />
                )}
                {current.id === "review" && (
                  <ReviewStep draft={draft} checks={checks} onEdit={go} template={template} />
                )}
                {current.id === "plugins" && bot && (
                  <PluginsStep
                    bot={bot}
                    bots={bots}
                    onBotChange={replaceBot}
                    notify={setNotice}
                    template={template}
                  />
                )}
                {current.id === "accounts" && bot && (
                  <Guided
                    good={[
                      "Each teammate connects their own key, so usage is billed to whoever chats.",
                      "Name keys after what they're for, e.g. “llm” or “search”.",
                    ]}
                    bad={[
                      "Sharing one personal key across the team.",
                      "Requiring accounts the bot never uses: people get blocked for nothing.",
                    ]}
                  >
                    <BotAccounts bot={bot} onBotChange={replaceBot} />
                  </Guided>
                )}
                {current.id === "extras" && bot && (
                  <ExtrasStep bot={bot} bots={bots} onBotChange={replaceBot} />
                )}
                {current.id === "done" && bot && (
                  <DoneStep bot={bot} draft={draft} checks={checks} template={template} />
                )}
              </>
            )}
          </div>

          {!reviewing && (
            <footer className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background px-4 py-3 md:mx-0 md:px-0">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0 || step === CREATE_AT + 1}
                onClick={() => go(step - 1)}
              >
                <ArrowLeftIcon />
                Back
              </Button>
              <div className="flex items-center gap-2">
                {current.id === "identity" && !canNext && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Give it a name to continue
                  </span>
                )}
                {step > CREATE_AT && step < STEPS.length - 1 && (
                  <Button type="button" variant="ghost" onClick={() => go(step + 1)}>
                    Skip
                  </Button>
                )}
                {step < CREATE_AT && !(current.id === "start" && search.source === "grok") && (
                  <Button type="button" disabled={!canNext} onClick={() => go(step + 1)}>
                    {current.id === "start" && template ? "Customize" : "Continue"}
                    <ArrowRightIcon />
                  </Button>
                )}
                {step === CREATE_AT && (
                  <Button
                    type="button"
                    disabled={busy || !draft.name.trim()}
                    onClick={() => void create(template)}
                  >
                    {busy ? "Creating…" : "Create bot"}
                  </Button>
                )}
                {step > CREATE_AT && step < STEPS.length - 1 && (
                  <Button type="button" onClick={() => go(step + 1)}>
                    Continue
                    <ArrowRightIcon />
                  </Button>
                )}
                {step === STEPS.length - 1 && (
                  <Button type="button" onClick={finish}>
                    Start chatting
                    <ArrowRightIcon />
                  </Button>
                )}
              </div>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}

function StepGroup({
  label,
  from,
  to,
  step,
  reachable,
  onGo,
}: {
  label: string;
  from: number;
  to: number;
  step: number;
  reachable: (i: number) => boolean;
  onGo: (i: number) => void;
}) {
  return (
    <div className="mb-5">
      <p className="mb-1 px-2 text-xs text-muted-foreground">{label}</p>
      <ol className="space-y-px">
        {STEPS.slice(from, to + 1).map((s, k) => {
          const i = from + k;
          const active = i === step;
          const done = i < step;
          const open = reachable(i);
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!open || active}
                aria-current={active ? "step" : undefined}
                onClick={() => onGo(i)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent font-medium text-accent-foreground" : open ? "text-foreground/80 hover:bg-muted" : "cursor-default text-muted-foreground/60"}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-xs tabular-nums ${done ? "bg-primary text-primary-foreground" : active ? "ring-1 ring-primary text-primary" : "ring-1 ring-border"}`}
                >
                  {done ? <CheckIcon className="size-3" /> : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A step body with quiet "what works / what to avoid" guidance beside it (below it on narrow screens). */
function Guided({
  good,
  bad,
  children,
  aside,
}: {
  good: string[];
  bad: string[];
  children: ReactNode;
  /** Replaces the tips column (the start step shows the chosen template there). */
  aside?: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8 text-sm">{children}</div>
      {aside ?? (
        <aside
          aria-label="Tips"
          className="space-y-5 border-t pt-6 text-sm leading-relaxed lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <TipList title="What works" tone="text-success" items={good} />
          <TipList title="What to avoid" tone="text-warn" items={bad} />
        </aside>
      )}
    </div>
  );
}
function TipList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <h3 className={`mb-1.5 text-xs font-medium ${tone}`}>{title}</h3>
      <ul className="space-y-2 text-muted-foreground">
        {items.map((t) => (
          <li key={t} className="text-pretty">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A labelled section inside a step: tight label-to-content, generous space between sections (set by the parent). */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-3">
      <div>
        <h3 className="font-medium">{label}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const SOURCES = [
  { id: "templates", label: "Templates and your bots" },
  { id: "grok", label: "Grok Bot marketplace" },
] as const;

/** Where the bot starts from. The choice is in the address, so a link opens the marketplace view directly. */
function SourceTabs({
  value,
  onChange,
}: {
  value: "templates" | "grok";
  onChange: (s: "templates" | "grok") => void;
}) {
  return (
    <div role="tablist" aria-label="Where to start from" className="flex gap-1 border-b">
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={value === s.id}
          onClick={() => onChange(s.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${value === s.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function StartStep({
  origin,
  bots,
  onChoose,
  engine,
  busy,
  onCreate,
  onCustomize,
  search,
  setSearch,
  adapting,
  onAdapt,
}: {
  origin: string;
  bots: Bot[];
  onChoose: (id: string) => void;
  engine: TemplateEngine;
  busy: boolean;
  onCreate: (t: BotTemplate) => void;
  onCustomize: () => void;
  search: BotsNewSearch;
  setSearch: (
    patch: Partial<Record<keyof BotsNewSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  /** The person's Chief is adapting a marketplace bot. */
  adapting: boolean;
  onAdapt: (id: string) => void;
}) {
  const grok = search.source === "grok";
  const copying = bots.some((b) => b.id === origin);
  const chosen = templateById(origin);
  const previewRef = useRef<HTMLElement>(null);
  const shown = useRef(chosen?.id);
  useEffect(() => {
    // Below the lg breakpoint the preview sits under the gallery: bring it into view when the choice changes.
    if (chosen && shown.current !== chosen.id && !window.matchMedia("(min-width: 1024px)").matches)
      previewRef.current?.scrollIntoView({ block: "nearest" });
    shown.current = chosen?.id;
  }, [chosen]);
  const { catalog } = usePlugins(() => {});
  // A suggestion this install's catalog does not know is left out; a required one stays, because hiding it would hide the requirement.
  const tools = chosen
    ? templateTools(chosen).flatMap((t) => {
        const meta = catalog?.find((c) => c.id === t.id);
        return meta || t.need === "required"
          ? [{ id: t.id, name: meta?.name ?? t.id, why: t.why, need: t.need }]
          : [];
      })
    : [];
  return (
    <Guided
      good={
        grok
          ? [
              "Open a bot to see its skills, its scheduled runs and what it needs before you decide.",
              "Read the draft closely: the skill steps are written by your Chief from one-line descriptions.",
            ]
          : [
              "Pick the template closest to the job and adapt it: it's faster than a blank page.",
              "Copy a bot that already works when you need a variant of it.",
            ]
      }
      bad={
        grok
          ? [
              "Switching on routines you have not read: they start running on their schedule.",
              "Trusting a bot's text because it is on a public marketplace. Read what it tells the bot to do.",
            ]
          : [
              "One bot for everything. Narrow specialists give sharper answers and are easier to fix.",
              "Keeping a template's text without adapting it to your context.",
            ]
      }
      aside={
        grok ? (
          search.grok ? (
            <GrokPreviewPanel id={search.grok} busy={adapting} onAdapt={onAdapt} />
          ) : undefined
        ) : chosen ? (
          <aside
            ref={previewRef}
            aria-label="Chosen template"
            className="lg:sticky lg:top-8 lg:self-start"
          >
            <TemplatePreview
              template={chosen}
              engine={engine}
              tools={tools}
              busy={busy}
              onCreate={() => onCreate(chosen)}
              onCustomize={onCustomize}
            />
          </aside>
        ) : undefined
      }
    >
      <SourceTabs
        value={grok ? "grok" : "templates"}
        onChange={(s) => setSearch({ source: s === "grok" ? "grok" : undefined })}
      />
      {grok ? (
        <GrokCatalog
          q={search.q ?? ""}
          category={search.category ?? ""}
          picked={search.grok}
          onQuery={(q) => setSearch({ q: q || undefined }, { replace: true })}
          onCategory={(category) => setSearch({ category: category || undefined })}
          onPick={(id) => setSearch({ grok: id })}
        />
      ) : (
        <div role="radiogroup" aria-label="Starting point" className="space-y-8">
          <Group
            label="Start from a template"
            hint="Each one comes set up. Create it as it is, or change anything first."
          >
            <div className="space-y-6">
              {TEMPLATE_CATEGORIES.map((c) => (
                <section key={c.id} aria-label={c.label} className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </h4>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {BOT_TEMPLATES.filter((t) => t.category === c.id).map((t) => (
                      <Choice
                        key={t.id}
                        name="origin"
                        value={t.id}
                        checked={origin === t.id}
                        onSelect={onChoose}
                        title={t.title}
                        art={
                          <BotAvatar
                            bot={{ id: t.id, avatar: t.avatar }}
                            size={44}
                            square
                            className="shrink-0"
                          />
                        }
                      >
                        {t.description}
                      </Choice>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Group>
          <Group label="Or start from scratch">
            <Choice
              name="origin"
              value="blank"
              checked={origin === "blank"}
              onSelect={onChoose}
              art={<ArtTile icon={FilePlusIcon} tint="bg-muted text-muted-foreground" />}
              title="Blank bot"
            >
              Write it yourself. The instructions step will guide you with a few questions.
            </Choice>
          </Group>
          {bots.length > 0 && (
            <Group
              label="Or copy one of your bots"
              hint="Copies its personality, instructions and engine."
            >
              <select
                aria-label="Bot to copy"
                className={`${field} max-w-md ${copying ? "border-primary" : ""}`}
                value={copying ? origin : ""}
                onChange={(e) => e.target.value && onChoose(e.target.value)}
              >
                <option value="" disabled>
                  Choose a bot…
                </option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Group>
          )}
        </div>
      )}
    </Guided>
  );
}

export function IdentityStep({
  draft,
  set,
  avatar,
  setAvatar,
  kind,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  avatar: AvatarValue | null;
  setAvatar: (v: AvatarValue | null) => void;
  kind?: "chief" | "specialist";
}) {
  return (
    <Guided
      good={[
        "A name that says the job: “Release notes”, “SQL helper”.",
        "A description that says when to use it: “Turns merged PRs into customer-facing notes.”",
        "Team visibility for bots others will use; private for experiments.",
      ]}
      bad={[
        "Generic names like “Helper” or “Bot 2”: nobody knows when to pick them.",
        "Empty descriptions: the chief of staff uses them to route requests.",
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Input
          title="Name"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={80}
          required
          placeholder="e.g. Release notes"
        />
        <Input
          title="Description"
          required={false}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={2048}
          placeholder="What is it good at, and when should someone use it?"
        />
      </div>
      <Group label="Picture">
        <BotAvatarPicker botId="new-bot" kind={kind} value={avatar} onChange={setAvatar} />
      </Group>
      <Group label="Who can chat with it?">
        <div role="radiogroup" aria-label="Visibility" className="grid gap-3 sm:grid-cols-2">
          <Choice
            name="visibility"
            value="team"
            checked={draft.visibility === "team"}
            onSelect={() => set({ visibility: "team" })}
            title="Team"
          >
            Teammates can find and chat with it. Only you can change it.
          </Choice>
          <Choice
            name="visibility"
            value="private"
            checked={draft.visibility === "private"}
            onSelect={() => set({ visibility: "private" })}
            title="Private"
          >
            Only you. Good for drafts and personal helpers.
          </Choice>
        </div>
      </Group>
    </Guided>
  );
}

export function EngineStep({ draft, set }: { draft: Draft; set: (p: Partial<Draft>) => void }) {
  const pick = (h: string) =>
    set({ harness: h, model: isAllowedModel(h, draft.model) ? draft.model : "" });
  return (
    <Guided
      good={[
        "Claude Code for real work: it's the verified harness.",
        "The offline test engine if you only want to try the flow.",
        "Keep the harness default model, or pick a smaller one (e.g. Haiku) for cheap, fast bots.",
      ]}
      bad={[
        "Shipping a team bot on the offline test engine: its answers are canned.",
        "The biggest model for simple, high-volume tasks.",
      ]}
    >
      <div role="radiogroup" aria-label="Harness" className="space-y-8">
        <div className="grid gap-3 sm:grid-cols-2">
          {PRIMARY_HARNESSES.map((h) => (
            <Choice
              key={h.id}
              name="harness"
              value={h.id}
              checked={draft.harness === h.id}
              onSelect={pick}
              title={
                <span className="flex items-center gap-2">
                  {h.name}
                  {h.badge && (
                    <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                      {h.badge}
                    </span>
                  )}
                </span>
              }
            >
              {h.blurb}
            </Choice>
          ))}
        </div>
        <Group
          label="Experimental"
          hint="Not verified in Zetta yet. They may work; expect rough edges."
        >
          <div className="flex flex-wrap gap-2">
            {EXPERIMENTAL_HARNESSES.map((h) => (
              <label
                key={h}
                className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${draft.harness === h ? "border-primary bg-primary/[0.06] text-foreground" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground"}`}
              >
                <input
                  type="radio"
                  name="harness"
                  value={h}
                  checked={draft.harness === h}
                  onChange={() => pick(h)}
                  className="sr-only"
                />
                {h}
              </label>
            ))}
          </div>
        </Group>
      </div>
      {draft.harness !== "fixture" && (
        <div className="max-w-md">
          <Select
            title="Model"
            required={false}
            value={draft.model}
            onChange={(e) => set({ model: e.target.value })}
            options={modelOptions(draft.harness)}
          />
        </div>
      )}
    </Guided>
  );
}

export function InstructionsStep({
  draft,
  set,
  avatar,
  interview,
  setInterview,
  checks,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  avatar: AvatarValue | null;
  interview: InterviewState;
  setInterview: (s: InterviewState | ((s: InterviewState) => InterviewState)) => void;
  checks: ReturnType<typeof reviewInstructions>;
}) {
  const { bots } = useSidebarData();
  return (
    <div className="@container text-sm">
      <div className="grid gap-4 @3xl:grid-cols-2">
        <div className="h-[min(40rem,72dvh)] min-h-0">
          <InstructionsInterview
            interviewer={
              draft.harness === "decision" ? bots.find((b) => b.kind === "chief") : undefined
            }
            engine={{
              harness: draft.harness,
              model: draft.model || null,
              name: draft.name,
              description: draft.description,
              avatar,
            }}
            state={interview}
            setState={setInterview}
            draft={{
              personality: draft.personality,
              instructions: draft.instructions,
              outputStyle: draft.outputStyle,
            }}
            onDraft={(d) =>
              set({
                instructions: d.instructions,
                ...(d.personality !== undefined ? { personality: d.personality } : {}),
                ...(d.outputStyle ? { outputStyle: d.outputStyle, outputStyleId: null } : {}),
              })
            }
          />
        </div>
        <ConfigPreview
          draft={draft}
          set={set}
          avatar={avatar}
          interview={interview}
          checks={checks}
        />
      </div>
    </div>
  );
}

/** The bot's configuration as it stands, beside the setup chat: it updates while the person talks. */
function ConfigPreview({
  draft,
  set,
  avatar,
  interview,
  checks,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  avatar: AvatarValue | null;
  interview: InterviewState;
  checks: ReturnType<typeof reviewInstructions>;
}) {
  const { bots } = useSidebarData();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const actions = useMemo(
    () => (interview.summary.length ? interview.summary : extractActions(draft.instructions)),
    [interview.summary, draft.instructions],
  );
  const hasDraft = draft.instructions.trim().length > 0 || draft.personality.trim().length > 0;
  const edit = editing || interview.manual;
  const score = reviewScore(checks);
  const todo = checks.filter((c) => !c.ok);
  return (
    <section
      aria-label="Preview"
      className="flex h-[min(40rem,72dvh)] min-h-0 flex-col overflow-hidden rounded-lg border bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <BotAvatar bot={{ id: "new-bot", avatar }} size={24} square className="shrink-0" />
        <h2 className="min-w-0 flex-1 truncate text-base font-bold leading-tight">
          {draft.name.trim() || "New bot"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">Preview</span>
        </h2>
        {interview.status === "thinking" && (
          <span role="status" className="text-xs text-muted-foreground">
            Updating…
          </span>
        )}
        {(hasDraft || interview.manual) && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
            <PencilLineIcon className="size-4" aria-hidden="true" />
            {edit ? "Done editing" : "Edit the text"}
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {hasDraft || interview.manual ? (
          <>
            {actions.length > 0 && (
              <section aria-label="What it will do" className="space-y-2">
                <h3 className="text-base font-semibold">What your bot will do</h3>
                <ul className="grid gap-2">
                  {actions.map((a, i) => (
                    <li key={i} className="flex gap-2 rounded-lg border bg-card p-3 text-pretty">
                      <CheckIcon
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {edit ? (
              <div className="space-y-6">
                <MentionTextarea
                  title="Personality"
                  required={false}
                  bots={bots}
                  value={draft.personality}
                  onChange={(personality) => set({ personality })}
                  rows={4}
                  maxLength={4096}
                  placeholder="You are a precise, friendly … who …"
                />
                <MentionTextarea
                  title="Instructions"
                  required={false}
                  bots={bots}
                  value={draft.instructions}
                  onChange={(instructions) => set({ instructions })}
                  rows={14}
                  maxLength={16384}
                  placeholder="Start by … then … Answer with … Never …"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <article aria-label="Personality" className="rounded-lg border bg-card p-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Personality
                  </h3>
                  {draft.personality.trim() ? (
                    <Response text={draft.personality} />
                  ) : (
                    <p className="text-muted-foreground">Not set yet.</p>
                  )}
                </article>
                <article aria-label="Instructions" className="rounded-lg border bg-card p-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Instructions
                  </h3>
                  {draft.instructions.trim() ? (
                    <Response text={draft.instructions} />
                  ) : (
                    <p className="text-muted-foreground">Not set yet.</p>
                  )}
                </article>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              <p className="flex flex-wrap items-center gap-x-2">
                <span>
                  Quality check: {checks.length - todo.length} of {checks.length} good ({score}%).
                </span>
                <button
                  type="button"
                  aria-expanded={details}
                  onClick={() => setDetails((d) => !d)}
                  className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {details
                    ? "Hide details"
                    : todo.length
                      ? `See ${todo.length} to improve`
                      : "See details"}
                </button>
              </p>
              {details && (
                <div className="mt-3 max-w-md text-sm">
                  <ReviewCard checks={checks} />
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Your answers turn into the configuration here.</p>
        )}
        <section aria-label="Output style" className="space-y-3">
          <div>
            <h3 className="text-base font-semibold">Output style</h3>
            <p className="text-muted-foreground">
              How the bot writes its answers. You can change it later in its settings.
            </p>
          </div>
          <OutputStylePicker
            name="output-style-new-bot"
            value={{ outputStyle: draft.outputStyle, outputStyleId: draft.outputStyleId }}
            onChange={set}
          />
        </section>
      </div>
    </section>
  );
}

function ReviewCard({ checks }: { checks: ReturnType<typeof reviewInstructions> }) {
  const score = reviewScore(checks);
  const tone = score >= 85 ? "success" : score >= 55 ? "warn" : "danger";
  return (
    <section aria-label="Quality checks" className="rounded-lg border bg-card p-4 text-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium">Instruction review</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {checks.filter((c) => c.ok).length}/{checks.length} good
        </span>
      </div>
      <Progress className="mb-4" label="Instruction quality" value={score} tone={tone} />
      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            {c.ok ? (
              <IconHint label="Good">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
              </IconHint>
            ) : (
              <IconHint label="Needs work">
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-warn" />
              </IconHint>
            )}
            <div className="min-w-0">
              <p className={c.ok ? "text-muted-foreground" : "font-medium"}>{c.label}</p>
              {!c.ok && <p className="text-xs text-pretty text-muted-foreground">{c.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One line of the review: what was chosen, and a button that jumps back to the step that sets it. */
function ReviewRow({
  label,
  step,
  onEdit,
  children,
}: {
  label: string;
  step: number;
  onEdit: (step: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-start gap-3 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
      {/* No hint: it shows the text Edit. */}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Edit ${label.toLowerCase()}`}
        onClick={() => onEdit(step)}
      >
        Edit
      </Button>
    </div>
  );
}

export function ReviewStep({
  draft,
  checks,
  onEdit,
  template,
}: {
  draft: Draft;
  checks: ReturnType<typeof reviewInstructions>;
  onEdit: (step: number) => void;
  /** The template the draft started from: its computer use and code access are applied when the bot is created. */
  template?: BotTemplate;
}) {
  const idx = (id: (typeof STEPS)[number]["id"]) => STEPS.findIndex((s) => s.id === id);
  const missing = checks.filter((c) => !c.ok);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6 text-sm">
        <dl className="divide-y border-y">
          <ReviewRow label="Name" step={idx("identity")} onEdit={onEdit}>
            <span className="font-medium">{draft.name}</span>
          </ReviewRow>
          <ReviewRow label="Description" step={idx("identity")} onEdit={onEdit}>
            {draft.description || <span className="text-muted-foreground">None</span>}
          </ReviewRow>
          <ReviewRow label="Visibility" step={idx("identity")} onEdit={onEdit}>
            {draft.visibility === "team" ? "Team" : "Private"}
          </ReviewRow>
          <ReviewRow label="Engine" step={idx("engine")} onEdit={onEdit}>
            {`${draft.harness === "fixture" ? "Offline test" : draft.harness}${draft.model ? ` · ${draft.model}` : ""}`}
          </ReviewRow>
          <ReviewRow label="Personality" step={idx("instructions")} onEdit={onEdit}>
            {draft.personality ? (
              <span className="line-clamp-3 whitespace-pre-wrap">{draft.personality}</span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </ReviewRow>
          <ReviewRow label="Instructions" step={idx("instructions")} onEdit={onEdit}>
            {draft.instructions ? (
              <span className="line-clamp-6 whitespace-pre-wrap">{draft.instructions}</span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </ReviewRow>
          <ReviewRow label="Output style" step={idx("instructions")} onEdit={onEdit}>
            {styleLabel(draft.outputStyle)}
          </ReviewRow>
          {template &&
            templateSettings(template)
              .filter((x) => x.label !== "Output style")
              .map((x) => (
                <div
                  key={x.label}
                  className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 py-3"
                >
                  <dt className="text-muted-foreground">{x.label}</dt>
                  <dd className="min-w-0 break-words">
                    {x.value}
                    <span className="ml-2 text-xs text-muted-foreground">
                      from the {template.title} template
                    </span>
                  </dd>
                </div>
              ))}
        </dl>
        {draft.harness === "fixture" && (
          <Alert theme="warn">
            It runs on the offline test engine, so its replies will be canned. Switch the engine for
            real work.
          </Alert>
        )}
        {missing.length > 0 && (
          <p className="text-muted-foreground">
            {missing.length} suggestion{missing.length > 1 ? "s" : ""} left for the instructions.
            You can create the bot now and improve them later.
          </p>
        )}
      </div>
      <aside className="self-start lg:sticky lg:top-8">
        <ReviewCard checks={checks} />
      </aside>
    </div>
  );
}

export function PluginsStep({
  bot,
  bots,
  onBotChange,
  notify,
  template,
}: {
  bot: Bot;
  bots: Bot[];
  onBotChange: (b: Bot) => void;
  notify: (m: string) => void;
  template?: BotTemplate;
}) {
  const plugins = registeredBotSections().find((s) => s.id === "plugins");
  const { catalog } = usePlugins(() => {});
  const wanted = template
    ? templateTools(template).flatMap((t) => {
        const meta = catalog?.find((c) => c.id === t.id);
        return meta || t.need === "required"
          ? [{ id: t.id, name: meta?.name ?? t.id, why: t.why, need: t.need }]
          : [];
      })
    : [];
  return (
    <Guided
      good={[
        "Only enable what the instructions mention: fewer tools, fewer wrong calls.",
        "Name each tool in the instructions (“Search the docs before answering”).",
      ]}
      bad={[
        "Enabling every plugin “just in case”: the bot gets slower and less predictable.",
        "Write access (email, calendar) on a team bot without saying when to use it.",
      ]}
    >
      {template && wanted.length > 0 && (
        <section aria-label="Plugins for this template" className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 font-medium">
            {wanted.some((t) => t.need === "required")
              ? `The ${template.title} template needs a plugin`
              : `The ${template.title} template works well with`}
          </h3>
          <ul className="space-y-2">
            {wanted.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                <strong className="font-medium">{t.name}</strong>
                {t.need === "required" && <Badge tone="warning">Required</Badge>}
                <span className="text-muted-foreground">{t.why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Install it if you have not, then turn it on for this bot below.
          </p>
        </section>
      )}
      {plugins?.render({ bot, bots, onBotChange, notify })}
      <p className="text-xs text-muted-foreground">
        Install more in{" "}
        <Link
          to="/studio/$tab"
          params={{ tab: "plugins" }}
          className="underline underline-offset-2"
        >
          Studio › Plugins
        </Link>
        .
      </p>
    </Guided>
  );
}

/** A folded section of optional setup: its title and why you would want it, with the controls inside. */
function ExtraSection({
  title,
  why,
  children,
}: {
  title: string;
  why: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-b py-1 first:border-t">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 focus-visible:outline-2 focus-visible:outline-ring">
        <span>
          <span className="block font-medium">{title}</span>
          <span className="text-xs text-pretty text-muted-foreground">{why}</span>
        </span>
        <span className="shrink-0 text-xs text-primary group-open:hidden">Set up</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">
          Hide
        </span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function ExtrasStep({
  bot,
  bots,
  onBotChange,
}: {
  bot: Bot;
  bots: Bot[];
  onBotChange: (b: Bot) => void;
}) {
  const computer = registeredBotSections().find((s) => s.id === "computer");
  return (
    <Guided
      good={[
        "Leave these off until you need them: most bots don't.",
        "Hooks to redact secrets or add standard context to every message.",
      ]}
      bad={[
        "Desktop control for bots that only read web pages: browser is enough.",
        "Routing rules that overlap: messages bounce between bots.",
      ]}
    >
      <div>
        {computer && (
          <ExtraSection
            title="Computer use"
            why="Let it browse websites or drive a desktop session."
          >
            {computer.render({ bot, bots, onBotChange, notify: () => {} })}
          </ExtraSection>
        )}
        <ExtraSection
          title="Hooks"
          why="Rules that run on every message: add context, redact text, stop or run in the background."
        >
          <BotHooks bot={bot} />
        </ExtraSection>
        <ExtraSection title="Routing" why="Decide when this bot hands a message to another bot.">
          <BotDecision bot={bot} bots={bots} />
        </ExtraSection>
      </div>
    </Guided>
  );
}

function DoneStep({
  bot,
  draft,
  checks,
  template,
}: {
  bot: Bot;
  draft: Draft;
  checks: ReturnType<typeof reviewInstructions>;
  template?: BotTemplate;
}) {
  const first = draft.instructions ? extractActions(draft.instructions)[0] : undefined;
  const left = checks.filter((c) => !c.ok).length;
  const tips = [
    {
      title: "Test the main job",
      body: first
        ? `Ask it something that exercises: “${first}”`
        : "Give it the kind of request it was made for.",
    },
    {
      title: "Test an edge case",
      body: "Send something vague or out of scope. It should ask or decline, not guess.",
    },
    {
      title: "Iterate",
      body:
        left === 0
          ? "Your instructions passed every check."
          : `${left} instruction suggestion${left > 1 ? "s" : ""} remain. Refine them from its settings.`,
    },
  ];
  return (
    <div className="space-y-8 text-sm">
      <div className="flex items-center gap-4">
        <BotAvatar bot={bot} size={56} square />
        <div>
          <p className="text-lg font-semibold">{bot.name}</p>
          <p className="text-muted-foreground">{bot.description || "Ready to chat"}</p>
        </div>
      </div>
      {template && (
        <section aria-label="Try asking" className="space-y-2">
          <h3 className="font-medium">Try asking</h3>
          <ul className="space-y-1.5 text-pretty text-muted-foreground">
            {template.starters.map((q) => (
              <li key={q}>“{q}”</li>
            ))}
          </ul>
        </section>
      )}
      <ol className="grid gap-x-8 divide-y border-y lg:grid-cols-3 lg:divide-y-0">
        {tips.map((t, i) => (
          <li key={t.title} className="flex gap-3 py-3">
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-full text-xs tabular-nums ring-1 ring-border"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{t.title}</p>
              <p className="text-pretty text-muted-foreground">{t.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
