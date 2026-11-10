import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/lib/notify";

import { BotAvatar } from "@/components/bot-avatar";
import { Button, Input, Modal, Select } from "@/components/ui";
import { Empty, Loading, Panel } from "../shared/ui";
import {
  DEFAULT_CHOICE,
  OutputStylePicker,
  type StyleChoice,
} from "../output-styles/output-style-picker";

import { BotAvatarPicker } from "./bot-avatar-picker";
import { BotAccounts } from "./bot-accounts";
import { BotApprovalRules } from "./bot-approval-rules";
import { BotRoutines } from "./bot-routines";
import { BotOriginSection } from "../bots/bot-origin";
import { BotDecision } from "./bot-decision";
import { BotHooks } from "./bot-hooks";
import { harnessOptions, isAllowedModel, modelOptions } from "./bot-presets";
import { registeredBotSections } from "./bot-sections";
import "../claude/register"; // per-bot Claude Code permissions, skills and sub-agents
import "../code/register";
import "../computer/register";
import "../discussions/register";
import "../inbound/register";
import "../plugins/register";
import "../teams/register"; // the teams a bot belongs to and leads
import {
  chatClient,
  errorMessage,
  type Bot,
  type BotAvatarValue,
  type BotPatch,
  type Folder,
} from "./chat-client";
import { MentionTextarea } from "./mention";
import { useSidebarData } from "./sidebar-data";

const UNGROUPED = "__ungrouped";

type Common = {
  bot: Bot;
  bots: Bot[];
  spaces: Folder[];
  onBotChange: (b: Bot) => void;
  notify: (m: string) => void;
};

