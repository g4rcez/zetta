import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChartColumn,
  Check,
  CircleAlert,
  CodeXml,
  ConciergeBell,
  FilePlus2,
  HeartHandshake,
  PenLine,
  Sparkles,
  Telescope,
  X,
  type LucideIcon,
} from "lucide-react";

import { BotAvatar, type AvatarValue } from "@/components/bot-avatar";
import { Button, Input, Select, Textarea } from "@/components/ui";
import "../code/register";
import "../computer/register";
import "../plugins/register";
import "../discussions/register";
import "../inbound/register";
import { BotAccounts } from "../chat/bot-accounts";
import { BotAvatarPicker } from "../chat/bot-avatar-picker";
import { BotDecision } from "../chat/bot-decision";
import { BotHooks } from "../chat/bot-hooks";
import {
  PERSONALITY_PRESETS,
  duplicateOf,
  isAllowedModel,
  modelOptions,
} from "../chat/bot-presets";
import { registeredBotSections } from "../chat/bot-sections";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { field } from "../shared/ui";
import {
  composeInstructions,
  EMPTY_BRIEF,
  extractActions,
  reviewInstructions,
  reviewScore,
  type Brief,
} from "./instruction-review";

type Draft = {
  name: string;
  description: string;
  harness: string;
  model: string;
  personality: string;
  instructions: string;
  visibility: "private" | "team";
};
const BLANK: Draft = {
  name: "",
  description: "",
  harness: "fixture",
  model: "",
  personality: "",
  instructions: "",
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
    lede: "Send it a real task. After its first answer you'll be asked if you're satisfied: that finishes setup.",
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
    id: "fixture",
    name: "Offline test",
    badge: undefined,
    blurb: "Canned replies, no provider needed. Good to try the flow, not for real work.",
  },
] as const;
/** Illustration per template: an icon and a tint, so the grid scans by shape and colour before reading. */
const TEMPLATE_ART: Record<string, { icon: LucideIcon; tint: string }> = {
  researcher: { icon: Telescope, tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  coder: { icon: CodeXml, tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  editor: { icon: PenLine, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  analyst: { icon: ChartColumn, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  coach: { icon: HeartHandshake, tint: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  concierge: { icon: ConciergeBell, tint: "bg-teal-500/12 text-teal-600 dark:text-teal-400" },
};
const ArtTile = ({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) => (
  <span
    aria-hidden="true"
    className={`grid size-11 shrink-0 place-items-center rounded-lg ${tint}`}
  >
    <Icon className="size-5" strokeWidth={1.75} />
  </span>
);

const EXPERIMENTAL_HARNESSES = ["codex", "pi", "omp", "opencode", "cursor", "hermes"] as const;

const QUESTIONS: { key: keyof Brief; label: string; placeholder: string; rows: number }[] = [
  {
    key: "job",
    label: "What is its job, in one sentence?",
    placeholder: "e.g. Turn merged pull requests into customer-facing release notes",
    rows: 2,
  },
  {
    key: "steps",
    label: "What should it do, step by step? (one per line)",
    placeholder:
      "e.g. Read the PR titles and descriptions\nGroup changes by product area\nWrite one plain-language line per change",
    rows: 4,
  },
  {
    key: "output",
    label: "What does a great answer look like?",
    placeholder: "e.g. A markdown list grouped by area, under 200 words",
    rows: 2,
  },
  {
    key: "never",
    label: "What must it never do?",
    placeholder: "e.g. Mention internal ticket numbers or unreleased features",
    rows: 2,
  },
  {
    key: "ask",
    label: "When should it stop and ask you?",
    placeholder: "e.g. A change has no description or it is unclear who it affects",
    rows: 2,
  },
];

/** Full-page, step-by-step "new bot" experience: explains each choice, reviews the instructions, then wires plugins, accounts and extras. */
export function BotOnboarding() {
  const navigate = useNavigate();
  const [bots, setBots] = useState<Bot[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [origin, setOrigin] = useState<string>("blank");
  const [avatar, setAvatar] = useState<AvatarValue | null>(null);
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF);
  const [bot, setBot] = useState<Bot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    chatClient
      .bots()
      .then(setBots)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
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
    const preset = PERSONALITY_PRESETS.find((p) => p.id === id);
    if (preset) {
      set({
        personality: preset.personality,
        instructions: preset.instructions,
        description: draft.description || preset.description,
        name: draft.name || preset.label,
      });
      return;
    }
    const source = bots.find((b) => b.id === id);
    if (source) {
      setDraft(duplicateOf(source));
      setAvatar(source.avatar ?? null);
    }
  }
  async function create() {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await chatClient.createBot({
        avatar,
        name: draft.name.trim(),
        description: draft.description,
        visibility: draft.visibility,
        harness: draft.harness,
        model: draft.model.trim() || null,
        personality: draft.personality,
        instructions: draft.instructions,
      });
      setBot(created);
      setBots((l) => [...l, created]);
      setStep(CREATE_AT + 1);
      setNotice(
        `${created.name} is created. The next steps are optional: skip any of them and change it later in its settings.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const go = (to: number) => {
    setError(undefined);
    setStep(to);
  };
  const replaceBot = (b: Bot) => {
    setBot((prev) => ({ ...prev, ...b, canEdit: true }));
  };
  const finish = () =>
    void navigate({ to: "/chat/{-$chatId}", search: bot ? { bot: bot.id } : {} });
  const reachable = (i: number) =>
    bot ? i > CREATE_AT : i <= step || (i <= CREATE_AT && draft.name.trim().length > 0);
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full w-full md:grid-cols-[15rem_minmax(0,1fr)] md:gap-12 md:px-8 xl:gap-16 xl:px-12">
        <aside className="px-4 pt-4 md:sticky md:top-0 md:self-start md:px-0 md:pt-8">
          <Link
            to="/chat/{-$chatId}"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
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
                {current.question}
              </h2>
              <p className="mt-1.5 max-w-[72ch] text-pretty text-muted-foreground">
                {current.lede}
              </p>
            </div>
          </header>
          <div className="flex-1 space-y-4 pb-10">
            {notice && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
              >
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="flex-1">{notice}</p>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Dismiss"
                  onClick={() => setNotice(undefined)}
                >
                  <X />
                </Button>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            {current.id === "start" && (
              <StartStep origin={origin} bots={bots.filter((b) => b.canEdit)} onChoose={choose} />
            )}
            {current.id === "identity" && (
              <IdentityStep draft={draft} set={set} avatar={avatar} setAvatar={setAvatar} />
            )}
            {current.id === "engine" && <EngineStep draft={draft} set={set} />}
            {current.id === "instructions" && (
              <InstructionsStep
                draft={draft}
                set={set}
                brief={brief}
                setBrief={setBrief}
                checks={checks}
              />
            )}
            {current.id === "review" && <ReviewStep draft={draft} checks={checks} onEdit={go} />}
            {current.id === "plugins" && bot && (
              <PluginsStep bot={bot} bots={bots} onBotChange={replaceBot} notify={setNotice} />
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
            {current.id === "done" && bot && <DoneStep bot={bot} draft={draft} checks={checks} />}
          </div>

          <footer className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background px-4 py-3 md:mx-0 md:px-0">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 0 || step === CREATE_AT + 1}
              onClick={() => go(step - 1)}
            >
              <ArrowLeft />
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
              {step < CREATE_AT && (
                <Button type="button" disabled={!canNext} onClick={() => go(step + 1)}>
                  Continue
                  <ArrowRight />
                </Button>
              )}
              {step === CREATE_AT && (
                <Button
                  type="button"
                  disabled={busy || !draft.name.trim()}
                  onClick={() => void create()}
                >
                  {busy ? "Creating…" : "Create bot"}
                </Button>
              )}
              {step > CREATE_AT && step < STEPS.length - 1 && (
                <Button type="button" onClick={() => go(step + 1)}>
                  Continue
                  <ArrowRight />
                </Button>
              )}
              {step === STEPS.length - 1 && (
                <Button type="button" onClick={finish}>
                  Start chatting
                  <ArrowRight />
                </Button>
              )}
            </div>
          </footer>
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
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums ${done ? "bg-primary text-primary-foreground" : active ? "ring-1 ring-primary text-primary" : "ring-1 ring-border"}`}
                >
                  {done ? <Check className="size-3" /> : i + 1}
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
function Guided({ good, bad, children }: { good: string[]; bad: string[]; children: ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8 text-sm">{children}</div>
      <aside
        aria-label="Tips"
        className="space-y-5 border-t pt-6 text-[13px] leading-relaxed lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
      >
        <TipList title="What works" tone="text-emerald-600 dark:text-emerald-400" items={good} />
        <TipList title="What to avoid" tone="text-amber-600 dark:text-amber-400" items={bad} />
      </aside>
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

/** A selectable tile backed by a real radio input, so arrow keys, focus and screen readers behave natively. */
function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  art,
  children,
  className = "",
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (v: string) => void;
  title: ReactNode;
  art?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`relative flex cursor-pointer gap-4 rounded-lg border p-4 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${checked ? "border-primary bg-primary/[0.06]" : "bg-card hover:border-foreground/25"} ${className}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {art}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center justify-between gap-2 font-medium">
          {title}
          <span
            aria-hidden="true"
            className={`grid size-4 shrink-0 place-items-center rounded-full ${checked ? "bg-primary text-primary-foreground" : "ring-1 ring-border"}`}
          >
            {checked && <Check className="size-3" />}
          </span>
        </span>
        {children && (
          <span className="text-[13px] leading-snug text-pretty text-muted-foreground">
            {children}
          </span>
        )}
      </span>
    </label>
  );
}

function StartStep({
  origin,
  bots,
  onChoose,
}: {
  origin: string;
  bots: Bot[];
  onChoose: (id: string) => void;
}) {
  const copying = bots.some((b) => b.id === origin);
  return (
    <Guided
      good={[
        "Pick the template closest to the job and adapt it: it's faster than a blank page.",
        "Copy a bot that already works when you need a variant of it.",
      ]}
      bad={[
        "One bot for everything. Narrow specialists give sharper answers and are easier to fix.",
        "Keeping a template's text without adapting it to your context.",
      ]}
    >
      <div role="radiogroup" aria-label="Starting point" className="space-y-8">
        <Choice
          name="origin"
          value="blank"
          checked={origin === "blank"}
          onSelect={onChoose}
          art={<ArtTile icon={FilePlus2} tint="bg-muted text-muted-foreground" />}
          title="Start blank"
        >
          Write it yourself. The instructions step will guide you with a few questions.
        </Choice>
        <Group label="Or start from a template">
          <div className="grid gap-3 lg:grid-cols-2">
            {PERSONALITY_PRESETS.map((p) => (
              <Choice
                key={p.id}
                name="origin"
                value={p.id}
                checked={origin === p.id}
                onSelect={onChoose}
                title={p.label}
                art={TEMPLATE_ART[p.id] && <ArtTile {...TEMPLATE_ART[p.id]!} />}
              >
                {p.description}
                <span className="mt-3 block border-t pt-3 text-xs leading-relaxed text-muted-foreground/80">
                  <span className="line-clamp-2">“{extractActions(p.instructions)[0]}”</span>
                </span>
              </Choice>
            ))}
          </div>
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
    </Guided>
  );
}

function IdentityStep({
  draft,
  set,
  avatar,
  setAvatar,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  avatar: AvatarValue | null;
  setAvatar: (v: AvatarValue | null) => void;
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
        <BotAvatarPicker botId="new-bot" value={avatar} onChange={setAvatar} />
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

function EngineStep({ draft, set }: { draft: Draft; set: (p: Partial<Draft>) => void }) {
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
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
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

function InstructionsStep({
  draft,
  set,
  brief,
  setBrief,
  checks,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  brief: Brief;
  setBrief: (b: Brief) => void;
  checks: ReturnType<typeof reviewInstructions>;
}) {
  const [guided, setGuided] = useState(!draft.instructions.trim());
  const actions = useMemo(() => extractActions(draft.instructions), [draft.instructions]);
  const answered = Object.values(brief).some((v) => v.trim());
  function apply(mode: "replace" | "append") {
    const text = composeInstructions(brief);
    set({
      instructions:
        mode === "append" && draft.instructions.trim()
          ? `${draft.instructions.trim()}\n\n${text}`
          : text,
    });
    setGuided(false);
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6 text-sm">
        <section aria-label="Guided questions" className="rounded-lg border bg-card">
          <button
            type="button"
            aria-expanded={guided}
            onClick={() => setGuided((g) => !g)}
            className="flex w-full items-center justify-between gap-2 rounded-lg p-3.5 text-left font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              Draft it from 5 questions
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {guided ? "Hide" : "Show"}
            </span>
          </button>
          {guided && (
            <div className="space-y-3 border-t p-3.5">
              {QUESTIONS.map((q) => (
                <Textarea
                  key={q.key}
                  title={q.label}
                  required={false}
                  value={brief[q.key]}
                  rows={q.rows}
                  placeholder={q.placeholder}
                  onChange={(e) => setBrief({ ...brief, [q.key]: e.target.value })}
                />
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={!answered}
                  onClick={() => apply("replace")}
                >
                  {draft.instructions.trim() ? "Replace instructions" : "Draft instructions"}
                </Button>
                {draft.instructions.trim() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!answered}
                    onClick={() => apply("append")}
                  >
                    Add to current instructions
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
        <Textarea
          title="Personality"
          required={false}
          value={draft.personality}
          onChange={(e) => set({ personality: e.target.value })}
          rows={4}
          maxLength={4096}
          placeholder="You are a precise, friendly … who …"
        />
        <Textarea
          title="Instructions"
          required={false}
          value={draft.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          rows={16}
          maxLength={16384}
          placeholder="Start by … then … Answer with … Never …"
        />
      </div>
      <aside aria-label="Instruction review" className="space-y-8 self-start lg:sticky lg:top-8">
        <ReviewCard checks={checks} />
        <section aria-label="What it understood" className="text-sm">
          <h3 className="font-medium">What it understood</h3>
          <p className="mb-3 text-xs text-pretty text-muted-foreground">
            The actions read back from your instructions. If something is missing here, the bot
            won't know it either.
          </p>
          {actions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-muted-foreground marker:text-muted-foreground/60">
              {actions.map((a, i) => (
                <li key={i} className="text-pretty">
                  {a}
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function ReviewCard({ checks }: { checks: ReturnType<typeof reviewInstructions> }) {
  const score = reviewScore(checks);
  const tone = score >= 85 ? "bg-emerald-500" : score >= 55 ? "bg-amber-500" : "bg-destructive";
  return (
    <section aria-label="Quality checks" className="rounded-lg border bg-card p-4 text-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium">Instruction review</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {checks.filter((c) => c.ok).length}/{checks.length} good
        </span>
      </div>
      <div
        className="mb-4 h-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Instruction quality"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${tone}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            {c.ok ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-label="Good"
              />
            ) : (
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-label="Needs work"
              />
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

function ReviewStep({
  draft,
  checks,
  onEdit,
}: {
  draft: Draft;
  checks: ReturnType<typeof reviewInstructions>;
  onEdit: (step: number) => void;
}) {
  const idx = (id: (typeof STEPS)[number]["id"]) => STEPS.findIndex((s) => s.id === id);
  const missing = checks.filter((c) => !c.ok);
  const row = (label: string, value: ReactNode, step: number) => (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-start gap-3 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
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
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6 text-sm">
        <dl className="divide-y border-y">
          {row("Name", <span className="font-medium">{draft.name}</span>, idx("identity"))}
          {row(
            "Description",
            draft.description || <span className="text-muted-foreground">None</span>,
            idx("identity"),
          )}
          {row("Visibility", draft.visibility === "team" ? "Team" : "Private", idx("identity"))}
          {row(
            "Engine",
            `${draft.harness === "fixture" ? "Offline test" : draft.harness}${draft.model ? ` · ${draft.model}` : ""}`,
            idx("engine"),
          )}
          {row(
            "Personality",
            draft.personality ? (
              <span className="line-clamp-3 whitespace-pre-wrap">{draft.personality}</span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            ),
            idx("instructions"),
          )}
          {row(
            "Instructions",
            draft.instructions ? (
              <span className="line-clamp-6 whitespace-pre-wrap">{draft.instructions}</span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            ),
            idx("instructions"),
          )}
        </dl>
        {draft.harness === "fixture" && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            It runs on the offline test engine, so its replies will be canned. Switch the engine for
            real work.
          </p>
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

function PluginsStep({
  bot,
  bots,
  onBotChange,
  notify,
}: {
  bot: Bot;
  bots: Bot[];
  onBotChange: (b: Bot) => void;
  notify: (m: string) => void;
}) {
  const plugins = registeredBotSections().find((s) => s.id === "plugins");
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
  const extra = (title: string, why: string, body: ReactNode) => (
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
      <div className="pb-4">{body}</div>
    </details>
  );
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
        {computer &&
          extra(
            "Computer use",
            "Let it browse websites or drive a desktop session.",
            computer.render({ bot, bots, onBotChange, notify: () => {} }),
          )}
        {extra(
          "Hooks",
          "Rules that run on every message: add context, redact text, stop or run in the background.",
          <BotHooks bot={bot} />,
        )}
        {extra(
          "Routing",
          "Decide when this bot hands a message to another bot.",
          <BotDecision bot={bot} bots={bots} />,
        )}
      </div>
    </Guided>
  );
}

function DoneStep({
  bot,
  draft,
  checks,
}: {
  bot: Bot;
  draft: Draft;
  checks: ReturnType<typeof reviewInstructions>;
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
      <ol className="grid gap-x-8 divide-y border-y lg:grid-cols-3 lg:divide-y-0">
        {tips.map((t, i) => (
          <li key={t.title} className="flex gap-3 py-3">
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums ring-1 ring-border"
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
