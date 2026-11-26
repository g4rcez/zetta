import { queryOptions } from "@tanstack/react-query";
import type {
  AccountEngine,
  AccountKind,
  AccountState,
  AccountUse,
  ServerLogin,
  SharedAccount,
  SignInMethod,
  AccountScope,
} from "@zetta/core/engine-accounts";

import { queryClient } from "@/lib/query-client";
import { call, sendSealed } from "../chat/chat-client";

/** One of the person's agent accounts as the server answers: never a secret. */
export type EngineAccount = {
  id: string;
  engine: AccountEngine;
  kind: AccountKind;
  provider: string | null;
  label: string;
  use: AccountUse;
  state: AccountState;
  checkedAt: string | null;
  createdAt: string;
};
export type EngineAccountsList = {
  accounts: EngineAccount[];
  /** False when this server cannot store a secret yet: only a CLI's own sign-in can be an account. */
  sealed: boolean;
  serverLogin: ServerLogin;
  /** The accounts an administrator connected for the whole workspace: whoever has none of their own runs on them. */
  workspace: EngineAccount[];
  /** An owner or an administrator may connect one for the workspace. */
  mayConnectForWorkspace: boolean;
  methods: Record<AccountEngine, readonly SignInMethod[]>;
};
/** A guided sign-in while it runs. */
export type SignIn = {
  id: string;
  engine: AccountEngine;
  method: string;
  state: "starting" | "waiting" | "done" | "failed" | "cancelled";
  url: string | null;
  code: string | null;
  input: "code" | "none";
  message: string | null;
  accountId: string | null;
};
/** What the person chose for one bot. Empty means: follow the bot's own engine and the person's default account. */
export type BotEngineChoice = {
  botId: string;
  owner: boolean;
  /** The bot runs on its owner's account for this person in every chat: nothing here is theirs to choose. */
  ownerPays: boolean;
  default: { harness: string; model: string | null };
  harness: AccountEngine | null;
  model: string | null;
  accountId: string | null;
  sharedAccount: SharedAccount;
};
/** For an administrator: one account of a person of the workspace, with nothing that names or opens it. */
export type PersonAccount = {
  userId: string;
  id: string;
  engine: AccountEngine;
  kind: AccountKind;
  state: AccountState;
  use: AccountUse;
};

const KEY = ["engine-accounts"] as const;
const refresh = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: KEY }),
    // The status of each engine reads better once an account is there.
    queryClient.invalidateQueries({ queryKey: ["harnesses"] }),
  ]);
const base = "/api/engine-accounts";

export const engineAccountsApi = {
  list: () => call<EngineAccountsList>(`${base}/`),
  /** The token or key is sealed in the browser for this person and this engine; the request never carries it in the open. */
  paste: (input: {
    engine: AccountEngine;
    method: string;
    provider?: string;
    label?: string;
    secret: string;
    for?: AccountScope;
  }) =>
    sendSealed(`engine-account.create:${input.engine}`, { secret: input.secret }, (sealed) =>
      call<{ account: EngineAccount }>(`${base}/`, "POST", {
        engine: input.engine,
        method: input.method,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(input.for === "workspace" ? { for: "workspace" } : {}),
        sealed,
      }),
    ).then(async (r) => {
      await refresh();
      return r.account;
    }),
  startSignIn: (engine: AccountEngine, method: string, scope: AccountScope = "mine") =>
    call<{ signIn: SignIn }>(`${base}/sign-in`, "POST", {
      engine,
      method,
      ...(scope === "workspace" ? { for: "workspace" } : {}),
    }).then((r) => r.signIn),
  /** An owner or an administrator disconnects the workspace's account. */
  removeForWorkspace: (id: string) => call(`${base}/workspace/${id}`, "DELETE").then(refresh),
  signIn: (id: string) => call<{ signIn: SignIn }>(`${base}/sign-in/${id}`).then((r) => r.signIn),
  sendCode: (id: string, text: string) =>
    call<{ signIn: SignIn }>(`${base}/sign-in/${id}/input`, "POST", { text }).then((r) => r.signIn),
  cancelSignIn: (id: string) => call(`${base}/sign-in/${id}`, "DELETE"),
  setDefault: (id: string) => call(`${base}/${id}/default`, "PUT").then(refresh),
  /** Asks again whether a signed-out account works: its CLI for a sign-in, the next run for a token or a key. */
  check: (id: string) =>
    call<{ account?: EngineAccount }>(`${base}/${id}/check`, "POST").then(async (r) => {
      await refresh();
      return r.account;
    }),
  remove: (id: string) => call(`${base}/${id}`, "DELETE").then(refresh),
  refresh,
  choice: (botId: string) =>
    call<{ choice: BotEngineChoice }>(`${base}/bots/${botId}`).then((r) => r.choice),
  saveChoice: (
    botId: string,
    choice: { harness: AccountEngine | null; model: string | null; accountId: string | null },
  ) =>
    call<{ choice: BotEngineChoice }>(`${base}/bots/${botId}`, "PUT", choice).then(async (r) => {
      await queryClient.invalidateQueries({ queryKey: [...KEY, "bot", botId] });
      return r.choice;
    }),
  saveShared: (botId: string, sharedAccount: SharedAccount) =>
    call(`${base}/bots/${botId}/shared`, "PUT", { sharedAccount }).then(() =>
      queryClient.invalidateQueries({ queryKey: [...KEY, "bot", botId] }),
    ),
  people: () => call<{ accounts: PersonAccount[] }>(`${base}/people`).then((r) => r.accounts),
  removeFor: (userId: string, id: string) =>
    call(`${base}/people/${encodeURIComponent(userId)}/${id}`, "DELETE").then(() =>
      queryClient.invalidateQueries({ queryKey: [...KEY, "people"] }),
    ),
};

export const engineAccountsQueries = {
  list: () => queryOptions({ queryKey: [...KEY, "mine"], queryFn: () => engineAccountsApi.list() }),
  choice: (botId: string) =>
    queryOptions({
      queryKey: [...KEY, "bot", botId],
      queryFn: () => engineAccountsApi.choice(botId),
    }),
  people: () =>
    queryOptions({ queryKey: [...KEY, "people"], queryFn: () => engineAccountsApi.people() }),
};
