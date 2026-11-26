import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  PHONE_PROVIDER_IDS,
  type PhoneNumberStatus,
  type PhoneProviderId,
} from "@zetta/core/phone";
import { useState, type FormEvent } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { BotSelect } from "@/components/bot-select";
import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { formatPhone } from "./format";
import {
  phoneApi,
  phoneQueries,
  type PhoneAdminNumber,
  type PhoneAssignableBot,
  type PhoneOptout,
} from "./phone-api";
import {
  PHONE_STATUS_FILTERS,
  filterPhoneRows,
  type PhoneSearch,
  type PhoneStatusFilter,
} from "./phone-filters";
import { PROVIDER_NAME } from "./phone-provider";
import { PhoneSetup } from "./phone-setup";

const STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  requested: "Requested",
  pending_review: "In review",
  active: "Active",
  held: "Held (bot archived)",
  released: "Released",
  failed: "Failed",
};
const INBOUND_LABEL = { owner_only: "Only the owner", anyone: "Anyone", off: "Nobody" } as const;
const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...PHONE_STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];
const PROVIDER_FILTER_OPTIONS = [
  { value: "all", label: "All providers" },
  ...PHONE_PROVIDER_IDS.map((p) => ({ value: p, label: PROVIDER_NAME[p] })),
];

/** A number, its bot and its owner, as the page lists them. */
type Row = PhoneAdminNumber & { ownerName: string | null; botKind: "chief" | "specialist" };
type Run = (work: () => Promise<unknown>, done?: string) => void;
type How = "push" | "replace";

/** The status as a person reads it: the release date when the number is held. */
const statusText = (n: PhoneAdminNumber) =>
  n.status === "held" && n.heldUntil
    ? `Held until ${new Date(n.heldUntil).toLocaleDateString()}`
    : STATUS_LABEL[n.status];

/** What a bot is to an administrator choosing one: the owner's name and whether it already has a number. */
const botChoices = (bots: readonly PhoneAssignableBot[], without?: string) =>
  bots
    .filter((b) => b.id !== without)
    .map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      role: `${b.ownerName}${b.hasNumber ? " · has a number" : ""}`,
    }));

type RowProps = {
  n: Row;
  bots: readonly PhoneAssignableBot[];
  busy: boolean;
  run: Run;
};
type RowMode = "idle" | "reassign" | "release";

function NumberRow({ n, bots, busy, run }: RowProps) {
  const [mode, setMode] = useState<RowMode>("idle");
  const [target, setTarget] = useState("");
  const movable = n.status === "active" || n.status === "held";
  const releasable = movable || n.status === "pending_review";
  const label = n.number
    ? formatPhone(n.number)
    : `${n.country}${n.areaCode ? ` (${n.areaCode})` : ""}`;
  return (
    <>
      <tr className="border-t align-top">
        <td className="px-3 py-2 font-medium whitespace-nowrap">
          <code>{label}</code>
        </td>
        <td className="px-3 py-2">{PROVIDER_NAME[n.provider]}</td>
        <td className="px-3 py-2">
          <BotIdentity bot={{ id: n.botId, name: n.botName, kind: n.botKind }} size={24} />
        </td>
        <td className="px-3 py-2">{n.ownerName ?? "—"}</td>
        <td className="px-3 py-2">{statusText(n)}</td>
        <td className="px-3 py-2">{INBOUND_LABEL[n.inbound]}</td>
        <td className="px-3 py-2">
          <span className="flex flex-wrap justify-end gap-2">
            {n.status === "requested" && (
              <>
                <Button size="sm" disabled={busy} onClick={() => run(() => phoneApi.approve(n.id))}>
                  Approve and buy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => phoneApi.reject(n.id))}
                >
                  Turn down
                </Button>
              </>
            )}
            {movable && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setMode(mode === "reassign" ? "idle" : "reassign")}
              >
                Reassign
              </Button>
            )}
            {releasable && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setMode(mode === "release" ? "idle" : "release")}
              >
                Release
              </Button>
            )}
          </span>
        </td>
      </tr>
      {mode === "reassign" && (
        <tr className="bg-muted/40">
          <td colSpan={7} className="px-3 py-3">
            <form
              aria-label={`Reassign ${label}`}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => phoneApi.reassign(n.id, target).then(() => setMode("idle")),
                  "The number was moved.",
                );
              }}
            >
              <div className="min-w-64 flex-1">
                <BotSelect
                  label="Give this number to"
                  name={`reassign-${n.id}`}
                  bots={botChoices(bots, n.botId)}
                  value={target}
                  onChange={setTarget}
                  placeholder="Search a bot"
                  required
                />
              </div>
              <Button type="submit" size="sm" disabled={busy || !target}>
                Move the number
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </form>
            <p className="mt-2 text-xs text-pretty text-muted-foreground">
              The new bot starts with the number&apos;s calls answered by its own settings: the
              owner&apos;s own number and PIN are cleared.
            </p>
          </td>
        </tr>
      )}
      {mode === "release" && (
        <tr className="bg-muted/40">
          <td colSpan={7} className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm">
            <span>Release {label} now? The provider takes it back and the bot loses it.</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => phoneApi.operatorRelease(n.id))}
            >
              Release now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Keep it
            </Button>
          </td>
        </tr>
      )}
    </>
  );
}

