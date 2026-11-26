import { useQuery } from "@tanstack/react-query";
import {
  ACCOUNT_KIND_LABELS,
  type AccountEngine,
  type AccountScope,
  isAccountEngine,
  KEY_PROVIDER_LABELS,
  type KeyProvider,
  type SignInMethod,
} from "@zetta/core/engine-accounts";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Input, Select } from "@/components/ui";
import { toast } from "@/lib/notify";

import { errorMessage } from "../chat/chat-client";
import { formText } from "../shared/form-data";
import { Badge, ConfirmButton } from "../shared/ui";
import {
  engineAccountsApi,
  engineAccountsQueries,
  type EngineAccount,
  type SignIn,
} from "./engine-accounts-api";

const describe = (account: EngineAccount) =>
  account.kind === "api_key" && account.provider && account.provider in KEY_PROVIDER_LABELS
    ? `${KEY_PROVIDER_LABELS[account.provider as KeyProvider]} key`
    : ACCOUNT_KIND_LABELS[account.kind];

type AccountRowProps = { account: EngineAccount; several: boolean };
/** One connected account: what it is, whether it is the one in use, and the way out. */
function AccountRow({ account, several }: AccountRowProps) {
  const [busy, setBusy] = useState(false);
  const act = (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    return work()
      .then(() => void toast.success(done))
      .catch((e) => void toast.error(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-medium">{account.label}</span>
        <span className="text-muted-foreground">{describe(account)}</span>
        {account.state === "signed_out" ? (
          <Badge tone="warning">Signed out</Badge>
        ) : (
          account.use === "default" && several && <Badge tone="success">In use</Badge>
        )}
      </span>
      <span className="flex items-center gap-2">
        {account.state === "signed_out" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const now = await engineAccountsApi.check(account.id);
                if (now?.state !== "active")
                  throw new Error(
                    "Still signed out. Sign in again with Connect another account, then disconnect this one.",
                  );
              }, `${account.label} works again.`)
            }
          >
            Try again
          </Button>
        )}
        {account.use !== "default" && account.state === "active" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(
                () => engineAccountsApi.setDefault(account.id),
                `${account.label} is the account in use.`,
              )
            }
          >
            Use this one
          </Button>
        )}
        <ConfirmButton
          label="Disconnect"
          size="xs"
          question={`Disconnect ${account.label}? What Zetta stored for it is removed. Bots that used it use your other account for this engine, or ask you to connect one.`}
          confirmLabel="Disconnect"
          onConfirm={() =>
            act(() => engineAccountsApi.remove(account.id), `${account.label} disconnected.`)
          }
        />
      </span>
      {account.state === "signed_out" && (
        <p className="basis-full text-pretty text-muted-foreground">
          {account.kind === "login"
            ? "The engine says this sign-in is gone, so your bots do not run on it. Sign in again, or try it again if you already did."
            : "Your bots do not run on it. Try it again once it works, or connect a new one."}
        </p>
      )}
    </li>
  );
}

type WorkspaceAccountRowProps = { account: EngineAccount; label: string; mayDisconnect: boolean };
/** The account an administrator connected for the whole workspace. Everyone sees it; only an administrator disconnects it. */
function WorkspaceAccountRow({ account, label, mayDisconnect }: WorkspaceAccountRowProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5"
      aria-label={`The workspace's ${label} account`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-medium">The workspace's account</span>
        <span className="text-muted-foreground">{describe(account)}</span>
        {account.state === "signed_out" && <Badge tone="warning">Signed out</Badge>}
      </span>
      {mayDisconnect && (
        <ConfirmButton
          label="Disconnect"
          size="xs"
          question="Disconnect the workspace's account? People with no account of their own stop running on it."
          confirmLabel="Disconnect"
          onConfirm={() =>
            engineAccountsApi
              .removeForWorkspace(account.id)
              .then(() => void toast.success("The workspace's account is disconnected."))
              .catch((e) => void toast.error(errorMessage(e)))
          }
        />
      )}
    </div>
  );
}

