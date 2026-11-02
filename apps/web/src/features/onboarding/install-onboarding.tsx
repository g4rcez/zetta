import { useEffect, useMemo, useState, type ReactNode } from "react";
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

import { Button, Input } from "@/components/ui";
import { Logo } from "@/components/logo";
import { getIdentityError, identityClient } from "@/lib/identity-client";
import { EngineStep, IdentityStep, InstructionsStep, type Draft } from "../bots/bot-onboarding";
import { LayaSwitch } from "../studio/laya-switch";
import { Plugins } from "../studio/plugins";
import { reviewInstructions } from "../bots/instruction-review";
import { FRESH_INTERVIEW, type InterviewState } from "../bots/interview-flow";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { type AvatarValue } from "@/components/bot-avatar";
import { installationApi, type NetworkMode } from "./installation-api";
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
    question: "Meet your Chief",
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

const STORE = "zetta.onboarding";
type Stored = { key: string; mode: NetworkMode; url: string };
// Only this tab's sessionStorage, so a refresh keeps the pre-account answers; it is cleared once the account exists.
function readStored(): Stored {
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
  const [requested] = useState(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    return isOnboardingStep(step) ? step : undefined;
  });
  const [step, setStep] = useState<StepId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // The key is sent with the first sign-up and dropped afterwards.
  const [stored] = useState(readStored);
  const [setupKey, setSetupKey] = useState(stored.key);
  const [showKey, setShowKey] = useState(false);
  const [mode, setMode] = useState<NetworkMode>(stored.mode);
  const [publicUrl, setPublicUrl] = useState(stored.url);
  const [account, setAccount] = useState({ name: "", email: "", password: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [chief, setChief] = useState<Bot>();
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
    const all = await chatClient.bots();
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
        const installation = await installationApi.get();
        if (!status.isAdmin || installation.onboarding === "done")
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
        harness: draft.harness,
        model: draft.model.trim() || null,
        personality: draft.personality,
        instructions: draft.instructions,
        outputStyle: draft.outputStyle,
        outputStyleId: draft.outputStyleId,
      });
      setChief(saved);
      go("plugins");
    });

  const finish = () =>
    run(async () => {
      await installationApi.patch({ onboarding: "done" });
      await navigate({ to: "/chat/{-$chatId}", search: chief ? { bot: chief.id } : {} });
    });

  if (step === null) {
    return (
      <section className="mx-auto mt-16 max-w-md space-y-4 p-8" aria-busy>
        <Logo size={72} className="mx-auto" />
        <p role="status" className="text-center text-muted-foreground">
          Checking your installation…
        </p>
        {error && <Alert theme="danger">{error}</Alert>}
      </section>
    );
  }

  const index = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[index]!;
  const wide = index >= 3;
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
            {index + 1} of {STEPS.length}
          </span>
        </div>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          aria-label="Onboarding progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
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
              <Button
                type="button"
                variant="outline"
                aria-label={showKey ? "Hide key" : "Show key"}
                aria-pressed={showKey}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeSlashIcon /> : <EyeIcon />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              It is the value of <code className="font-mono">ZETTA_SETUP_KEY</code> in the server's
              environment (or <code className="font-mono">ZETTA_CONNECTION_KEY</code> when no setup
              key is set). Don't have one? Create it with{" "}
              <code className="font-mono">openssl rand -base64 32</code>, set it, and restart the
              server.
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
                  Use an https address, such as one from a private network like Tailscale. The
                  server needs a restart to open up.
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
          />
        )}
        {draft && step === "engine" && <EngineStep draft={draft} set={patchDraft} />}
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
            <Plugins onError={setError} />
          </div>
        )}

        {index >= 3 && (
          <Nav back={index > 3 ? () => go(STEPS[index - 1]!.id) : undefined}>
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
                {busy ? "Saving…" : "Save my Chief"}
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