type FiltersProps = { search: PhoneSearch; setSearch: (next: PhoneSearch, how: How) => void };
function Filters({ search, setSearch }: FiltersProps) {
  return (
    <form
      aria-label="Filter the numbers"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <Select
        title="Status"
        name="status"
        required={false}
        value={search.status ?? "all"}
        options={STATUS_OPTIONS}
        onChange={(e) => {
          const { status: _drop, ...rest } = search;
          const v = e.target.value as PhoneStatusFilter | "all";
          setSearch(v === "all" ? rest : { ...rest, status: v }, "push");
        }}
      />
      <Select
        title="Provider"
        name="provider"
        required={false}
        value={search.provider ?? "all"}
        options={PROVIDER_FILTER_OPTIONS}
        onChange={(e) => {
          const { provider: _drop, ...rest } = search;
          const v = e.target.value as PhoneProviderId | "all";
          setSearch(v === "all" ? rest : { ...rest, provider: v }, "push");
        }}
      />
      <Input
        title="Search"
        name="q"
        autoComplete="off"
        value={search.q ?? ""}
        placeholder="A number, a bot or a person"
        onChange={(e) => {
          const { q: _drop, ...rest } = search;
          setSearch(e.target.value ? { ...rest, q: e.target.value } : rest, "replace");
        }}
      />
    </form>
  );
}

type AttachProps = {
  bots: readonly PhoneAssignableBot[];
  ready: readonly PhoneProviderId[];
  defaultProvider: PhoneProviderId | null | undefined;
  busy: boolean;
  run: Run;
};
/** Use a number the administrator already owns at one of the providers: it is found on the account and given to a bot. */
function AttachForm({ bots, ready, defaultProvider, busy, run }: AttachProps) {
  const choice = ready.length > 1;
  const [number, setNumber] = useState("");
  const [botId, setBotId] = useState("");
  const [provider, setProvider] = useState<PhoneProviderId>(
    defaultProvider && ready.includes(defaultProvider) ? defaultProvider : (ready[0] ?? "telnyx"),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    run(
      () =>
        phoneApi.attach({ number, botId, ...(choice ? { provider } : {}) }).then(() => {
          setNumber("");
          setBotId("");
        }),
      "The number is attached.",
    );
  }
  return (
    <form onSubmit={submit} aria-label="Attach a number I own" className="space-y-3">
      <h3 className="text-sm font-medium">Attach a number I own</h3>
      <p className="text-xs text-pretty text-muted-foreground">
        A number already on your account with the provider is found there and given to a bot.
        Nothing is bought, and the provider is told to send its calls here.
      </p>
      <div className="grid items-end gap-3 sm:grid-cols-2">
        <Input
          title="The number"
          name="attachNumber"
          autoComplete="off"
          value={number}
          placeholder="+1 202 555 0123"
          onChange={(e) => setNumber(e.target.value)}
        />
        {choice && (
          <Select
            title="Provider"
            name="attachProvider"
            required={false}
            value={provider}
            options={ready.map((id) => ({ value: id, label: PROVIDER_NAME[id] }))}
            onChange={(e) => setProvider(e.target.value as PhoneProviderId)}
          />
        )}
        <BotSelect
          label="Give it to"
          name="attachBot"
          bots={botChoices(bots)}
          value={botId}
          onChange={setBotId}
          placeholder="Search a bot"
        />
      </div>
      <Button type="submit" size="sm" disabled={busy || number.trim().length < 7 || !botId}>
        Attach the number
      </Button>
    </form>
  );
}

type OptoutProps = { o: PhoneOptout; busy: boolean; run: Run };
function OptoutRow({ o, busy, run }: OptoutProps) {
  return (
    <li className="flex items-center gap-3 rounded border p-2 text-sm">
      <code>{o.number}</code>
      <span className="text-xs text-muted-foreground">{o.reason.replace("_", " ")}</span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={busy}
        onClick={() => run(() => phoneApi.removeOptout(o.id))}
      >
        Remove
      </Button>
    </li>
  );
}

