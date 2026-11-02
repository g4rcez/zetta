import { Autocomplete } from "@/components/ui";
import { isKnownLocale, localeLabel, localeOptions } from "./laya-locales";

/**
 * Language chips and a search box to add more (country + language, with flag). `fixed` chips are always on and cannot be removed.
 * The order of `value` is kept: the first one added stays first.
 */
export function LanguagePicker({
  value,
  onChange,
  locales,
  fixed = [],
  disabled,
}: {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  locales: readonly string[];
  fixed?: readonly string[];
  disabled?: boolean | undefined;
}) {
  const added = [...fixed, ...value.filter((t) => !fixed.includes(t))];
  return (
    <div className="space-y-3">
      <ul aria-label="Languages" className="flex flex-wrap gap-2">
        {added.map((tag) => (
          <li
            key={tag}
            className={`inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 text-xs ${fixed.includes(tag) ? "px-2.5" : "pr-1 pl-2.5"}`}
          >
            {localeLabel(tag)}
            {!fixed.includes(tag) && (
              <button
                type="button"
                aria-label={`Remove ${localeLabel(tag)}`}
                disabled={disabled}
                className="rounded-full px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => onChange(value.filter((t) => t !== tag))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <Autocomplete
        // A new key after each add clears the search box.
        key={added.length}
        title="Add a language"
        placeholder="Search a country or a language"
        emptyMessage="No country or language matches"
        options={localeOptions(added, locales)}
        value=""
        disabled={disabled}
        onChange={(e) => {
          const tag = e.target.value;
          if (isKnownLocale(tag, locales) && !added.includes(tag)) onChange([...value, tag]);
        }}
      />
    </div>
  );
}
