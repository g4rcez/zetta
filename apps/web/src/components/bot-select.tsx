import { useMemo, useState } from "react";

import { botRole } from "@zetta/core/bot-role";
import { BotAvatar, type AvatarValue } from "@/components/bot-avatar";
import { BotIdentity } from "@/components/bot-identity";
import { Autocomplete } from "@/components/ui";

/** The part of a bot the picker needs. The full `Bot` of the chat client fits. */
export type BotSelectBot = {
  id: string;
  name: string;
  avatar?: AvatarValue | null;
  kind?: "chief" | "specialist";
  role?: string;
  description?: string;
};

/** One option of the list: the bot's avatar, its name and, under it, what it is for. */
function BotOption({ bot }: { bot: BotSelectBot }) {
  return <BotIdentity bot={bot} size={24} sub={botRole(bot)} />;
}

/**
 * Picks ONE of the person's bots. Every option is drawn with `BotIdentity` and its role (`botRole`), never as a plain name, so two bots
 * with similar names can be told apart. Built on the library `Autocomplete` (type to search by name).
 *
 * In a `<form>` it works like the library `Select`: the `Autocomplete` writes the chosen bot id to a hidden input called `name`, so
 * `new FormData(form).get(name)` is the id (an empty string when nothing is chosen), and `required` blocks the submit until one is.
 * Use it controlled (`value` + `onChange`) or uncontrolled (`defaultValue`, read the form on submit).
 */
export function BotSelect({
  bots,
  value,
  defaultValue,
  onChange,
  label,
  name,
  placeholder = "Search a bot",
  disabled,
  required = false,
}: {
  bots: readonly BotSelectBot[];
  /** The chosen bot id; "" is none. Leave it out to let the form hold the value (`defaultValue`). */
  value?: string;
  defaultValue?: string;
  onChange?: (botId: string) => void;
  label: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  // Stable references: the Autocomplete re-reads its options on every change of this list.
  const options = useMemo(
    () =>
      bots.map((bot) => ({
        value: bot.id,
        label: bot.name,
        Render: () => <BotOption bot={bot} />,
      })),
    [bots],
  );
  const chosen = bots.find((b) => b.id === current);
  const pick = (id: string) => {
    setOwn(id);
    onChange?.(id);
  };
  return (
    // The library reports a choice through `onChange`, but a clear (the x button) only fires a bubbling `input` event on its hidden field.
    // `contents` keeps this wrapper out of the parent's layout.
    <div
      className="contents"
      onInput={(e) => {
        const field = e.target as HTMLInputElement;
        if (field.type === "hidden") pick(field.value);
      }}
    >
      <Autocomplete
        title={label}
        name={name}
        placeholder={placeholder}
        emptyMessage="No bot matches"
        required={required}
        disabled={disabled}
        left={chosen ? <BotAvatar bot={chosen} size={20} /> : undefined}
        options={options}
        // Always controlled here: the library warns when it gets a `defaultValue` as well as its own value.
        value={current}
        onChange={(e) => pick(e.target.value)}
      />
    </div>
  );
}
