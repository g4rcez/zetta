import { owned } from "./bot";
import { normalizeE164 } from "@zetta/core/phone";
import { norm, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/**
 * A bot's phone number (modules/phone). Reads answer at once (never a PIN or its hash, never the provider's ids). Every change is a card the
 * person approves; an administrator's approval of a request is its own card. The keypad PIN has no action here: it is typed in the bot's
 * settings, so the model never sees it. Where the administrator has not set phone up, every action says so.
 */
export async function runPhone(ctx: ChiefCtx, a: ChiefArgs<"phone">): Promise<Outcome> {
  const phone = ctx.deps.phone;
  if (!phone) return { error: "phone numbers are not available on this server." };

  if (a.action === "list") {
    if (!ctx.actor.isAdmin) return { error: "only an administrator sees every number." };
    const rows = await phone.list(ctx.actor);
    return {
      read: `phone.list:\n${JSON.stringify(
        rows.map((r) => ({
          bot: r.botName,
          number: r.number,
          country: r.country,
          provider: r.provider,
          status: r.status,
          inbound: r.inbound,
          outbound: r.outbound,
        })),
      )}`,
    };
  }

  if (a.action === "calls") {
    const bots = await owned(ctx);
    const wanted = a.bot;
    const one = wanted
      ? (bots.find((b) => b.id === wanted) ?? bots.find((b) => norm(b.name) === norm(wanted)))
      : undefined;
    if (wanted && !one)
      return { error: `no bot called "${wanted}". Use a name or id from the list.` };
    const rows = await phone.calls(ctx.actor, {
      ...(one ? { botId: one.id } : {}),
      limit: a.limit ?? 20,
    });
    // Only what a person reads in a call list. The words of a call are in its own chat and never come through here.
    return {
      read: `phone.calls:\n${JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          bot: r.botName,
          direction: r.direction,
          number: r.peer,
          status: r.status,
          outcome: r.outcome,
          seconds: r.durationSeconds,
          at: r.startedAt,
        })),
      )}`,
    };
  }

  if (a.action === "optout") {
    if (!ctx.actor.isAdmin) return { error: "only an administrator edits the do-not-call list." };
    return plan(
      "Add a number to the do-not-call list",
      [{ field: "number", from: "not on the list", to: `${a.number}: no bot will call it` }],
      { tool: "phone", op: "optout", number: a.number },
    );
  }

  if (a.action === "attach" || a.action === "reassign") {
    if (!ctx.actor.isAdmin)
      return { error: "only an administrator attaches or moves a phone number." };
    const bots = (await phone.assignableBots(ctx.actor)).filter(
      (b) => b.id === a.bot || norm(b.name) === norm(a.bot),
    );
    const exact = bots.find((b) => b.id === a.bot);
    if (!exact && bots.length > 1)
      return {
        error: `${bots.length} bots are called "${a.bot}": ${bots
          .map((b) => `${b.id} (owner ${b.ownerName})`)
          .join(", ")}. Use the id of one of them.`,
      };
    const target = exact ?? bots[0];
    if (!target) return { error: `no bot called "${a.bot}" that can have a number.` };
    if (target.hasNumber)
      return { error: `${target.name} already has a number or a request for one.` };
    const owner = `${target.name} (${target.kind === "chief" ? "Zetta, " : ""}owner ${target.ownerName})`;
    const e164 = normalizeE164(a.number);
    if (a.action === "attach") {
      if (!e164)
        return { error: "give the number with its country code, for example +1 202 555 0123." };
      const offer = await phone.offer();
      const ready = (offer.providers ?? []).map((p) => p.id);
      if (a.provider && !ready.includes(a.provider))
        return {
          error: `${a.provider} is not set up on this server (set up: ${ready.join(", ") || "none"}).`,
        };
      return plan(
        `Attach ${e164} to ${target.name}`,
        [
          {
            field: "phone number",
            from: "none",
            to: `${e164}, a number already owned at ${a.provider ?? "the provider"}, goes to ${owner}; Zetta routes it to the provider's call handling`,
          },
        ],
        {
          tool: "phone",
          op: "attach",
          botId: target.id,
          number: e164,
          bot: target.name,
          ...(a.provider ? { provider: a.provider } : {}),
        },
      );
    }
    const row = (await phone.list(ctx.actor)).find(
      (r) => r.id === a.number || (e164 !== undefined && r.number === e164),
    );
    if (!row) return { error: `no number ${a.number} is on this server.` };
    if (row.status !== "active" && row.status !== "held")
      return { error: "only a number that is ready or held can be moved." };
    return plan(
      `Move ${row.number} to ${target.name}`,
      [
        { field: "bot", from: row.botName, to: owner },
        {
          field: "owner's number and PIN",
          from: "set by the old owner",
          to: "cleared: the new owner sets their own",
        },
      ],
      { tool: "phone", op: "reassign", id: row.id, botId: target.id, bot: target.name },
    );
  }

  if (a.action === "approve" || a.action === "reject") {
    if (!ctx.actor.isAdmin) return { error: "only an administrator approves a phone number." };
    const rows = (await phone.list(ctx.actor)).filter((r) => r.status === "requested");
    const wanted = a.bot;
    const hit = rows.filter((r) => r.botId === wanted || norm(r.botName) === norm(wanted));
    if (hit.length === 0) return { error: `no request is waiting for "${a.bot}".` };
    const r = hit[0]!;
    return plan(
      a.action === "approve"
        ? `Approve a phone number for ${r.botName}`
        : `Turn down the phone number for ${r.botName}`,
      [
        {
          field: "request",
          from: `${r.country}${r.areaCode ? ` (${r.areaCode})` : ""}, waiting`,
          to:
            a.action === "approve"
              ? "a number is bought now, and costs a monthly fee on the installation's account"
              : "no number is bought; the owner may ask again",
        },
      ],
      { tool: "phone", op: a.action, id: r.id, bot: r.botName },
    );
  }

  const bots = await owned(ctx);
  const wanted = a.bot;
  const hit =
    bots.find((b) => b.id === wanted) ?? bots.filter((b) => norm(b.name) === norm(wanted))[0];
  if (!hit) return { error: `no bot called "${a.bot}". Use a name or id from the list.` };
  const have = await phone.get(ctx.actor, hit.id);

  if (a.action === "get") {
    const offer = await phone.offer();
    return {
      read: `phone.get:\n${JSON.stringify({
        bot: hit.name,
        offered: offer.on && offer.mode !== "off",
        mode: offer.mode,
        countries: offer.countries,
        providers: (offer.providers ?? []).map((p) => p.id),
        defaultProvider: offer.defaultProvider ?? null,
        number: have && {
          number: have.number,
          provider: have.provider,
          country: have.country,
          status: have.status,
          note: have.note,
          inbound: have.inbound,
          outbound: have.outbound,
          ownerNumber: have.ownerNumber,
          pinSet: have.pinSet,
        },
      })}`,
    };
  }

  if (a.action === "request") {
    const offer = await phone.offer();
    if (!offer.on || offer.mode === "off")
      return {
        error:
          "this server does not hand out phone numbers to bots. An administrator can turn it on in Studio > Phone numbers.",
      };
    const country = a.country.toUpperCase();
    if (!offer.countries.includes(country))
      return {
        error: `numbers in ${country} are not offered here. Offered: ${offer.countries.join(", ")}.`,
      };
    if (have && have.status !== "failed" && have.status !== "released")
      return { error: `${hit.name} already has a number or a request for one.` };
    const ready = (offer.providers ?? []).map((p) => p.id);
    if (a.provider && !ready.includes(a.provider))
      return {
        error: `${a.provider} is not set up on this server (set up: ${ready.join(", ") || "none"}).`,
      };
    const via = a.provider ?? offer.defaultProvider ?? ready[0];
    return plan(
      `Give ${hit.name} a phone number`,
      [
        {
          field: "phone number",
          from: "none",
          to:
            offer.mode === "operator_approval"
              ? `a request for a ${country} number${a.area_code ? ` (area ${a.area_code})` : ""} at ${via ?? "the provider"}; an administrator approves it before it is bought`
              : `a ${country} number${a.area_code ? ` (area ${a.area_code})` : ""} is bought now at ${via ?? "the provider"} and costs a monthly fee`,
        },
      ],
      {
        tool: "phone",
        op: "request",
        botId: hit.id,
        country,
        areaCode: a.area_code ?? null,
        ...(a.provider ? { provider: a.provider } : {}),
      },
    );
  }

  if (!have || have.status === "failed") return { error: `${hit.name} has no phone number.` };

  if (a.action === "release")
    return plan(
      `Release the phone number of ${hit.name}`,
      [
        {
          field: "phone number",
          from: have.number ?? "requested",
          to: "released: the number goes back to the provider and cannot be taken back",
        },
      ],
      { tool: "phone", op: "release", botId: hit.id },
    );

  // settings
  const diff = [];
  const patch: Record<string, unknown> = { tool: "phone", op: "settings", botId: hit.id };
  if (a.inbound && a.inbound !== have.inbound) {
    diff.push({ field: "who may call", from: have.inbound, to: a.inbound });
    patch.inbound = a.inbound;
  }
  if (a.outbound && a.outbound !== have.outbound) {
    diff.push({ field: "calls out", from: have.outbound, to: a.outbound });
    patch.outbound = a.outbound;
  }
  if (a.owner_number !== undefined && a.owner_number !== have.ownerNumber) {
    diff.push({
      field: "owner's own number",
      from: have.ownerNumber ?? "none",
      to: a.owner_number ?? "none",
    });
    patch.ownerNumber = a.owner_number;
  }
  if (diff.length === 0) return { error: `${hit.name}'s number already has those settings.` };
  return plan(`Change the phone settings of ${hit.name}`, diff, patch);
}

export async function applyPhone(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const phone = ctx.deps.phone;
  if (!phone) throw new Error("phone numbers are not available on this server.");
  const v = p as {
    op: string;
    id?: string;
    botId?: string;
    country?: string;
    areaCode?: string | null;
    inbound?: "anyone" | "owner_only" | "off";
    outbound?: "on" | "off";
    ownerNumber?: string | null;
    number?: string;
    provider?: "telnyx" | "twilio";
  };
  if (v.op === "request")
    await phone.request(ctx.actor, String(v.botId), {
      country: String(v.country),
      areaCode: v.areaCode,
      ...(v.provider ? { provider: v.provider } : {}),
    });
  else if (v.op === "release") await phone.release(ctx.actor, String(v.botId));
  else if (v.op === "settings")
    await phone.update(ctx.actor, String(v.botId), {
      ...(v.inbound ? { inbound: v.inbound } : {}),
      ...(v.outbound ? { outbound: v.outbound } : {}),
      ...(v.ownerNumber !== undefined ? { ownerNumber: v.ownerNumber } : {}),
    });
  else if (v.op === "approve") await phone.approve(ctx.actor, String(v.id));
  else if (v.op === "reject") await phone.reject(ctx.actor, String(v.id));
  else if (v.op === "attach")
    await phone.attach(ctx.actor, {
      botId: String(v.botId),
      number: String(v.number),
      ...(v.provider ? { provider: v.provider } : {}),
    });
  else if (v.op === "reassign") await phone.reassign(ctx.actor, String(v.id), String(v.botId));
  else if (v.op === "optout") await phone.addOptout(ctx.actor, String(v.number));
  else throw new Error(`unknown phone change ${v.op}`);
}
