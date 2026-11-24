import { CheckCircleIcon, MinusCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { PhoneProviderId } from "@zetta/core/phone";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button, Input } from "@/components/ui";
import type { Installation, PhoneTest } from "../onboarding/installation-api";
import { PROVIDER_NAME } from "./phone-provider";
import {
  CARD_STATUS_LABEL,
  GOOD_FOR,
  TELNYX_PRICING,
  TELNYX_VOICE_PRICING,
  TWILIO_PRICING,
  isOn,
  keyStateOf,
  statusOf,
  type CardStatus,
  type PhoneField,
} from "./phone-settings-model";
import { ProviderLogo } from "./provider-logo";
import type { PhoneSettingsState } from "./use-phone-settings";

const CHIP_STYLE: Record<CardStatus, string> = {
  not_connected: "bg-muted text-muted-foreground",
  connected: "bg-success/15 text-success",
  key_unavailable: "bg-destructive/10 text-destructive",
  needs_attention: "bg-destructive/10 text-destructive",
};

type StatusChipProps = { status: CardStatus };
/** The state of a provider in words and a mark, so colour is never the only sign. */
export function StatusChip({ status }: StatusChipProps) {
  const Mark =
    status === "connected"
      ? CheckCircleIcon
      : status === "not_connected"
        ? MinusCircleIcon
        : WarningCircleIcon;
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_STYLE[status]}`}
    >
      <Mark aria-hidden weight="fill" className="size-3.5" />
      {CARD_STATUS_LABEL[status]}
    </span>
  );
}

type TestResultProps = { result: PhoneTest };
/** What the server said when it tested the provider, with a mark for pass or fail. */
function TestResult({ result }: TestResultProps) {
  const Mark = result.ok ? CheckCircleIcon : WarningCircleIcon;
  const text =
    (result.message ?? (result.ok ? "It works." : "It did not work.")) +
    (result.ok && result.balance ? ` Account balance: ${result.balance}.` : "");
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`flex items-start gap-2 text-sm text-pretty ${result.ok ? "text-success" : "text-destructive"}`}
    >
      <Mark aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

type ExternalLinkProps = { href: string; children: ReactNode };
function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  );
}

type PricingProps = { provider: PhoneProviderId };
function Pricing({ provider }: PricingProps) {
  return (
    <p className="text-xs text-pretty text-muted-foreground">
      You pay {PROVIDER_NAME[provider]} for numbers and calls. Read{" "}
      {provider === "telnyx" ? (
        <>
          <ExternalLink href={TELNYX_PRICING}>Telnyx&apos;s number pricing</ExternalLink> and{" "}
          <ExternalLink href={TELNYX_VOICE_PRICING}>voice pricing</ExternalLink>
        </>
      ) : (
        <ExternalLink href={TWILIO_PRICING}>Twilio&apos;s voice pricing</ExternalLink>
      )}{" "}
      first.
    </p>
  );
}

const KEY_NOTE = {
  none: "",
  set: "A key is saved. It is stored encrypted and never shown again.",
  unavailable: "The saved key cannot be read any more. Enter it again.",
} as const;

type ProviderCardProps = {
  provider: PhoneProviderId;
  saved: Installation;
  settings: PhoneSettingsState;
};
type Mode = "closed" | "open";
type Confirm = "none" | "asking";

/**
 * One phone provider: its logo, its state, and, when opened, the form that connects it. Telnyx and Twilio are the same card with
 * different fields. A connected card folds to a summary. Each card saves only its own fields and the public address both share; a
 * sentence about a field sits under that field.
 */
export function ProviderCard({ provider, saved, settings }: ProviderCardProps) {
  const name = PROVIDER_NAME[provider];
  const on = isOn(saved, provider);
  const keyState = keyStateOf(saved, provider);
  const { view, notes, busy } = settings;
  const test = settings.tests[provider];
  const status = statusOf(on, keyState, settings.verdict(provider));
  const [mode, setMode] = useState<Mode>("closed");
  const [confirm, setConfirm] = useState<Confirm>("none");
  const note = notes[provider];
  const errorOf = (field: PhoneField) =>
    note?.kind === "error" && note.field === field ? note.text : undefined;
  const idle = busy === "idle";
  const dirty = settings.dirty(provider) === "dirty";
  const secret = settings.secrets[provider];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((await settings.saveProvider(provider)) === "saved") setMode("closed");
  }
  async function disconnect() {
    setConfirm("none");
    if ((await settings.disconnect(provider)) === "saved") setMode("closed");
  }

  return (
    <section
      aria-label={name}
      data-provider={provider}
      data-status={status}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <header className="flex items-start gap-3">
        <ProviderLogo provider={provider} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold">{name}</h3>
            <StatusChip status={status} />
          </div>
          <p className="text-sm text-pretty text-muted-foreground">{GOOD_FOR[provider]}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={on ? "secondary" : "default"}
          aria-expanded={mode === "open"}
          onClick={() => setMode(mode === "open" ? "closed" : "open")}
        >
          {mode === "open" ? "Close" : on ? "Edit" : "Connect"}
        </Button>
      </header>

      {mode === "closed" && on && (
        <div className="space-y-2 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Key</dt>
            <dd>
              {keyState === "set"
                ? "Saved"
                : keyState === "unavailable"
                  ? "Cannot be read"
                  : "Missing"}
            </dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="min-w-0 break-all">{view.address || "Not set"}</dd>
          </dl>
          {test && <TestResult result={test} />}
          {note?.kind === "ok" && (
            <p role="status" className="text-xs text-muted-foreground">
              {note.text}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!idle || dirty}
            title={dirty ? "Save first: the test uses what is saved" : `Check ${name}`}
            onClick={() => void settings.test(provider)}
          >
            {busy === `test:${provider}` ? "Testing…" : "Test"}
          </Button>
        </div>
      )}

      {mode === "open" && (
        <form
          aria-label={`${name} settings`}
          autoComplete="off"
          className="space-y-3 border-t pt-4"
          onSubmit={(e) => void submit(e)}
        >
          <Pricing provider={provider} />
          <Input
            title={provider === "telnyx" ? "Telnyx API key" : "Twilio Auth Token"}
            name={provider === "telnyx" ? "phoneKey" : "phoneTwilioKey"}
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={
              keyState === "set" ? "A key is saved" : provider === "telnyx" ? "KEY…" : "Auth Token…"
            }
            info={KEY_NOTE[keyState] || undefined}
            error={errorOf("key")}
            onChange={(e) => settings.setSecret(provider, e.target.value)}
          />
          {provider === "telnyx" ? (
            <>
              <Input
                title="Public key for webhook signatures"
                name="phonePublicKey"
                autoComplete="off"
                value={view.telnyxPublicKey}
                placeholder="In Telnyx under Keys & Credentials"
                error={errorOf("publicKey")}
                onChange={(e) => settings.edit({ telnyxPublicKey: e.target.value })}
              />
              <Input
                title="Call application id"
                name="phoneApplicationId"
                autoComplete="off"
                value={view.telnyxApplication}
                placeholder="The Call Control application you made in Telnyx"
                error={errorOf("application")}
                onChange={(e) => settings.edit({ telnyxApplication: e.target.value })}
              />
            </>
          ) : (
            <Input
              title="Twilio Account SID"
              name="phoneTwilioAccountSid"
              autoComplete="off"
              value={view.twilioSid}
              placeholder="AC…, in the Twilio Console under Account info"
              error={errorOf("sid")}
              onChange={(e) => settings.edit({ twilioSid: e.target.value })}
            />
          )}
          <Input
            title="Public address of this server"
            name="phonePublicUrl"
            autoComplete="off"
            value={view.address}
            placeholder="https://zetta.example.com"
            info="Both providers call back on this address. It starts with https:// and reaches this server from the internet."
            error={errorOf("address")}
            onChange={(e) => settings.edit({ address: e.target.value })}
          />
          {note?.kind === "error" && note.field === "form" && (
            <p role="alert" className="text-sm text-destructive">
              {note.text}
            </p>
          )}
          {test && <TestResult result={test} />}
          {confirm === "asking" ? (
            <div
              role="group"
              aria-label={`Disconnect ${name}`}
              className="space-y-2 rounded-lg border border-destructive/40 p-3"
            >
              <p className="text-sm text-pretty">
                Disconnect {name}? Its key is removed and bots cannot get new {name} numbers.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!idle}
                  onClick={() => void disconnect()}
                >
                  Yes, disconnect
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm("none")}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={!idle || (on && !dirty)}>
                {busy === `save:${provider}` ? "Saving…" : on ? "Save" : "Save and connect"}
              </Button>
              {on && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!idle || dirty}
                  title={dirty ? "Save first: the test uses what is saved" : `Check ${name}`}
                  onClick={() => void settings.test(provider)}
                >
                  {busy === `test:${provider}` ? "Testing…" : "Test"}
                </Button>
              )}
              {on && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={!idle}
                  onClick={() => setConfirm("asking")}
                >
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  );
}
