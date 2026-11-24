import { owned } from "./bot";
import { norm, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

type Box = Awaited<ReturnType<NonNullable<ChiefCtx["deps"]["mail"]>["list"]>>[number];

/** A mailbox by its id, its address or its name; two with the same name are an error that asks for the id. */
function find(rows: Box[], query: string): { hit: Box } | { error: string } {
  const byId = rows.find((r) => r.id === query);
  if (byId) return { hit: byId };
  const wanted = query.trim().toLowerCase();
  const byAddress = rows.filter((r) => r.address.toLowerCase() === wanted);
  if (byAddress.length === 1) return { hit: byAddress[0]! };
  const byLabel = rows.filter((r) => r.label && norm(r.label) === norm(query));
  if (byLabel.length === 1) return { hit: byLabel[0]! };
  if (byLabel.length > 1)
    return {
      error: `${byLabel.length} mailboxes are called "${query}". Use the id of one of them.`,
    };
  return { error: `no mailbox called "${query}". Use an address or id from the list.` };
}

/**
 * The person's mailboxes (modules/mail). Reads answer at once and never hold a password or a message. Every change is a card the person
 * approves, and `connect` is a form: the address, servers and password are typed in the browser and sealed there, so the model never
 * sees them. The `sending` switch and the password have no action here on purpose (see docs/decisions/bot-parity.md).
 */
export async function runMailbox(ctx: ChiefCtx, a: ChiefArgs<"mailbox">): Promise<Outcome> {
  const mail = ctx.deps.mail;
  if (!mail) return { error: "mail is not available on this server." };
  const bots = await owned(ctx);
  const nameOfBot = (id: string | null) =>
    id ? (bots.find((b) => b.id === id)?.name ?? "a bot") : "the Chief";
  const rows = await mail.list(ctx.actor);

  if (a.action === "list")
    return {
      read: `mailbox.list:\n${JSON.stringify(
        rows.map((m) => ({
          id: m.id,
          address: m.address,
          label: m.label,
          state: m.state,
          ownerBot: nameOfBot(m.ownerBotId),
          sending: m.sending,
        })),
      )}`,
    };

  if (a.action === "give_address") {
    const hit =
      bots.find((b) => b.id === a.bot) ?? bots.filter((b) => norm(b.name) === norm(a.bot))[0];
    if (!hit) return { error: `no bot called "${a.bot}". Use a name or id from the list.` };
    if (hit.kind === "chief") return { error: "only a specialist bot has its own address." };
    const offer = await ctx.deps.provisioning?.offered();
    if (!offer?.on)
      return {
        error:
          "this server does not hand out e-mail addresses to bots. An administrator can turn it on in Studio > Plugins > Bot e-mail address.",
      };
    if (rows.some((m) => m.kind === "provisioned" && m.ownerBotId === hit.id))
      return { error: `${hit.name} already has an address.` };
    return plan(
      `Give ${hit.name} an e-mail address`,
      [
        {
          field: "address",
          from: "none",
          to: `a new address on ${offer.domain}, kept for this bot`,
        },
      ],
      { tool: "mailbox", op: "give_address", botId: hit.id, address: offer.domain },
    );
  }

  if (a.action === "connect") {
    let owner: { id: string; name: string } | undefined;
    if (a.bot) {
      const wanted = a.bot;
      const hit =
        bots.find((b) => b.id === wanted) ?? bots.filter((b) => norm(b.name) === norm(wanted))[0];
      if (!hit) return { error: `no bot called "${a.bot}". Use a name or id from the list.` };
      if (hit.kind !== "chief") owner = { id: hit.id, name: hit.name };
    }
    const prefill: Record<string, string> = {
      ...(a.address ? { address: a.address } : {}),
      ...(a.label ? { label: a.label } : {}),
      ...(owner ? { ownerBotId: owner.id, ownerBotName: owner.name } : {}),
    };
    return {
      card: { form: "mailbox", botId: null, botName: null, prefill },
      text: "A form is now shown to the user to connect the mailbox: the address, the mail servers and the password. You never see the password. Tell them to fill it in; do not say it is connected.",
    };
  }

  const r = find(rows, a.mailbox);
  if ("error" in r) return r;
  const m = r.hit;
  const title = m.label || m.address;

  if (a.action === "senders") {
    if (m.kind !== "provisioned")
      return { error: "only a bot's own address has a list of allowed senders here." };
    const next = [...new Set(a.senders.map((x) => x.trim().toLowerCase()))].sort();
    const now = [...m.allowedSenders].sort();
    if (JSON.stringify(next) === JSON.stringify(now))
      return { error: `${m.address} already has that list.` };
    return plan(
      `Change who may write to ${m.address}`,
      [
        {
          field: "allowed senders",
          from: now.join(", ") || "nobody",
          to: next.join(", ") || "nobody",
        },
      ],
      { tool: "mailbox", op: "senders", id: m.id, senders: next, address: m.address },
    );
  }

  if (a.action === "get")
    return {
      read: `mailbox.get:\n${JSON.stringify({
        id: m.id,
        address: m.address,
        label: m.label,
        state: m.state,
        ownerBot: nameOfBot(m.ownerBotId),
        sending: m.sending,
        servers: m.servers,
      })}`,
    };

  if (m.state === "retired") return { error: `the mailbox ${m.address} is retired.` };

  if (a.action === "assign") {
    let botId: string | null = null;
    if (a.bot !== null) {
      const wanted = a.bot;
      const hit =
        bots.find((b) => b.id === wanted) ?? bots.filter((b) => norm(b.name) === norm(wanted))[0];
      if (!hit) return { error: `no bot called "${a.bot}". Use a name or id from the list.` };
      // A mailbox with no owner bot is the Chief's.
      botId = hit.kind === "chief" ? null : hit.id;
    }
    if (botId === m.ownerBotId) return { error: `${nameOfBot(botId)} already owns ${m.address}.` };
    return plan(
      `Give the mailbox ${title} to ${nameOfBot(botId)}`,
      [{ field: "owner bot", from: nameOfBot(m.ownerBotId), to: nameOfBot(botId) }],
      { tool: "mailbox", op: "assign", id: m.id, botId, address: m.address },
    );
  }

  if (a.action === "label") {
    if (a.label === m.label) return { error: `${m.address} already has that name.` };
    return plan(`Rename the mailbox ${title}`, [{ field: "name", from: m.label, to: a.label }], {
      tool: "mailbox",
      op: "label",
      id: m.id,
      label: a.label,
      address: m.address,
    });
  }

  return plan(
    `Disconnect the mailbox ${title}`,
    [
      {
        field: "disconnect",
        from: m.address,
        to:
          m.kind === "google" || m.kind === "microsoft"
            ? `the mailbox is hidden in Zetta and its bots stop reading it; the ${m.kind === "google" ? "Google" : "Microsoft"} account stays connected in its plugin and the mail is not touched`
            : m.kind === "provisioned"
              ? "the address is retired for good and every message stored for it is deleted; the address is never handed out again"
              : "the saved password is deleted and its bots stop reading it; the mail on the server is not touched",
      },
    ],
    { tool: "mailbox", op: "remove", id: m.id, address: m.address },
  );
}

export async function applyMailbox(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const mail = ctx.deps.mail;
  if (!mail) throw new Error("mail is not available on this server.");
  const v = p as {
    op: string;
    id: string;
    botId?: string | null;
    label?: string;
    senders?: string[];
  };
  if (v.op === "give_address") {
    if (!ctx.deps.provisioning) throw new Error("bot addresses are not available on this server.");
    await ctx.deps.provisioning.giveAddress(ctx.actor, String(v.botId));
    return;
  }
  if (v.op === "senders") {
    await mail.update(ctx.actor, v.id, { allowedSenders: v.senders ?? [] });
    return;
  }
  // The service finds the mailbox among the person's own: one that is gone, retired or not theirs fails here, not silently.
  if (v.op === "assign") await mail.update(ctx.actor, v.id, { botId: v.botId ?? null });
  else if (v.op === "label") await mail.update(ctx.actor, v.id, { label: v.label ?? "" });
  else if (v.op === "remove") await mail.remove(ctx.actor, v.id);
  else throw new Error(`unknown mailbox change ${v.op}`);
}
