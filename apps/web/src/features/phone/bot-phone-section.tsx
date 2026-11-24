import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Input, Select } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import type { PhoneProviderId } from "@zetta/core/phone";
import { phoneApi, phoneQueries, type BotPhoneNumber, type PhoneOffer } from "./phone-api";
import { PROVIDER_NAME } from "./phone-provider";

const INBOUND = [
  { value: "owner_only", label: "Only me (I prove it with my PIN)" },
  { value: "anyone", label: "Anyone who calls" },
  { value: "off", label: "Nobody: it answers that it is not in service" },
] as const;
const OUTBOUND = [
  { value: "on", label: "The bot may call people" },
  { value: "off", label: "The bot does not call" },
] as const;

type AskProps = { bot: Bot; offer: PhoneOffer };
/**
 * Ask for a number: a country from the list the administrator allowed, an optional area code and, only when two providers are ready,
 * which provider holds the number (the installation's default is chosen to begin with).
 */
function AskForNumber({ bot, offer }: AskProps) {
  const ready = (offer.providers ?? []).map((p) => p.id);
  const choice = ready.length > 1;
  const [provider, setProvider] = useState<PhoneProviderId>(
    offer.defaultProvider && ready.includes(offer.defaultProvider)
      ? offer.defaultProvider
      : (ready[0] ?? "telnyx"),
  );
  const [country, setCountry] = useState(offer.countries[0] ?? "");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    phoneApi
      .request(bot.id, {
        country,
        areaCode: area.trim() || null,
        ...(choice ? { provider } : {}),
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }
  const approval = offer.mode === "operator_approval";
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Give this bot a phone number">
      <p className="text-xs text-pretty text-muted-foreground">
        {bot.name} has no phone number. It would answer calls, and can call people for you. Every
        call starts by saying that an automated assistant is speaking for you, and nothing is
        recorded.{" "}
        {approval
          ? "An administrator approves the request before a number is bought."
          : "The number is bought as soon as you ask, and costs the administrator a monthly fee."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          title="Country"
          name="phoneCountry"
          required={false}
          value={country}
          options={offer.countries.map((c) => ({ value: c, label: c }))}
          onChange={(e) => setCountry(e.target.value)}
        />
        <Input
          title="Area code (optional)"
          name="phoneArea"
          inputMode="numeric"
          autoComplete="off"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        />
        {choice && (
          <Select
            title="Provider"
            name="phoneProvider"
            required={false}
            value={provider}
            options={ready.map((id) => ({ value: id, label: PROVIDER_NAME[id] }))}
            onChange={(e) => setProvider(e.target.value as PhoneProviderId)}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !bot.canEdit || !country}>
          {busy ? "Asking…" : approval ? "Ask for a phone number" : "Give this bot a phone number"}
        </Button>
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

type NumberProps = { bot: Bot; number: BotPhoneNumber };
function YourNumber({ bot, number }: NumberProps) {
  const [owner, setOwner] = useState(number.ownerNumber ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(undefined);
    work()
      .then(() => setMessage({ kind: "ok", text: done }))
      .catch((e) => setMessage({ kind: "error", text: errorMessage(e) }))
      .finally(() => setBusy(false));
  }
  const editable = number.status === "active" || number.status === "pending_review";
  const locked = number.pinLockedUntil !== null;
  return (
    <section className="space-y-4" aria-label="Bot phone number">
      {number.number ? (
        <code className="rounded bg-muted px-2 py-1 text-sm break-all">{number.number}</code>
      ) : (
        <p className="text-sm">
          Requested: {number.country}
          {number.areaCode ? ` (${number.areaCode})` : ""}
        </p>
      )}
      {number.provider && (
        <p className="text-xs text-muted-foreground">Provider: {PROVIDER_NAME[number.provider]}</p>
      )}
      <p role="status" className="text-xs text-pretty text-muted-foreground">
        {number.note}
        {number.status === "held" && number.heldUntil
          ? ` It is released on ${new Date(number.heldUntil).toLocaleDateString()}.`
          : ""}
      </p>
      {editable && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              title="Who may call this number"
              name="phoneInbound"
              required={false}
              value={number.inbound}
              options={[...INBOUND]}
              onChange={(e) =>
                run(() => phoneApi.update(bot.id, { inbound: e.target.value as never }), "Saved.")
              }
            />
            <Select
              title="Calls out"
              name="phoneOutbound"
              required={false}
              value={number.outbound}
              options={[...OUTBOUND]}
              onChange={(e) =>
                run(() => phoneApi.update(bot.id, { outbound: e.target.value as never }), "Saved.")
              }
            />
          </div>
          <div className="space-y-2">
            <Input
              title="Your own phone number"
              name="phoneOwner"
              autoComplete="off"
              value={owner}
              placeholder="+1 555 0100"
              onChange={(e) => setOwner(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || owner === (number.ownerNumber ?? "")}
              onClick={() =>
                run(() => phoneApi.update(bot.id, { ownerNumber: owner.trim() || null }), "Saved.")
              }
            >
              Save my number
            </Button>
          </div>
          <div className="space-y-2">
            <Input
              title="Keypad PIN"
              name="phonePin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              placeholder={number.pinSet ? "A PIN is set" : "4 to 8 digits"}
              onChange={(e) => setPin(e.target.value)}
            />
            <p className="text-xs text-pretty text-muted-foreground">
              When you call your bot it asks for this PIN on the keypad. Your caller ID alone never
              proves it is you. Three wrong tries lock the PIN for half an hour.
              {locked ? " It is locked right now." : ""}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || !number.ownerNumber || !/^\d{4,8}$/.test(pin)}
                onClick={() => {
                  const value = pin;
                  setPin("");
                  run(() => phoneApi.setPin(bot.id, value), "PIN saved.");
                }}
              >
                Save PIN
              </Button>
              {number.pinSet && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => phoneApi.setPin(bot.id, null), "PIN removed.")}
                >
                  Remove PIN
                </Button>
              )}
            </div>
            {!number.ownerNumber && (
              <p className="text-xs text-muted-foreground">Save your own number first.</p>
            )}
          </div>
        </>
      )}
      {number.status !== "held" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !bot.canEdit}
          onClick={() =>
            run(
              () => phoneApi.release(bot.id),
              number.status === "requested" ? "Request withdrawn." : "The number was released.",
            )
          }
        >
          {number.status === "requested" ? "Withdraw the request" : "Release this number"}
        </Button>
      )}
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={
            message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

/** The bot's phone number, in the bot settings. It appears when an administrator set phone up once in Studio. */
export function BotPhoneSection({ bot }: { bot: Bot }) {
  const q = useQuery(phoneQueries.forBot(bot.id));
  if (q.isPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading…
      </p>
    );
  const data = q.data;
  if (!data) return null;
  if (data.number && data.number.status !== "failed")
    return <YourNumber key={data.number.id} bot={bot} number={data.number} />;
  if (!data.offer.on || data.offer.mode === "off" || data.offer.countries.length === 0)
    return (
      <p className="text-xs text-pretty text-muted-foreground">
        This server does not give bots a phone number. An administrator can turn it on in Studio.
      </p>
    );
  return (
    <div className="space-y-3">
      {data.number?.status === "failed" && (
        <p role="status" className="text-xs text-pretty text-muted-foreground">
          The last request did not go through. You can ask again.
        </p>
      )}
      <AskForNumber bot={bot} offer={data.offer} />
    </div>
  );
}
