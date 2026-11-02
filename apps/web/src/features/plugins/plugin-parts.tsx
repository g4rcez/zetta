import { useCallback, useState } from "react";

import { Input, Select, Textarea } from "@/components/ui";
import { ASSIST_LOCALES } from "../studio/laya-locales";
import { LanguagePicker } from "../studio/language-picker";
import { errorMessage } from "../chat/chat-client";
import { pluginsApiFor, type PluginField, type PluginScope, type PluginTest } from "./plugins-api";

export type Probe = PluginTest | "loading";

/** The key of one configuration's check: the user's own is the plugin id, the team's is prefixed. */
export const probeKey = (id: string, scope: PluginScope = "mine") =>
  scope === "team" ? `team:${id}` : id;

/** Connection checks by plugin id (and configuration), shared by the Studio list and the plugin page. */
export function useProbes() {
  const [probes, setProbes] = useState<Record<string, Probe | undefined>>({});
  const probe = useCallback(async (id: string, scope: PluginScope = "mine") => {
    const key = probeKey(id, scope);
    setProbes((p) => ({ ...p, [key]: "loading" }));
    try {
      const r = await pluginsApiFor(scope).test(id);
      setProbes((p) => ({ ...p, [key]: r }));
    } catch (e) {
      setProbes((p) => ({
        ...p,
        [key]: { status: { state: "error", detail: errorMessage(e) }, tools: [] },
      }));
    }
  }, []);
  const forget = useCallback(
    (id: string, scope: PluginScope = "mine") =>
      setProbes(({ [probeKey(id, scope)]: _gone, ...rest }) => rest),
    [],
  );
  return { probes, probe, forget };
}

export function StatusBadge({ probe }: { probe?: Probe | undefined }) {
  if (!probe)
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Not tested
      </span>
    );
  if (probe === "loading")
    return (
      <span role="status" className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Checking...
      </span>
    );
  const { state } = probe.status;
  const label =
    state === "connected" ? "Connected" : state === "needs-auth" ? "Needs sign-in" : "Error";
  return (
    <span
      title={probe.status.detail}
      className={`rounded px-1.5 py-0.5 text-xs ${state === "connected" ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive"}`}
    >
      {label}
    </span>
  );
}

/** One config field of a plugin. When `editing`, nothing is required and a select starts on "keep", because stored values are never sent back. */
export function FieldInput({
  field: f,
  editing = false,
}: {
  field: PluginField;
  editing?: boolean;
}) {
  const required = !editing && !f.optional;
  if (f.kind === "languages") return <LanguagesField field={f} />;
  if (f.kind === "textarea")
    return (
      // Plain on purpose: plugin setup values (lists, keys, JSON), not text for people or bots.
      <Textarea
        title={f.label}
        name={f.key}
        required={required}
        placeholder={f.placeholder}
        info={f.help}
      />
    );
  if (f.kind === "select")
    return (
      <Select
        title={f.label}
        name={f.key}
        required={false}
        info={f.help}
        options={[
          ...(editing ? [{ value: "", label: "Keep current setting" }] : []),
          ...(f.options ?? []),
        ]}
      />
    );
  return (
    <Input
      title={f.label}
      name={f.key}
      required={required}
      placeholder={f.placeholder}
      info={f.help}
      type={f.secret || f.kind === "password" ? "password" : f.kind === "url" ? "url" : "text"}
      autoComplete="off"
    />
  );
}

/** A list of languages, sent as one comma separated value ("pt-BR,en"); the order is the order they are tried. */
function LanguagesField({ field: f }: { field: PluginField }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{f.label}</p>
      <input type="hidden" name={f.key} value={tags.join(",")} />
      <LanguagePicker value={tags} onChange={setTags} locales={ASSIST_LOCALES} />
      {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
    </div>
  );
}