/** Saves a subset of fields; each section owns its own form, so saving one never touches another section's draft. */
function useSave(bot: Bot, onBotChange: (b: Bot) => void, notify: (m: string) => void) {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function save(patch: BotPatch) {
    setError(undefined);
    setSaving(true);
    try {
      onBotChange(await chatClient.updateBot(bot.id, bot.version, patch));
      notify("Saved. Chat with the bot again to confirm it is ready.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return { error, setError, saving, save };
}

const saveRow = "flex flex-wrap items-center justify-end gap-3 border-t pt-4";
const Failure = ({ error }: { error?: string | undefined }) =>
  error ? (
    <p role="alert" className="mr-auto text-xs text-destructive">
      {error}
    </p>
  ) : null;

function GeneralForm({ bot, spaces, onBotChange, notify }: Common) {
  const { error, setError, saving, save } = useSave(bot, onBotChange, notify);
  const [harness, setHarness] = useState(bot.harness);
  const [model, setModel] = useState(bot.model ?? "");
  const [fallback, setFallback] = useState(bot.fallbackHarness ?? "");
  const [fallbackModel, setFallbackModel] = useState(bot.fallbackModel ?? "");
  useEffect(() => {
    setHarness(bot.harness);
    setModel(bot.model ?? "");
    setFallback(bot.fallbackHarness ?? "");
    setFallbackModel(bot.fallbackModel ?? "");
  }, [bot.id, bot.version]);
  // A bot with no AI (decision) or no provider (fixture) has no limit to run into.
  const canFallBack = harness !== "fixture" && harness !== "decision";
  const fallbackChoices = harnessOptions.filter(
    (o) => o.value !== "fixture" && o.value !== "decision" && o.value !== harness,
  );
  const fallbackModels = modelOptions(
    fallback,
    bot.fallbackHarness === fallback ? bot.fallbackModel : null,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save({
      name: String(data.get("name") ?? "").trim() || bot.name,
      description: String(data.get("description") ?? ""),
      harness: String(data.get("harness") ?? "fixture"),
      model: String(data.get("model") ?? "").trim() || null,
      fallbackHarness: canFallBack ? String(data.get("fallbackHarness") ?? "") || null : null,
      fallbackModel: canFallBack ? String(data.get("fallbackModel") ?? "").trim() || null : null,
    });
  }
  return (
    <div className="space-y-5">
      <form
        key={`${bot.id}-${bot.version}`}
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        <Input title="Name" name="name" defaultValue={bot.name} maxLength={80} required />
        <Select
          title="Harness"
          required={false}
          name="harness"
          value={harness}
          onChange={(e) => {
            setHarness(e.target.value);
            if (!isAllowedModel(e.target.value, model)) setModel("");
            if (e.target.value === fallback) {
              setFallback("");
              setFallbackModel("");
            }
          }}
          options={harnessOptions}
        />
        <Input
          title="Description"
          container="md:col-span-2"
          name="description"
          defaultValue={bot.description}
          maxLength={2048}
          placeholder="What is this bot good at?"
        />
        {harness === "decision" && (
          <p className="text-xs text-muted-foreground md:col-span-2">
            This bot has no AI. Its answers come only from the options in Decision routing below.
          </p>
        )}
        {harness !== "fixture" && (
          <Select
            title="Model"
            container="md:col-span-2"
            required={false}
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={modelOptions(harness, bot.harness === harness ? bot.model : null)}
          />
        )}
        {canFallBack && (
          <>
            <Select
              title="Fallback harness"
              required={false}
              name="fallbackHarness"
              value={fallback}
              onChange={(e) => {
                setFallback(e.target.value);
                setFallbackModel("");
              }}
              options={[{ value: "", label: "None" }, ...fallbackChoices]}
            />
            {fallback && fallbackModels.length > 1 ? (
              <Select
                title="Fallback model"
                required={false}
                name="fallbackModel"
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                options={fallbackModels}
              />
            ) : (
              <span aria-hidden="true" />
            )}
            <p className="text-xs text-muted-foreground md:col-span-2">
              Used for a turn when the main harness reaches its usage limit, is not signed in, or is
              not installed. The next turn tries the main harness again.
            </p>
          </>
        )}
        <div className={`${saveRow} md:col-span-2`}>
          <Failure error={error} />
          <Button type="submit" size="sm" disabled={saving}>
            Save general settings
          </Button>
        </div>
      </form>
      {spaces.length > 0 && (
        <Select
          title="Folder"
          required={false}
          value={bot.folderId ?? UNGROUPED}
          onChange={(e) =>
            void chatClient
              .moveBot(bot.id, e.target.value === UNGROUPED ? null : e.target.value)
              .then(
                (b) => onBotChange({ ...bot, folderId: b.folderId }),
                (x) => setError(errorMessage(x)),
              )
          }
          options={[
            { value: UNGROUPED, label: "Ungrouped" },
            ...spaces.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      )}
    </div>
  );
}

function AvatarForm({ bot, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  const [draft, setDraft] = useState<BotAvatarValue | null>(bot.avatar ?? null);
  return (
    <div className="space-y-4">
      <BotAvatarPicker botId={bot.id} kind={bot.kind} value={draft} onChange={setDraft} />
      <div className={saveRow}>
        <Failure error={error} />
        <Button
          type="button"
          size="sm"
          disabled={saving || JSON.stringify(draft) === JSON.stringify(bot.avatar ?? null)}
          onClick={() => void save({ avatar: draft })}
        >
          Save picture
        </Button>
      </div>
    </div>
  );
}

function PersonalityForm({ bot, bots, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save({
      personality: String(data.get("personality") ?? ""),
      instructions: String(data.get("instructions") ?? ""),
    });
  }
  return (
    <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-4">
      <MentionTextarea
        title="Personality"
        name="personality"
        bots={bots}
        defaultValue={bot.personality}
        rows={5}
        maxLength={4096}
      />
      <MentionTextarea
        title="Instructions"
        name="instructions"
        bots={bots}
        defaultValue={bot.instructions}
        rows={12}
        maxLength={16384}
      />
      <div className={saveRow}>
        <Failure error={error} />
        <Button type="submit" size="sm" disabled={saving}>
          Save personality
        </Button>
      </div>
    </form>
  );
}

const LEARN_OPTIONS = [
  { value: "auto", label: "Save what it learns as its own skills" },
  { value: "suggest", label: "Suggest skills; I save them" },
  { value: "off", label: "Off" },
];

/** Autolearn: after a correction or a method that worked, the bot keeps the lesson as a skill of its own. */
function LearningForm({ bot, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  const saved = bot.autoLearn ?? "auto";
  const [mode, setMode] = useState(saved);
  const canLoad = bot.harness === "claude-code" || bot.harness === "hermes";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ autoLearn: mode });
  }
  return (
    <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-4">
      <Select
        title="Learning"
        name="autoLearn"
        required={false}
        value={mode}
        onChange={(e) => setMode(e.target.value as typeof mode)}
        options={LEARN_OPTIONS}
      />
      <p className="text-xs text-muted-foreground">
        {canLoad
          ? "When you correct the bot, or it finishes a long piece of work, it may save the lesson as a skill of its own. The chat shows each one with View and Undo. It never changes skills you wrote or installed, or one you edited."
          : "This bot's engine cannot load skills, so it does not learn any. Claude Code and Hermes bots can."}
      </p>
      <div className={saveRow}>
        <Failure error={error} />
        <Button type="submit" size="sm" disabled={saving || mode === saved}>
          Save learning
        </Button>
      </div>
    </form>
  );
}

function OutputStyleForm({ bot, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  const saved: StyleChoice = {
    outputStyle: bot.outputStyle ?? DEFAULT_CHOICE.outputStyle,
    outputStyleId: bot.outputStyleId ?? null,
  };
  const [choice, setChoice] = useState<StyleChoice>(saved);
  const unchanged =
    choice.outputStyle === saved.outputStyle && choice.outputStyleId === saved.outputStyleId;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(choice);
  }
  return (
    <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-4">
      <OutputStylePicker name={`output-style-${bot.id}`} value={choice} onChange={setChoice} />
      <div className={saveRow}>
        <Failure error={error} />
        <Button type="submit" size="sm" disabled={saving || unchanged}>
          Save output style
        </Button>
      </div>
    </form>
  );
}

function DeleteForm({ bot, setBots }: { bot: Bot; setBots: (f: (l: Bot[]) => Bot[]) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function remove() {
    const confirmed = await Modal.confirm<boolean>({
      title: `Delete ${bot.name}?`,
      description:
        "It loses its plugins, accounts, computer access, inbound channels, routines and team places, and all its running work stops. Its chats stay.",
      confirm: { text: "Delete bot", theme: "danger" },
    });
    if (!confirmed) return;
    setError(undefined);
    setBusy(true);
    try {
      await chatClient.deleteBot(bot.id);
      setBots((list) => list.filter((b) => b.id !== bot.id));
      toast.success(`${bot.name} was deleted.`);
      void navigate({ to: "/chat/{-$chatId}", params: { chatId: undefined }, search: {} });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className={saveRow}>
      <Failure error={error} />
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => void remove()}
      >
        Delete bot
      </Button>
    </div>
  );
}

type Entry = {
  id: string;
  title: string;
  description?: string;
  /** Renders its own card, so the page adds no panel around it. */
  bare?: boolean;
  node: ReactNode;
};

/** Order and grouping of the page. A registered section missing here lands in "More", so a new one still shows up. */
/** The bot page's tabs (the `tab` search param), each a set of sections. A section not listed here shows under Setup. */
export const BOT_TABS = [
  {
    id: "setup",
    label: "Setup",
    ids: [
      "general",
      "picture",
      "personality",
      "output-style",
      "origin",
      "teams",
      "peers",
      "delete",
    ],
  },
  { id: "skills", label: "Skills and learning", ids: ["claude", "learning", "hooks", "decision"] },
  { id: "plugins", label: "Plugins", ids: ["plugins", "accounts", "inbound", "database"] },
  { id: "routines", label: "Routines", ids: ["routines"] },
  { id: "computer", label: "Computer", ids: ["code", "computer"] },
  { id: "approvals", label: "Approvals", ids: ["approvals"] },
] as const;
export type BotTab = (typeof BOT_TABS)[number]["id"];
export const parseBotTab = (v: unknown): BotTab | undefined =>
  BOT_TABS.some((t) => t.id === v && t.id !== "setup") ? (v as BotTab) : undefined;
const GROUPS: { label: string; ids: readonly string[] }[] = BOT_TABS.map((t) => ({
  label: t.label,
  ids: t.ids,
}));

function useActiveSection(root: React.RefObject<HTMLElement | null>, ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items)
          if (item.isIntersecting) visible.add(item.target.id);
          else visible.delete(item.target.id);
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { root: root.current, rootMargin: "-10% 0px -70% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);
  return [active, setActive] as const;
}

function SettingsBody({
  bot,
  bots,
  spaces,
  onBotChange,
  notify,
  setBots,
  tab,
  onTab,
}: Common & {
  setBots: (f: (l: Bot[]) => Bot[]) => void;
  tab: BotTab;
  onTab: (t: BotTab) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const common = { bot, bots, spaces, onBotChange, notify };
  const entries: Entry[] = [
    {
      id: "general",
      title: "General",
      description: "Name, engine and where the bot lives.",
      node: <GeneralForm {...common} />,
    },
    {
      id: "picture",
      title: "Picture",
      description: "How the bot looks in the sidebar and in chats.",
      node: <AvatarForm key={`${bot.id}-${bot.version}`} {...common} />,
    },
    {
      id: "personality",
      title: "Personality",
      description: "Who the bot is and the standing instructions it follows in every chat.",
      node: <PersonalityForm {...common} />,
    },
    {
      id: "output-style",
      title: "Output style",
      description: "How the bot writes: its tone of voice and the shape of its answers.",
      node: <OutputStyleForm key={`${bot.id}-${bot.version}`} {...common} />,
    },
    ...(bot.origin
      ? [
          {
            id: "origin",
            title: "Where it came from",
            description: "Who made this bot, and the apps it was built to use.",
            node: <BotOriginSection origin={bot.origin} />,
          },
        ]
      : []),
    {
      id: "accounts",
      title: "Accounts",
      bare: true,
      node: <BotAccounts bot={bot} onBotChange={onBotChange} />,
    },
    { id: "hooks", title: "Hooks", bare: true, node: <BotHooks bot={bot} /> },
    {
      id: "learning",
      title: "Learning",
      description: "Lessons the bot keeps as its own skills.",
      node: (
        <LearningForm
          bot={bot}
          bots={bots}
          spaces={spaces}
          onBotChange={onBotChange}
          notify={notify}
        />
      ),
    },
    {
      id: "routines",
      title: "Routines",
      description: "The scheduled work this bot does for you.",
      node: <BotRoutines bot={bot} />,
    },
    {
      id: "approvals",
      title: "Always allowed",
      description:
        "Changes this bot makes without asking, because you chose “Always allow” on a card.",
      node: <BotApprovalRules bot={bot} notify={notify} />,
    },
    {
      id: "decision",
      title: "Decision routing",
      bare: true,
      node: <BotDecision bot={bot} bots={bots} />,
    },
    ...(bot.kind === "specialist"
      ? [
          {
            id: "delete",
            title: "Delete bot",
            description:
              "Removes the bot from your lists and detaches everything it could use. Its chats stay.",
            node: <DeleteForm bot={bot} setBots={setBots} />,
          },
        ]
      : []),
    ...registeredBotSections().map((s) => ({
      id: s.id,
      title: s.title,
      node: s.render({ bot, bots, onBotChange, notify }),
    })),
  ];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const grouped = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = GROUPS.map((g) => ({
    label: g.label,
    items: g.ids.flatMap((id) => byId.get(id) ?? []),
  })).filter((g) => g.items.length > 0);
  // Sections no tab names (a new registered one) show under Setup.
  const extra = entries.filter((e) => !grouped.has(e.id));
  if (extra.length && groups[0])
    groups[0] = { ...groups[0], items: [...groups[0].items, ...extra] };
  const current = BOT_TABS.find((t) => t.id === tab) ?? BOT_TABS[0];
  const shown = groups.filter((g) => g.label === current.label);
  const ids = shown.flatMap((g) => g.items.map((e) => e.id));
  const [active, setActive] = useActiveSection(scroller, ids);
  const jump = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    setActive(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-5 p-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 md:p-8">
        <nav
          aria-label="Settings sections"
          className="sticky top-0 z-10 -mx-4 -mt-4 bg-background px-4 py-2 md:top-8 md:z-auto md:m-0 md:self-start md:p-0"
        >
          <Link
            to="/chat/{-$chatId}"
            params={{ chatId: undefined }}
            search={{ bot: bot.id }}
            className="mb-3 hidden items-center gap-1 px-3 text-sm text-muted-foreground hover:text-foreground md:inline-flex"
          >
            <ArrowLeftIcon aria-hidden className="size-4" /> Back to chat
          </Link>
          <div
            role="tablist"
            aria-label="Bot settings"
            className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:flex-col md:overflow-visible"
          >
            {BOT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === current.id}
                onClick={() => onTab(t.id)}
                className={`flex shrink-0 touch-manipulation items-center whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${t.id === current.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-3 hidden gap-1 md:block md:space-y-0.5">
            {shown.map((g) => (
              <div key={g.label}>
                {g.items.map((e) => (
                  <a
                    key={e.id}
                    href={`#${e.id}`}
                    onClick={jump(e.id)}
                    aria-current={active === e.id ? "true" : undefined}
                    className={`relative flex shrink-0 touch-manipulation items-center whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active === e.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {e.title}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-8">
          <header className="space-y-3 border-b pb-5">
            <Link
              to="/chat/{-$chatId}"
              params={{ chatId: undefined }}
              search={{ bot: bot.id }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ArrowLeftIcon aria-hidden className="size-4" /> Back to chat
            </Link>
            <div className="flex items-start gap-3">
              <BotAvatar bot={bot} size={40} />
              <div className="min-w-0">
                <h1 className="text-2xl text-balance">{bot.name} settings</h1>
                <p className="text-sm text-pretty text-muted-foreground">
                  {[
                    bot.kind === "chief" ? "Chief" : "Specialist",
                    bot.harness === "fixture"
                      ? "offline test"
                      : `${bot.harness}${bot.model ? ` · ${bot.model}` : ""}`,
                    bot.description,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
          </header>
          {shown.map((g) => (
            <div key={g.label} className="space-y-4" role="tabpanel" aria-label={g.label}>
              <h2 className="label-mono">{g.label}</h2>
              {g.items.map((e) => (
                <div key={e.id} id={e.id} className="scroll-mt-16 md:scroll-mt-8">
                  {e.bare ? (
                    e.node
                  ) : (
                    <Panel
                      title={e.title}
                      {...(e.description ? { description: e.description } : {})}
                    >
                      {e.node}
                    </Panel>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full page for one bot's settings. Non-owners only see the accounts they need to connect. */
export function BotSettingsPage({
  botId,
  tab = "setup",
  onTab = () => {},
}: {
  botId: string;
  tab?: BotTab;
  onTab?: (t: BotTab) => void;
}) {
  const { bots, setBots, spaces } = useSidebarData();
  const bot = bots.find((b) => b.id === botId);
  const onBotChange = (next: Bot) =>
    setBots((list) =>
      list.map((b) => (b.id === next.id ? { ...b, ...next, canEdit: b.canEdit } : b)),
    );
  const notify = (m: string) => toast.success(m);
  if (bots.length === 0)
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <Loading />
      </div>
    );
  if (!bot)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <Empty>This bot does not exist or you cannot see it.</Empty>
        <Link
          to="/chat/{-$chatId}"
          params={{ chatId: undefined }}
          search={{}}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" /> Back to chat
        </Link>
      </div>
    );
  if (!bot.canEdit)
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
        <Link
          to="/chat/{-$chatId}"
          params={{ chatId: undefined }}
          search={{ bot: bot.id }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" /> Back to chat
        </Link>
        <h1 className="text-2xl text-balance">Accounts for {bot.name}</h1>
        <BotAccounts bot={bot} onBotChange={onBotChange} />
      </div>
    );
  return (
    <SettingsBody
      tab={tab}
      onTab={onTab}
      bot={bot}
      bots={bots}
      spaces={spaces}
      onBotChange={onBotChange}
      notify={notify}
      setBots={setBots}
    />
  );
}
