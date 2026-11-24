import { SETTINGS, SETTING_KEYS, parseSettingValue } from "@zetta/core/settings";
import type { SettingKey } from "@zetta/core/settings";
import { SettingsError, type SettingView } from "../../settings/service";
import { norm, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** What the Chief says about a security-policy key: a bot never changes one, the administrator does it in Studio. */
const STUDIO = "Tell the person to open Studio > Server settings and change it there themselves";
const sensitiveRefusal = (label: string) =>
  `"${label}" is security policy: it applies at once to everyone, so only an administrator changes it, in Studio > Server settings, not through a bot. ${STUDIO}.`;

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** A key by its name or by its label ("Light background runs"). */
function find(query: string): { key: SettingKey } | { error: string } {
  const exact = SETTING_KEYS.find((k) => k === query);
  if (exact) return { key: exact };
  const named = SETTING_KEYS.filter((k) => norm(SETTINGS[k].label) === norm(query));
  if (named.length === 1) return { key: named[0]! };
  return { error: `no setting called "${query}". Use a key from the list.` };
}

/**
 * Server settings (modules/settings). Reads answer at once and are for administrators only. A value of a security-policy key is shown by
 * `list` (the Studio page shows it to the same person) and not by `get`; the Chief never changes one: the service would refuse a bot, and
 * this tool refuses first with the sentence that sends the person to Studio. `set` and `reset` are cards, never remembered.
 */
export async function runSetting(ctx: ChiefCtx, a: ChiefArgs<"setting">): Promise<Outcome> {
  const settings = ctx.deps.settings;
  if (!settings) return { error: "server settings are not available on this server." };
  if (!ctx.actor.isAdmin)
    return { error: "only an administrator reads or changes server settings." };
  const { settings: views } = await settings.list(ctx.actor);
  const byKey = new Map<string, SettingView>(views.map((v) => [v.key, v]));

  if (a.action === "list") {
    const rows = views
      .filter((v) => !a.group || v.group === a.group)
      .map((v) => ({
        key: v.key,
        label: v.label,
        group: v.group,
        value: v.value,
        source: v.source,
        securityPolicy: v.sensitive || undefined,
      }));
    return { read: `setting.list:\n${JSON.stringify(rows)}` };
  }

  const found = find(a.key);
  if ("error" in found) return found;
  const key = found.key;
  const def = SETTINGS[key];
  const view = byKey.get(key)!;

  if (a.action === "get") {
    const text = JSON.stringify({
      key,
      label: def.label,
      help: def.help,
      type: def.type,
      default: view.default,
      source: view.source,
      ...(def.sensitive
        ? {
            securityPolicy: true,
            note: `Only an administrator in Studio > Server settings can change it. It applies at once to everyone.`,
          }
        : { value: view.value }),
    });
    return { read: `setting.get:\n${text}` };
  }

  if (def.sensitive) return { error: sensitiveRefusal(def.label) };

  if (a.action === "reset") {
    if (view.source === "default")
      return { error: `"${def.label}" already has its default (${show(view.default)}).` };
    return plan(
      `Put "${def.label}" back to its default`,
      [{ field: def.label, from: show(view.value), to: `${show(view.default)} (the default)` }],
      { tool: "setting", op: "reset", key },
    );
  }

  const parsed = parseSettingValue(key, a.value);
  if (!parsed.ok) return { error: parsed.error };
  if (show(parsed.value) === show(view.value) && view.source !== "default")
    return { error: `"${def.label}" is already ${show(view.value)}.` };
  return plan(
    `Change "${def.label}"`,
    [{ field: def.label, from: show(view.value), to: show(parsed.value) }],
    { tool: "setting", op: "set", key, value: parsed.value },
  );
}

export async function applySetting(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const settings = ctx.deps.settings;
  if (!settings) throw new Error("server settings are not available on this server.");
  const v = p as { op: string; key?: string; value?: unknown };
  const key = String(v.key);
  try {
    // `via: "bot"`: the service itself refuses a security-policy key, whatever this tool decided.
    if (v.op === "set") await settings.set(ctx.actor, key, v.value, { via: "bot" });
    else if (v.op === "reset") await settings.unset(ctx.actor, key, { via: "bot" });
    else throw new Error(`unknown setting change ${v.op}`);
  } catch (e) {
    if (e instanceof SettingsError && e.code === "SENSITIVE")
      throw new Error(sensitiveRefusal(SETTINGS[key as SettingKey]?.label ?? key));
    throw e;
  }
}
