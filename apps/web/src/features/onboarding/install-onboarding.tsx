import { ActionHint } from "@/components/action-hint";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeIcon,
  LaptopIcon,
} from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import z from "zod";

import { Button, Input, Progress } from "@/components/ui";
import { Logo } from "@/components/logo";
import { invalidateAuthGuard } from "@/lib/auth-guard";
import { getIdentityError, identityClient } from "@/lib/identity-client";
import { EngineStep, IdentityStep, InstructionsStep, type Draft } from "../bots/bot-onboarding";
import { LayaSwitch } from "../studio/laya-switch";
import { Plugins } from "../studio/plugins";
import type { PluginsSearch } from "../studio/plugins-filters";
import { reviewInstructions } from "../bots/instruction-review";
import { FRESH_INTERVIEW, type InterviewState } from "../bots/interview-flow";
import { call, chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { claudeApi } from "../claude/claude-api";
import { orgQueries } from "../org/org-api";
import { type AvatarValue } from "@/components/bot-avatar";
import { installationApi, installationQueries, type NetworkMode } from "./installation-api";
import { isOnboardingStep, PRE_ACCOUNT_STEPS, type OnboardingStep } from "./steps";

const STEPS: readonly { id: StepId; title: string; question: string; lede: string }[] = [
  {
    id: "key",
    title: "Server key",
    question: "Prove this is your server",
    lede: "Paste the setup key the server was started with. Only the person who runs the server has it.",
  },
  {
    id: "network",
    title: "Network",
    question: "Who can reach Zetta?",
    lede: "Start private. You can open Zetta to your network now, or later in the server settings.",
  },
  {
    id: "account",
    title: "Your account",
    question: "Create your account",
    lede: "You become the administrator of this installation.",
  },
  {
    id: "identity",
    title: "Chief",
    question: "Meet Zetta, the Chief.",
    lede: "Your Chief is your personal chief of staff. Give it a name and a face.",
  },
  {
    id: "engine",
    title: "Engine",
    question: "What runs your Chief?",
    lede: "The engine reads the instructions, calls tools and writes the answers.",
  },
  {
    id: "instructions",
    title: "Personality",
    question: "How should your Chief behave?",
    lede: "Personality is who it is. Instructions are what it does and how. Answer a few questions and we'll draft them.",
  },
  {
    id: "plugins",
    title: "Plugins",
    question: "Connect your tools (optional)",
    lede: "Plugins let your Chief search, read files, use calendars and more. Install what you need now, or skip and add them later in Studio.",
  },
] as const;
type StepId = OnboardingStep;
/** A person who joined an existing installation sets up only their own Chief and engine: the server-wide steps belong to the admin. */
const MEMBER_STEPS: readonly StepId[] = ["identity", "engine", "instructions"];

const STORE = "zetta.onboarding";
type Stored = { key: string; mode: NetworkMode; url: string };
// Only this tab's sessionStorage, so a refresh keeps the pre-account answers; it is cleared once the account exists.
/** The setup key in an address like `/onboarding#key=...` (the desktop app opens its own server that way), or "". */
export function keyFromHash(hash: string): string {
  const key = new URLSearchParams(hash.replace(/^#/, "")).get("key");
  return key?.trim() ?? "";
}
function readStored(): Stored {
  const fromHash = typeof window === "undefined" ? "" : keyFromHash(window.location.hash);
  if (fromHash) {
    // Taken from the address once, then kept for this tab only; the address no longer shows it.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const stored: Stored = { key: fromHash, mode: "local", url: "" };
    try {
      sessionStorage.setItem(STORE, JSON.stringify(stored));
    } catch {}
    return stored;
  }
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
    if (raw && typeof raw === "object") {
      const { key, mode, url } = raw as Record<string, unknown>;
      return {
        key: typeof key === "string" ? key : "",
        mode: mode === "network" ? "network" : "local",
        url: typeof url === "string" ? url : "",
      };
    }
  } catch {}
  return { key: "", mode: "local", url: "" };
}
// Opened at its network address (after `bun run setup --mode lan`): that address is the one other devices use.
function networkOrigin(): string {
  const { protocol, hostname, origin } = window.location;
  return protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? origin
    : "";
}
function writeStored(value: Stored | null) {
  try {
    if (value) sessionStorage.setItem(STORE, JSON.stringify(value));
    else sessionStorage.removeItem(STORE);
  } catch {}
}

const accountSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    email: z.email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

const draftOf = (b: Bot): Draft => ({
  name: b.name,
  description: b.description,
  role: b.role ?? "",
  harness: b.harness,
  model: b.model ?? "",
  personality: b.personality,
  instructions: b.instructions,
  outputStyle: b.outputStyle ?? "default",
  outputStyleId: b.outputStyleId ?? null,
  visibility: "private",
});

export function InstallOnboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [requested] = useState(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    return isOnboardingStep(step) ? step : undefined;
  });
  const [step, setStep] = useState<StepId | null>(null);
  const [member, setMember] = useState(false);
  // A person who joined a company that drew its chart picks their Chief's role from the chart's own titles.
  const orgView = useQuery({ ...orgQueries.get(), enabled: member }).data;
  const roleChoices = useMemo(
    () => [...new Set((orgView?.positions ?? []).map((p) => p.title.trim()).filter(Boolean))],
    [orgView],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A setup step, not a page of its own: the plugin filters stay in this state, not in the address.
  const [pluginsSearch, setPluginsSearch] = useState<PluginsSearch>({});
  const [notice, setNotice] = useState<string>();

  // The key is sent with the first sign-up and dropped afterwards.
  const [stored] = useState(readStored);
  const [setupKey, setSetupKey] = useState(stored.key);
  const [showKey, setShowKey] = useState(false);
  const [mode, setMode] = useState<NetworkMode>(stored.mode);
  const [publicUrl, setPublicUrl] = useState(() => stored.url || networkOrigin());
  const [account, setAccount] = useState({ name: "", email: "", password: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [chief, setChief] = useState<Bot>();
  /** Claude Code's reasoning effort for the Chief; empty = its default. Saved with the Chief, which is the first moment it exists. */
  const [effort, setEffort] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [avatar, setAvatar] = useState<AvatarValue | null>(null);
  const [interview, setInterview] = useState<InterviewState>(FRESH_INTERVIEW);
  const checks = useMemo(
    () => reviewInstructions(draft?.personality ?? "", draft?.instructions ?? ""),
    [draft?.personality, draft?.instructions],
  );

  // The step lives in the URL (?step=) so a refresh resumes here.
  const show = (to: StepId) => {
    setStep(to);
    void navigate({ to: "/onboarding", search: { step: to }, replace: true });
  };

  useEffect(() => {
    if (setupKey) writeStored({ key: setupKey, mode, url: publicUrl });
    else writeStored(null);
  }, [setupKey, mode, publicUrl]);

  async function loadChief(): Promise<Bot> {
    // Fresh on purpose: the Chief was just created, so a cached list may not hold it.
    const all = await qc.fetchQuery({ ...chatQueries.bots(), staleTime: 0 });
    const found = all.find((b) => b.kind === "chief");
    if (!found) throw new Error("Your Chief could not be created. Reload and try again.");
    setChief(found);
    setDraft(draftOf(found));
    setAvatar(found.avatar ?? null);
    return found;
  }

  // Resume where the person left off: no admin yet starts at the key; an admin with unfinished onboarding resumes at the Chief.
  useEffect(() => {
    let alive = true;
    (async () => {
      const status = await identityClient.status();
      if (status.state === "active") {
        const installation = await qc.fetchQuery({ ...installationQueries.get(), staleTime: 0 });
        if (!status.isAdmin) {
          const { preferences } = await call<{ preferences: { memberOnboarding?: string } }>(
            "/api/preferences",
          );
          if (preferences.memberOnboarding !== "pending")
            return void navigate({ to: "/chat/{-$chatId}", replace: true });
          await loadChief();
          if (alive) {
            setMember(true);
            show(requested && MEMBER_STEPS.includes(requested) ? requested : "identity");
          }
          return;
        }
        if (installation.onboarding === "done")
          return void navigate({ to: "/chat/{-$chatId}", replace: true });
        await loadChief();
        if (alive)
          show(requested && !PRE_ACCOUNT_STEPS.includes(requested) ? requested : "identity");
        return;
      }
      const setup = await identityClient.setup();
      if (!setup.required) return void navigate({ to: "/login", replace: true });
      // Without the key (a closed tab) the later pre-account steps cannot continue, so restart at the key.
      if (alive)
        show(
          requested && PRE_ACCOUNT_STEPS.includes(requested) && (requested === "key" || stored.key)
            ? requested
            : "key",
        );
    })().catch((e: unknown) => {
      if (alive) {
        setError(getIdentityError(e));
        setStep("key");
      }
    });
    return () => {
      alive = false;
    };
  }, [navigate]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error && "code" in e ? getIdentityError(e) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const go = (to: StepId) => {
    setError(undefined);
    show(to);
  };

  const submitKey = () =>
    run(async () => {
      await identityClient.verifySetupKey(setupKey.trim());
      go("network");
    });

  const networkError =
    mode === "network" && !/^https:\/\/[^\s/]+/.test(publicUrl.trim())
      ? "Enter the https address people will use, for example https://zetta.example.com"
      : undefined;

  const submitAccount = () =>
    run(async () => {
      const parsed = accountSchema.safeParse(account);
      if (!parsed.success) {
        setFieldErrors(
          Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
        );
        return;
      }
      setFieldErrors({});
      await identityClient.signUp({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        setupKey: setupKey.trim(),
      });
      setSetupKey("");
      setAccount((a) => ({ ...a, password: "", confirm: "" }));
      const saved = await installationApi.patch({
        networkMode: mode,
        publicUrl: mode === "network" ? publicUrl.trim() : null,
      });
      if (saved.restartRequired)
        setNotice("Restart the Zetta server to apply your network choice.");
      await loadChief();
      go("identity");
    });

  const patchDraft = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const saveChief = () =>
    run(async () => {
      if (!chief || !draft) return;
      const saved = await chatClient.updateBot(chief.id, chief.version, {
        avatar,
        name: draft.name.trim(),
        description: draft.description,
        role: (draft.role ?? "").trim(),
        harness: draft.harness,
        model: draft.model.trim() || null,
        personality: draft.personality,
        instructions: draft.instructions,
        outputStyle: draft.outputStyle,
        outputStyleId: draft.outputStyleId,
      });
      setChief(saved);
      if (draft.harness === "claude-code") {
        const current = await claudeApi.get(saved.id);
        if ((current.config.effort ?? "") !== effort)
          await claudeApi.save(saved.id, { ...current.config, effort: effort || null });
      }
      void qc.invalidateQueries({ queryKey: chatQueries.bots().queryKey, exact: true });
      if (member) await finishMember(saved);
      else go("plugins");
    });

  // The account's own setup is done: remember it so the guard stops sending this person here, then open the Chief.
  async function finishMember(bot: Bot) {
    await call("/api/preferences", "PATCH", { memberOnboarding: "done" });
    invalidateAuthGuard();
    await qc.invalidateQueries({ queryKey: ["preferences"] });
    await navigate({ to: "/chat/{-$chatId}", search: { bot: bot.id } });
  }

  const finish = () =>
    run(async () => {
      await installationApi.patch({ onboarding: "done" });
      // A new installation starts with the simple sidebar; Preferences > Display shows everything.
      await call("/api/preferences", "PATCH", {
        navMode: "simple",
        memberOnboarding: "done",
      }).catch(() => undefined);
      await navigate({ to: "/chat/{-$chatId}", search: chief ? { bot: chief.id } : {} });
    });

  if (step === null) {
    return (
      <section className="mx-auto mt-16 max-w-md space-y-4 p-8" aria-busy>
        <div className="flex justify-center">
          <Logo size={72} />
        </div>
        <p role="status" className="text-center text-muted-foreground">
          Checking your installation…
        </p>
        {error && <Alert theme="danger">{error}</Alert>}
      </section>
    );
  }

  const list = member ? STEPS.filter((s) => MEMBER_STEPS.includes(s.id)) : STEPS;
  const index = list.findIndex((s) => s.id === step);
  const current = list[index]!;
  const afterAccount = !PRE_ACCOUNT_STEPS.includes(step);
  const firstAfterAccount = list.findIndex((s) => !PRE_ACCOUNT_STEPS.includes(s.id));
  const wide = afterAccount;
  const nameMissing = !draft?.name.trim();

  return (
    <div
      className="mx-auto w-full px-4 pb-16 pt-10 md:pt-16"
      style={{ maxWidth: wide ? "56rem" : "34rem" }}
    >
      <header className="space-y-3">
        <Logo size={56} />
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{current.title}</span>
          <span className="tabular-nums">
            {index + 1} of {list.length}
          </span>
        </div>
        <Progress label="Onboarding progress" min={1} max={list.length} value={index + 1} />
        <h1
          key={step}
          autoFocus
          tabIndex={-1}
          className="pt-4 text-2xl font-semibold tracking-tight text-balance outline-none"
        >
          {current.question}
        </h1>
        <p className="max-w-[64ch] text-pretty text-muted-foreground">{current.lede}</p>
      </header>

      <div className="mt-8 space-y-4">
        {notice && (
          <Alert theme="success" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        )}
        {error && <Alert theme="danger">{error}</Alert>}

        {step === "key" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitKey();
            }}
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  title="Connection key"
                  name="connection-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={setupKey}
                  onChange={(e) => setSetupKey(e.target.value)}
                />
              </div>
              <ActionHint label={showKey ? "Hide key" : "Show key"}>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={showKey ? "Hide key" : "Show key"}
                  aria-pressed={showKey}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeSlashIcon /> : <EyeIcon />}
                </Button>
              </ActionHint>
            </div>
            <p className="text-sm text-muted-foreground">
              It is the value of <code className="font-mono">ZETTA_SETUP_KEY</code> in the server's
              environment (or <code className="font-mono">ZETTA_CONNECTION_KEY</code> when no setup
              key is set). Don't have one? Run <code className="font-mono">bun run setup</code> to
              create it, or use <code className="font-mono">openssl rand -base64 32</code>, set it,
              and restart the server.
            </p>
            <Nav>
              <Button type="submit" disabled={busy || !setupKey.trim()}>
                {busy ? "Checking…" : "Continue"}
                <ArrowRightIcon />
              </Button>
            </Nav>
          </form>
        )}

        {step === "network" && (
          <div className="space-y-4">
            <div
              role="radiogroup"
              aria-label="Who can reach Zetta"
              className="grid gap-3 sm:grid-cols-2"
            >
              <ModeCard
                active={mode === "local"}
                icon={<LaptopIcon className="size-5" />}
                title="Only this computer"
                body="Zetta listens on this machine only. The safest start."
                onSelect={() => setMode("local")}
              />
              <ModeCard
                active={mode === "network"}
                icon={<GlobeIcon className="size-5" />}
                title="Open to my network"
                body="Your phone and teammates can reach Zetta at an address you choose."
                onSelect={() => setMode("network")}
              />
            </div>
            {mode === "network" && (
              <div className="space-y-2">
                <Input
                  title="Public address"
                  name="public-url"
                  type="url"
                  placeholder="https://zetta.example.com"
                  value={publicUrl}
                  error={publicUrl && networkError ? networkError : undefined}
                  onChange={(e) => setPublicUrl(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  On your local network, run <code className="font-mono">bun run setup</code> on the
                  server, choose <code className="font-mono">lan</code>, restart, and open the
                  address it prints. Otherwise enter an https address, such as one from a private
                  network like Tailscale. The server needs a restart to open up.
                </p>
              </div>
            )}
            <Nav back={() => go("key")}>
              <Button
                type="button"
                disabled={mode === "network" && Boolean(networkError)}
                onClick={() => go("account")}
              >
                Continue
                <ArrowRightIcon />
              </Button>
            </Nav>
          </div>
        )}

        {step === "account" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAccount();
            }}
          >
            <fieldset disabled={busy} className="space-y-4" aria-busy={busy}>
              <Input
                title="Your name"
                name="name"
                autoComplete="name"
                required
                value={account.name}
                error={fieldErrors.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
              />
              <Input
                title="Your email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={account.email}
                error={fieldErrors.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
              />
              <Input
                title="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={account.password}
                error={fieldErrors.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
              />
              <Input
                title="Confirm password"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={account.confirm}
                error={fieldErrors.confirm}
                onChange={(e) => setAccount({ ...account, confirm: e.target.value })}
              />
            </fieldset>
            <Nav back={() => go("network")}>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create account"}
                <ArrowRightIcon />
              </Button>
            </Nav>
          </form>
        )}

        {draft && step === "identity" && (
          <IdentityStep
            draft={draft}
            set={patchDraft}
            avatar={avatar}
            setAvatar={setAvatar}
            kind="chief"
            roleChoices={roleChoices}
          />
        )}
        {draft && step === "engine" && (
          <EngineStep draft={draft} set={patchDraft} effort={effort} setEffort={setEffort} />
        )}
        {draft && step === "instructions" && (
          <InstructionsStep
            draft={draft}
            set={patchDraft}
            avatar={avatar}
            interview={interview}
            setInterview={setInterview}
            checks={checks}
          />
        )}
        {step === "plugins" && (
          <div className="space-y-4">
            <LayaSwitch onError={setError} submitLabel="Turn on Laya" />
            <Plugins
              onError={setError}
              search={pluginsSearch}
              setSearch={(next) => setPluginsSearch(next)}
            />
          </div>
        )}

        {afterAccount && (
          <Nav back={index > firstAfterAccount ? () => go(list[index - 1]!.id) : undefined}>
            {step === "identity" && (
              <Button type="button" disabled={nameMissing} onClick={() => go("engine")}>
                Continue
                <ArrowRightIcon />
              </Button>
            )}
            {step === "engine" && (
              <Button type="button" onClick={() => go("instructions")}>
                Continue
                <ArrowRightIcon />
              </Button>
            )}
            {step === "instructions" && (
              <Button type="button" disabled={busy || nameMissing} onClick={() => void saveChief()}>
                {busy ? "Saving…" : member ? "Save and start chatting" : "Save my Chief"}
                <ArrowRightIcon />
              </Button>
            )}
            {step === "plugins" && (
              <Button type="button" disabled={busy} onClick={() => void finish()}>
                {busy ? "Finishing…" : "Start chatting"}
                <ArrowRightIcon />
              </Button>
            )}
          </Nav>
        )}
      </div>
    </div>
  );
}

function Nav({ back, children }: { back?: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      {back ? (
        <Button type="button" variant="ghost" onClick={back}>
          <ArrowLeftIcon />
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  body,
  onSelect,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={`flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30"}`}
    >
      {icon}
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground">{body}</span>
    </button>
  );
}
