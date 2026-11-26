import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SETTING_GROUPS, type SettingGroup } from "@zetta/core/settings";
import { useState, type FormEvent } from "react";

import { Button, Checkbox, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import {
  settingsApi,
  settingsQueries,
  type SettingItem,
  type SettingSource,
  type SettingValue,
} from "./settings-api";
import {
  SETTING_GROUP_FILTERS,
  filterSettings,
  type SettingsSearch,
  type SettingsShow,
} from "./settings-filters";
import { UpdateCheckSetting } from "./update-check-setting";

type How = "push" | "replace";
type Draft = string | string[];
type Step = "edit" | "confirm";

const SOURCE_TEXT: Record<SettingSource, string> = {
  organization: "Set for this organization",
  installation: "Set for the installation",
  imported: "Imported from the environment when the server was upgraded",
  default: "The default",
};
const GROUP_OPTIONS = [
  { value: "all", label: "All groups" },
  ...SETTING_GROUP_FILTERS.map((g) => ({ value: g, label: SETTING_GROUPS[g] })),
];
const SHOW_OPTIONS = [
  { value: "all", label: "All settings" },
  { value: "changed", label: "Only changed" },
];

const initialDraft = (s: SettingItem): Draft =>
  s.type === "integer" ? String(s.value) : Array.isArray(s.value) ? [...s.value] : String(s.value);
const toValue = (s: SettingItem, d: Draft): SettingValue => (s.type === "integer" ? Number(d) : d);
/** A value as a person reads it. */
const readable = (v: SettingValue, unit?: string) =>
  Array.isArray(v)
    ? v.length === 0
      ? "None"
      : v.join(", ")
    : v === "on"
      ? "On"
      : v === "off"
        ? "Off"
        : unit
          ? `${v} ${unit}`
          : String(v);
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type ListProps = {
  item: SettingItem;
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
};
/** The entries of a list setting: tick the allowed names, or edit the entries one by one and add more. */
function ListEditor({ item, value, disabled, onChange }: ListProps) {
  const [adding, setAdding] = useState("");
  if (item.options)
    return (
      <fieldset className="space-y-1" disabled={disabled}>
        <legend className="sr-only">{item.label}</legend>
        {item.options.map((option) => (
          <Checkbox
            key={option}
            name={`${item.key}:${option}`}
            checked={value.includes(option)}
            onChange={(e) =>
              onChange(
                item.options!.filter((o) => (o === option ? e.target.checked : value.includes(o))),
              )
            }
          >
            {option}
          </Checkbox>
        ))}
      </fieldset>
    );
  const add = () => {
    const entry = adding.trim();
    if (!entry) return;
    onChange([...value, entry]);
    setAdding("");
  };
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-muted-foreground">No entries.</p>}
      {value.map((entry, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              title={`Entry ${i + 1}`}
              name={`${item.key}.${i}`}
              autoComplete="off"
              disabled={disabled}
              value={entry}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            Remove entry {i + 1}
          </Button>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            title="New entry"
            name={`${item.key}.new`}
            autoComplete="off"
            disabled={disabled}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              add();
            }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || !adding.trim()}
          onClick={add}
        >
          Add entry
        </Button>
      </div>
    </div>
  );
}

type ControlProps = { item: SettingItem; draft: Draft; disabled: boolean; set: (d: Draft) => void };
/** The control that fits the setting's type. */
function Control({ item, draft, disabled, set }: ControlProps) {
  switch (item.type) {
    case "switch":
      return (
        <Checkbox
          name={item.key}
          checked={draft === "on"}
          disabled={disabled}
          onChange={(e) => set(e.target.checked ? "on" : "off")}
        >
          {draft === "on" ? "On" : "Off"}
        </Checkbox>
      );
    case "integer":
      return (
        <div className="space-y-1">
          <Input
            title={item.unit ? `Value (${item.unit})` : "Value"}
            name={item.key}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            min={item.min}
            max={item.max}
            value={String(draft)}
            onChange={(e) => set(e.target.value)}
          />
          {item.min !== undefined && item.max !== undefined && (
            <p className="text-xs text-muted-foreground">
              Between {item.min} and {item.max}.
            </p>
          )}
        </div>
      );
    case "choice":
      return (
        <Select
          title="Value"
          name={item.key}
          required={false}
          disabled={disabled}
          value={String(draft)}
          options={(item.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "list":
      return (
        <ListEditor
          item={item}
          value={Array.isArray(draft) ? draft : []}
          disabled={disabled}
          onChange={set}
        />
      );
    default:
      return (
        <Input
          title="Value"
          name={item.key}
          autoComplete="off"
          disabled={disabled}
          maxLength={item.maxLength}
          value={String(draft)}
          onChange={(e) => set(e.target.value)}
        />
      );
  }
}

type RowProps = {
  item: SettingItem;
  busy: boolean;
  error: string | undefined;
  notice: string | undefined;
  onSave: (item: SettingItem, value: SettingValue) => void;
  onReset: (item: SettingItem) => void;
  /** Shown, not changed: the setting is decided for the whole server and the person looking is not the one who decides it. */
  locked: boolean;
};

/** A setting of the whole server, and every security policy, is changed only by the person who set the server up. */
export const rootOnly = (item: Pick<SettingItem, "scope" | "sensitive">) =>
  item.scope === "installation" || item.sensitive;

function SettingRow({ item, busy, error, notice, onSave, onReset, locked }: RowProps) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item));
  const [step, setStep] = useState<Step>("edit");
  const dirty = !sameDraft(draft, initialDraft(item));
  const empty = item.type === "integer" && String(draft).trim() === "";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || empty || locked) return;
    // A security policy changes the behaviour for everyone at once: it asks first.
    if (item.sensitive && step === "edit") return setStep("confirm");
    onSave(item, toValue(item, draft));
  }
  return (
    <li className="rounded-lg border p-4">
      <form aria-label={item.label} noValidate className="space-y-3" onSubmit={submit}>
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{item.label}</h4>
          <p className="text-xs text-pretty text-muted-foreground">{item.help}</p>
          {item.sensitive && (
            <p className="text-xs text-pretty font-medium text-[var(--var-color-warn)]">
              Security policy: changes apply at once to everyone.
            </p>
          )}
        </div>
        <Control
          item={item}
          draft={draft}
          disabled={busy || locked || step === "confirm"}
          set={(d) => setDraft(d)}
        />
        <p className="text-xs text-muted-foreground">
          Now: {readable(item.value, item.unit)}. {SOURCE_TEXT[item.source]}
          {item.source === "default" ? "" : `; the default is ${readable(item.default, item.unit)}`}
          .
        </p>
        {step === "confirm" ? (
          <div role="alertdialog" aria-label={`Confirm ${item.label}`} className="space-y-2">
            <p className="text-sm text-pretty">
              {item.label} is a security policy. Saving {readable(toValue(item, draft), item.unit)}{" "}
              applies at once to everyone on this server. Save it?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => onSave(item, toValue(item, draft))}
              >
                Save for everyone
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setStep("edit")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : locked ? (
          <p className="text-xs text-pretty text-muted-foreground">
            Decided for the whole server. Only the person who set the server up changes it.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty || empty}>
              Save
            </Button>
            {item.source !== "default" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onReset(item)}
              >
                Reset to default
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </form>
    </li>
  );
}