type GuidedProps = {
  engine: AccountEngine;
  method: Extract<SignInMethod, { way: "guided" }>;
  scope: AccountScope;
  onDone: () => void;
};
/**
 * A guided sign-in: the server runs the engine's own sign-in and this shows its link, its one-time code when it has one, and takes the
 * code the person pastes back. The page asks the server how it goes every second and a half, until it ends.
 */
function GuidedSignIn({ engine, method, scope, onDone }: GuidedProps) {
  const [id, setId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const running = useQuery({
    queryKey: ["engine-accounts", "sign-in", id],
    queryFn: () => engineAccountsApi.signIn(id!),
    enabled: Boolean(id),
    // The person is on the sign-in page in another tab while this runs: keep asking, so the page is right when they come back.
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const state = (query.state.data as SignIn | undefined)?.state;
      return state === "starting" || state === "waiting" || state === undefined ? 1500 : false;
    },
  });
  const signIn = running.data;
  const state = signIn?.state;
  useEffect(() => {
    if (state !== "done") return;
    toast.success("Account connected.");
    void engineAccountsApi.refresh();
    onDone();
  }, [state, onDone]);

  async function start() {
    setStarting(true);
    setError(undefined);
    try {
      setId((await engineAccountsApi.startSignIn(engine, method.id, scope)).id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = formText(new FormData(form), "code").trim();
    if (!id || !text) return;
    setSending(true);
    setError(undefined);
    try {
      await engineAccountsApi.sendCode(id, text);
      form.reset();
      await running.refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  const cancel = () => {
    if (id) void engineAccountsApi.cancelSignIn(id).catch(() => undefined);
    setId(undefined);
  };

  if (!id || state === "failed" || state === "cancelled")
    return (
      <div className="space-y-2">
        <p className="text-sm text-pretty text-muted-foreground">{method.help}</p>
        {state === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {signIn?.message ?? "The sign-in did not finish."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="button" size="sm" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : state === "failed" ? "Start again" : "Start sign-in"}
        </Button>
      </div>
    );
  return (
    <div className="space-y-3" aria-busy={state === "starting"}>
      {!signIn?.url ? (
        <p role="status" className="text-sm text-muted-foreground">
          Starting the sign-in on the server…
        </p>
      ) : (
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            Open the sign-in page and approve:{" "}
            <a
              href={signIn.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              Open the sign-in page
            </a>
          </li>
          {signIn.code && (
            <li>
              Enter this one-time code there:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-base">
                {signIn.code}
              </code>
            </li>
          )}
          {signIn.input === "code" ? (
            <li>
              <form className="flex flex-wrap items-end gap-2" onSubmit={send}>
                <div className="min-w-56 flex-1">
                  <Input
                    title="Code from the sign-in page"
                    name="code"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                </div>
                <Button type="submit" size="sm" disabled={sending}>
                  {sending ? "Sending…" : "Send the code"}
                </Button>
              </form>
            </li>
          ) : (
            <li>Come back here. This page notices by itself when you are signed in.</li>
          )}
        </ol>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}

type PasteProps = {
  engine: AccountEngine;
  method: Extract<SignInMethod, { way: "paste" }>;
  /** False when this server cannot store a secret yet. */
  sealed: boolean;
  scope: AccountScope;
  onDone: () => void;
};
/** A pasted token or key. It is sealed in the browser before it is sent, and never shown again. */
function PasteSecret({ engine, method, sealed, scope, onDone }: PasteProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const providers = method.providers ?? [];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      await engineAccountsApi.paste({
        engine,
        method: method.id,
        secret: formText(data, "secret").trim(),
        label: formText(data, "label").trim(),
        for: scope,
        ...(method.kind === "api_key"
          ? { provider: formText(data, "provider") || providers[0] || "" }
          : {}),
      });
      toast.success(
        "Account connected. What you pasted is stored encrypted and is not shown again.",
      );
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // The field never keeps the secret, saved or not.
      form.reset();
      setBusy(false);
    }
  }
  if (!sealed)
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        This server cannot store a token or a key yet: its connection key is not set. Ask the person
        who runs it.
      </p>
    );
  return (
    <form className="space-y-3" onSubmit={save}>
      <p className="text-sm text-pretty text-muted-foreground">{method.help}</p>
      {providers.length > 1 && (
        <Select
          title="Whose key"
          name="provider"
          required={false}
          defaultValue={providers[0]}
          options={providers.map((p) => ({ value: p, label: KEY_PROVIDER_LABELS[p] }))}
        />
      )}
      <Input
        title={method.kind === "token" ? "Token" : "Key"}
        name="secret"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        data-1p-ignore
        required
      />
      <Input title="Name (optional)" name="label" autoComplete="off" maxLength={80} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Saving…" : "Connect"}
      </Button>
    </form>
  );
}

type ConnectProps = {
  engine: AccountEngine;
  methods: readonly SignInMethod[];
  sealed: boolean;
  /** `workspace`: an administrator connects the account everyone here with none of their own runs on. */
  scope: AccountScope;
  onClose: () => void;
};
/** The ways to connect an account to one engine. With several, the person picks one first. */
function Connect({ engine, methods, sealed, scope, onClose }: ConnectProps) {
  const [chosen, setChosen] = useState(methods.length === 1 ? methods[0]!.id : "");
  const method = methods.find((m) => m.id === chosen);
  return (
    <div className="space-y-3 rounded-md border p-3">
      {scope === "workspace" && (
        <p className="text-pretty text-muted-foreground">
          For the whole workspace: everyone here with no account of their own for this engine runs
          on it, and what they send counts against it.
        </p>
      )}
      {methods.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="How to connect">
          {methods.map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant={m.id === chosen ? "default" : "outline"}
              aria-pressed={m.id === chosen}
              onClick={() => setChosen(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      )}
      {method?.way === "guided" && (
        <GuidedSignIn
          key={method.id}
          engine={engine}
          method={method}
          scope={scope}
          onDone={onClose}
        />
      )}
      {method?.way === "paste" && (
        <PasteSecret
          key={method.id}
          engine={engine}
          method={method}
          sealed={sealed}
          scope={scope}
          onDone={onClose}
        />
      )}
      {!method && <p className="text-sm text-muted-foreground">Choose how you want to connect.</p>}
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

/**
 * The person's own accounts for one engine, under that engine's row in Studio > Accounts: what is connected, which one is in use, and
 * the ways to connect another. With no account the person's bots run on the server's own sign-in, while the server allows it.
 */
export function EngineAccountArea({ engine, label }: { engine: string; label: string }) {
  const { data } = useQuery(engineAccountsQueries.list());
  const [open, setOpen] = useState<AccountScope | null>(null);
  if (!data || !isAccountEngine(engine)) return null;
  const mine = data.accounts.filter((a) => a.engine === engine);
  const shared = data.workspace.find((a) => a.engine === engine);
  const methods = data.methods[engine] ?? [];
  return (
    <div className="space-y-2 text-sm">
      {mine.length > 0 ? (
        <ul className="space-y-1" aria-label={`Your ${label} accounts`}>
          {mine.map((account) => (
            <AccountRow key={account.id} account={account} several={mine.length > 1} />
          ))}
        </ul>
      ) : (
        <p className="text-pretty text-muted-foreground">
          {shared
            ? "No account of yours. Your bots run on the workspace's account."
            : data.serverLogin === "allowed"
              ? "No account of yours. Your bots run on the server's own sign-in, which everyone here shares."
              : "No account of yours. Connect one: this server runs bots only on an account."}
        </p>
      )}
      {shared && (
        <WorkspaceAccountRow
          account={shared}
          label={label}
          mayDisconnect={data.mayConnectForWorkspace}
        />
      )}
      {open ? (
        <Connect
          engine={engine}
          methods={methods}
          sealed={data.sealed}
          scope={open}
          onClose={() => setOpen(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen("mine")}>
            {mine.length ? "Connect another account" : "Connect my account"}
          </Button>
          {data.mayConnectForWorkspace && !shared && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen("workspace")}>
              Connect one for the workspace
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
