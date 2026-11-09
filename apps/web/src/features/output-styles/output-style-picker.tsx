import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { errorMessage, type OutputStyleKey } from "../chat/chat-client";
import { Choice } from "../shared/ui";
import { outputStylesQueries } from "./output-styles-api";

export type StyleChoice = { outputStyle: OutputStyleKey; outputStyleId: string | null };

const DEFAULT_CHOICE: StyleChoice = { outputStyle: "default", outputStyleId: null };
const keyOf = (c: StyleChoice) =>
  c.outputStyle === "custom" && c.outputStyleId ? `custom:${c.outputStyleId}` : c.outputStyle;
const choiceOf = (key: string): StyleChoice =>
  key.startsWith("custom:")
    ? { outputStyle: "custom", outputStyleId: key.slice("custom:".length) }
    : { outputStyle: key as OutputStyleKey, outputStyleId: null };

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

/** One radio tile: a style's name and what it sounds like, with an optional note on who shares it. */
function StyleTile({
  name,
  styleKey,
  title,
  description,
  hint,
  selected,
  onChange,
}: {
  /** Radio group name. */
  name: string;
  styleKey: string;
  title: string;
  description: string;
  hint?: string | undefined;
  /** The key of the chosen style. */
  selected: string;
  onChange: (v: StyleChoice) => void;
}) {
  return (
    <Choice
      name={name}
      value={styleKey}
      checked={selected === styleKey}
      onSelect={(k) => onChange(choiceOf(k))}
      title={title}
    >
      {description}
      {hint && <span className="block text-xs">{hint}</span>}
    </Choice>
  );
}

/** Picks how a bot writes: a built-in style, one of my styles, or one another member shared. */
export function OutputStylePicker({
  value,
  onChange,
  name = "output-style",
}: {
  value: StyleChoice;
  onChange: (v: StyleChoice) => void;
  /** Radio group name: unique per form on the page. */
  name?: string;
}) {
  const { data, error: failure } = useQuery(outputStylesQueries.list());
  const error = failure ? errorMessage(failure) : "";

  if (error && !data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading styles…
      </p>
    );

  const selected = keyOf(value);
  const mine = data.styles.filter((s) => s.mine);
  const shared = data.styles.filter((s) => !s.mine);
  const missing =
    value.outputStyle === "custom" && !data.styles.some((s) => s.id === value.outputStyleId);
  return (
    <div className="space-y-4">
      <Group label="Built-in">
        {data.builtins.map((b) => (
          <StyleTile
            key={b.key}
            name={name}
            styleKey={b.key}
            title={b.name}
            description={b.description}
            selected={selected}
            onChange={onChange}
          />
        ))}
      </Group>
      {mine.length > 0 && (
        <Group label="My styles">
          {mine.map((s) => (
            <StyleTile
              key={s.id}
              name={name}
              styleKey={`custom:${s.id}`}
              title={s.name}
              description={s.description}
              hint={s.scope === "installation" ? "Shared with everyone here." : undefined}
              selected={selected}
              onChange={onChange}
            />
          ))}
        </Group>
      )}
      {shared.length > 0 && (
        <Group label="Shared with me">
          {shared.map((s) => (
            <StyleTile
              key={s.id}
              name={name}
              styleKey={`custom:${s.id}`}
              title={s.name}
              description={s.description}
              hint={`Shared by ${s.ownerName}.`}
              selected={selected}
              onChange={onChange}
            />
          ))}
        </Group>
      )}
      {missing && (
        <p role="status" className="text-sm text-muted-foreground">
          The style this bot uses was removed or is no longer shared with you, so the bot writes in
          the Default style.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => onChange(DEFAULT_CHOICE)}
          >
            Switch to Default
          </button>
        </p>
      )}
    </div>
  );
}

export { DEFAULT_CHOICE };