type FiltersProps = { search: SettingsSearch; setSearch: (next: SettingsSearch, how: How) => void };
function Filters({ search, setSearch }: FiltersProps) {
  return (
    <form
      aria-label="Filter the settings"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <Select
        title="Group"
        name="group"
        required={false}
        value={search.group ?? "all"}
        options={GROUP_OPTIONS}
        onChange={(e) => {
          const { group: _drop, ...rest } = search;
          const v = e.target.value as SettingGroup | "all";
          setSearch(v === "all" ? rest : { ...rest, group: v }, "push");
        }}
      />
      <Select
        title="Show"
        name="show"
        required={false}
        value={search.show ?? "all"}
        options={SHOW_OPTIONS}
        onChange={(e) => {
          const { show: _drop, ...rest } = search;
          const v = e.target.value as SettingsShow;
          setSearch(v === "changed" ? { ...rest, show: "changed" } : rest, "push");
        }}
      />
      <Input
        title="Search"
        name="q"
        autoComplete="off"
        value={search.q ?? ""}
        placeholder="A name or a word from its help"
        onChange={(e) => {
          const { q: _drop, ...rest } = search;
          setSearch(e.target.value ? { ...rest, q: e.target.value } : rest, "replace");
        }}
      />
    </form>
  );
}

type PageProps = {
  /** Administrators only: anyone else sees a sentence and nothing is asked of the server. */
  admin: boolean;
  /** The person who set the server up. Another administrator changes only what a workspace may have of its own. */
  root: boolean;
  search: SettingsSearch;
  setSearch: (next: SettingsSearch, how: How) => void;
};