type OptoutsProps = { busy: boolean; run: Run };
/** The installation-wide do-not-call list. */
function Optouts({ busy, run }: OptoutsProps) {
  const optouts = useQuery(phoneQueries.optouts());
  const [add, setAdd] = useState("");
  return (
    <section className="space-y-3" aria-label="Do not call">
      <h3 className="text-sm font-medium">Do not call</h3>
      <p className="text-xs text-pretty text-muted-foreground">
        No bot calls a number on this list. A person who asks on a call not to be called again is
        added here by themselves.
      </p>
      <ul className="space-y-2">
        {(optouts.data?.optouts ?? []).map((o) => (
          <OptoutRow key={o.id} o={o} busy={busy} run={run} />
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = add;
          setAdd("");
          run(() => phoneApi.addOptout(value));
        }}
      >
        <Input
          title="Add a number"
          name="optoutNumber"
          autoComplete="off"
          value={add}
          placeholder="+1 202 555 0100"
          onChange={(e) => setAdd(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={busy || add.trim().length < 7}
        >
          Add
        </Button>
      </form>
    </section>
  );
}

type AreaProps = { search: PhoneSearch; setSearch: (next: PhoneSearch, how: How) => void };

/** The numbers, attach and the do-not-call list: what happens once a provider is connected. */
function NumbersArea({ search, setSearch }: AreaProps) {
  const numbers = useQuery(phoneQueries.numbers());
  const bots = useQuery(phoneQueries.bots());
  const offer = useQuery(phoneQueries.offer());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  function run(work: () => Promise<unknown>, message = "Done.") {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    work()
      .then(() => setDone(message))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }
  if (numbers.isPending || bots.isPending || offer.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    );
  if (numbers.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(numbers.error)}
      </p>
    );
  const assignable = bots.data?.bots ?? [];
  const ownerOf = (botId: string, userId: string) =>
    assignable.find((b) => b.id === botId)?.ownerName ??
    assignable.find((b) => b.ownerUserId === userId)?.ownerName ??
    null;
  const rows: Row[] = numbers.data.numbers.map((n) => ({
    ...n,
    ownerName: ownerOf(n.botId, n.ownerUserId),
    botKind: assignable.find((b) => b.id === n.botId)?.kind ?? "specialist",
  }));
  const shown = filterPhoneRows(rows, search);
  const filtered = Boolean(search.status || search.provider || search.q);
  const on = offer.data?.on ?? false;
  const ready = (offer.data?.providers ?? []).map((p) => p.id);
  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold">Numbers</h2>
      {!on && (
        <p className="text-sm text-pretty text-muted-foreground">
          Once a provider is connected above, numbers show here and bots can ask for one.
        </p>
      )}
      {rows.length === 0 ? (
        on && (
          <p className="text-sm text-pretty text-muted-foreground">
            No bot has a number or a request yet. A number is bought only when a bot&apos;s owner
            asks for one, or when you attach one you own below.
          </p>
        )
      ) : (
        <section className="space-y-3" aria-label="Numbers">
          <Filters search={search} setSearch={setSearch} />
          <p className="text-xs text-muted-foreground" role="status">
            {shown.length === rows.length
              ? `${rows.length} ${rows.length === 1 ? "number" : "numbers"}`
              : `${shown.length} of ${rows.length} numbers`}
          </p>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No number matches.{" "}
              {filtered && (
                <Link to="/studio/$tab" params={{ tab: "phone" }} search={{}} className="underline">
                  Clear the filters
                </Link>
              )}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Number
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Provider
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Bot
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Owner
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Who may call
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((n) => (
                    <NumberRow key={n.id} n={n} bots={assignable} busy={busy} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {on && (
        <AttachForm
          bots={assignable}
          ready={ready}
          defaultProvider={offer.data?.defaultProvider}
          busy={busy}
          run={run}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {done}
        </p>
      )}
      <Optouts busy={busy} run={run} />
    </div>
  );
}

type PageProps = {
  /** Administrators only: anyone else sees a sentence and nothing is asked of the server. */
  admin: boolean;
  /** The person who set the server up: the providers and their keys are theirs to change. */
  root: boolean;
  search: PhoneSearch;
  setSearch: (next: PhoneSearch, how: How) => void;
};

/**
 * Everything about phone numbers, for administrators: the setup (providers, keys, who can ask) on top, then every number (who has it,
 * at which provider, in what state; approve, release, reassign; attach one that is already owned) and the do-not-call list. The
 * filters live in the address (`search`).
 */
export function PhoneNumbersPage({ admin, root, search, setSearch }: PageProps) {
  if (!admin)
    return (
      <p className="text-sm text-muted-foreground">
        Only administrators manage the phone numbers of this server.
      </p>
    );
  return (
    <div className="space-y-8">
      {root ? (
        <PhoneSetup />
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          The phone providers, their keys and who can ask for a number are set for the whole server
          by the person who set it up.
        </p>
      )}
      <NumbersArea search={search} setSearch={setSearch} />
    </div>
  );
}
