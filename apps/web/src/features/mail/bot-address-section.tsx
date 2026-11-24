import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { mailApi, mailQueries, type Mailbox } from "./mail-api";

/** The address of a bot, as text a person can select and as a button that copies it. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded bg-muted px-2 py-1 text-sm break-all">{address}</code>
      <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
        {copied === "done" ? "Copied" : "Copy address"}
      </Button>
      {copied === "failed" && (
        <span role="alert" className="text-xs text-destructive">
          Your browser did not allow copying. Select the address and copy it.
        </span>
      )}
    </div>
  );
}

/** The mailbox a bot owns that the installation made for it, if it has one. */
export const addressOf = (boxes: Mailbox[] | undefined, botId: string) =>
  boxes?.find((m) => m.kind === "provisioned" && m.ownerBotId === botId);

/**
 * The bot's own e-mail address. It appears when the server hands out addresses (an administrator set it up once in Studio); the person
 * types nothing. A bot made before that gets one here, on request. Who may write to the address is set in the mailbox settings.
 */
export function BotAddressSection({ bot }: { bot: Bot }) {
  const qc = useQueryClient();
  const offer = useQuery(mailQueries.provisioning());
  const boxes = useQuery(mailQueries.mailboxes());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const have = addressOf(boxes.data, bot.id);
  async function give() {
    setBusy(true);
    setError(undefined);
    try {
      await mailApi.provision(bot.id);
      await qc.invalidateQueries({ queryKey: ["mail"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (bot.kind !== "specialist")
    return (
      <p className="text-xs text-muted-foreground">
        The Chief reads the mailboxes you connect in Mail. Only your other bots get an address of
        their own.
      </p>
    );
  if (boxes.isPending || offer.isPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading…
      </p>
    );
  if (have)
    return (
      <section aria-label="Bot e-mail address" className="space-y-3">
        <CopyAddress address={have.address} />
        {have.state === "retired" && (
          <p className="text-xs text-muted-foreground">
            This address was retired with the bot. New mail to it is dropped; what was stored stays
            readable until you remove the mailbox.
          </p>
        )}
        <p className="text-xs text-pretty text-muted-foreground">
          {have.allowedSenders.length
            ? `${bot.name} answers mail from ${have.allowedSenders.join(", ")}. Anyone else's mail is kept in the inbox and the bot does not answer it.`
            : `Nobody is allowed to write to ${bot.name} yet: mail is kept in the inbox and the bot does not answer it. Add the people it may answer in the mailbox settings.`}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            to="/mail/$mailboxId"
            params={{ mailboxId: have.id }}
            className="text-primary underline"
          >
            Open the inbox
          </Link>
          <Link
            to="/mail/$mailboxId/settings"
            params={{ mailboxId: have.id }}
            className="text-primary underline"
          >
            Who may write to it
          </Link>
        </div>
      </section>
    );
  if (!offer.data?.on)
    return (
      <p className="text-xs text-muted-foreground">
        This server does not give bots an address of their own. An administrator can turn it on in
        Studio. A mailbox you connect in Mail can still belong to this bot.
      </p>
    );
  return (
    <section aria-label="Bot e-mail address" className="space-y-3">
      <p className="text-xs text-pretty text-muted-foreground">
        {bot.name} has no e-mail address yet. It gets one on {offer.data.domain}, and stays with it
        when you rename the bot.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={busy || !bot.canEdit} onClick={() => void give()}>
          {busy ? "Giving…" : "Give this bot an address"}
        </Button>
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