/**
 * The server settings of the installation, for administrators: every key of the registry (@zetta/core/settings) grouped, with the value
 * that counts and where it comes from, saved one key at a time. The filters live in the address (`search`).
 */
export function ServerSettingsPage({ admin, root, search, setSearch }: PageProps) {
  const list = useQuery({ ...settingsQueries.list(), enabled: admin });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ key: string; text: string }>();
  const [updateError, setUpdateError] = useState<string>();
  function run(item: SettingItem, work: () => Promise<unknown>, text: string) {
    setBusy(true);
    setErrors(({ [item.key]: _gone, ...rest }) => rest);
    setNotice(undefined);
    work()
      .then(() => setNotice({ key: item.key, text }))
      .catch((e) => setErrors((all) => ({ ...all, [item.key]: errorMessage(e) })))
      .finally(() => setBusy(false));
  }
  if (!admin)
    return (
      <p className="text-sm text-muted-foreground">
        Only administrators manage the settings of this server.
      </p>
    );
  const intro = (
    <p className="text-sm text-pretty text-muted-foreground">
      These apply to the whole installation. When workspaces exist, each organization can narrow or
      override the keys that allow it.
    </p>
  );
  if (list.isPending)
    return (
      <div className="space-y-4">
        {intro}
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      </div>
    );
  if (list.isError)
    return (
      <div className="space-y-4">
        {intro}
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(list.error)}
        </p>
      </div>
    );
  const all = list.data.settings;
  const shown = filterSettings(all, search);
  const filtered = Boolean(search.group || search.show || search.q);
  const groups = (Object.keys(list.data.groups) as SettingGroup[]).filter((g) =>
    shown.some((s) => s.group === g),
  );
  return (
    <div className="space-y-6">
      {intro}
      {!root && (
        <p className="text-sm text-pretty text-muted-foreground">
          You administer this workspace. The settings of the whole server and its security policy
          are shown here and changed by the person who set the server up.
        </p>
      )}
      <UpdateCheckSetting onError={setUpdateError} />
      {updateError && (
        <p role="alert" className="text-sm text-destructive">
          {updateError}
        </p>
      )}
      <Filters search={search} setSearch={setSearch} />
      <p className="text-xs text-muted-foreground" role="status">
        {shown.length === all.length
          ? `${all.length} settings`
          : `${shown.length} of ${all.length} settings`}
      </p>
      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No setting matches.{" "}
          {filtered && (
            <Link to="/studio/$tab" params={{ tab: "settings" }} search={{}} className="underline">
              Clear the filters
            </Link>
          )}
        </p>
      )}
      {groups.map((g) => (
        <section key={g} aria-label={list.data.groups[g]} className="space-y-3">
          <h3 className="text-sm font-medium">{list.data.groups[g]}</h3>
          <ul className="space-y-3">
            {shown
              .filter((s) => s.group === g)
              .map((s) => (
                <SettingRow
                  key={`${s.key}:${JSON.stringify(s.value)}:${s.source}`}
                  item={s}
                  busy={busy}
                  error={errors[s.key]}
                  notice={notice?.key === s.key ? notice.text : undefined}
                  locked={!root && rootOnly(s)}
                  onSave={(item, value) =>
                    run(item, () => settingsApi.save(item.key, value), "Saved.")
                  }
                  onReset={(item) =>
                    run(item, () => settingsApi.reset(item.key), "Back to the default.")
                  }
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
