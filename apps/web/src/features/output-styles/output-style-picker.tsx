import { useEffect, useState, type ReactNode } from "react";
import { errorMessage, type OutputStyleKey } from "../chat/chat-client";
import { Choice } from "../shared/ui";
import { outputStylesApi, type BuiltinStyle, type OutputStyle } from "./output-styles-api";

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
  const [data, setData] = useState<{ builtins: BuiltinStyle[]; styles: OutputStyle[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    outputStylesApi.list().then(
      (d) => live && setData(d),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  if (error)
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
  const tile = (key: string, title: string, description: string, hint?: string) => (
    <Choice
      key={key}
      name={name}
      value={key}
      checked={selected === key}
      onSelect={(k) => onChange(choiceOf(k))}
      title={title}
    >
      {description}
      {hint && <span className="block text-xs">{hint}</span>}
    </Choice>
  );
  const mine = data.styles.filter((s) => s.mine);
  const shared = data.styles.filter((s) => !s.mine);
  const missing =
    value.outputStyle === "custom" && !data.styles.some((s) => s.id === value.outputStyleId);
  return (
    <div className="space-y-4">
      <Group label="Built-in">{data.builtins.map((b) => tile(b.key, b.name, b.description))}</Group>
      {mine.length > 0 && (
        <Group label="My styles">
          {mine.map((s) =>
            tile(
              `custom:${s.id}`,
              s.name,
              s.description,
              s.scope === "installation" ? "Shared with everyone here." : undefined,
            ),
          )}
        </Group>
      )}
      {shared.length > 0 && (
        <Group label="Shared with me">
          {shared.map((s) =>
            tile(`custom:${s.id}`, s.name, s.description, `Shared by ${s.ownerName}.`),
          )}
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
