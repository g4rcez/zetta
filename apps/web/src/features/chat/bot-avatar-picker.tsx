import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  AVATAR_CHARACTERS,
  AVATAR_SHAPES,
  AVATAR_SWATCHES,
  BotAvatar,
  characterOf,
  type AvatarValue,
} from "@/components/bot-avatar";

const SIZE = 128;

/** Crops to a centered square and downsizes so the stored data URL stays small. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
  return canvas.toDataURL("image/webp", 0.85);
}

/** Preset gallery + per-preset color pickers + image upload. Controlled: the parent decides when to save. */
export function BotAvatarPicker({
  botId,
  kind,
  value,
  onChange,
}: {
  botId: string;
  kind?: "chief" | "specialist";
  value: AvatarValue | null | undefined;
  onChange: (v: AvatarValue | null) => void;
}) {
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const character = value?.kind === "preset" ? characterOf(value.preset) : undefined;
  const color =
    value?.kind === "preset" ? (value.colors[0] ?? AVATAR_SWATCHES[0]!) : AVATAR_SWATCHES[0]!;
  const custom = !AVATAR_SWATCHES.includes(color);
  const bot = (avatar: AvatarValue | null) => ({ id: botId, avatar, kind });

  async function upload(f: File | undefined) {
    if (!f) return;
    setError(undefined);
    if (!f.type.startsWith("image/")) return setError("Choose an image file.");
    try {
      onChange({ kind: "image", src: await toDataUrl(f) });
    } catch {
      setError("Could not read that image.");
    }
    if (file.current) file.current.value = "";
  }
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Picture</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar">
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          aria-label={kind === "chief" ? "Zetta logo" : "Generated"}
          title={kind === "chief" ? "Zetta logo" : undefined}
          onClick={() => onChange(null)}
          className={`rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-ring ${!value ? "ring-2 ring-primary" : "hover:bg-muted"}`}
        >
          <BotAvatar bot={bot(null)} size={44} />
        </button>
        {AVATAR_SHAPES.map((p, i) => {
          const on = value?.kind === "preset" && value.preset === p.id;
          // Unselected previews each use their own swatch so shapes are easy to tell apart.
          const shown = on ? color : AVATAR_SWATCHES[i % AVATAR_SWATCHES.length]!;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.label}
              title={p.label}
              onClick={() => onChange({ kind: "preset", preset: p.id, colors: [shown] })}
              className={`rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-ring ${on ? "ring-2 ring-primary" : "hover:bg-muted"}`}
            >
              <BotAvatar bot={bot({ kind: "preset", preset: p.id, colors: [shown] })} size={44} />
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 w-px self-stretch bg-border" />
        {AVATAR_CHARACTERS.map((p) => {
          const on = value?.kind === "preset" && value.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.label}
              title={p.label}
              onClick={() =>
                onChange({
                  kind: "preset",
                  preset: p.id,
                  colors: on ? value.colors : [...p.colors],
                })
              }
              className={`rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-ring ${on ? "ring-2 ring-primary" : "hover:bg-muted"}`}
            >
              <BotAvatar
                bot={bot({
                  kind: "preset",
                  preset: p.id,
                  colors: on ? value.colors : [...p.colors],
                })}
                size={44}
              />
            </button>
          );
        })}
        {value?.kind === "image" && (
          <span className="rounded-xl p-1 ring-2 ring-primary">
            <BotAvatar bot={bot(value)} size={44} />
          </span>
        )}
      </div>
      {value?.kind === "preset" && character && (
        <div className="flex flex-wrap items-center gap-4">
          {character.colorLabels.map((label, i) => (
            <label key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="color"
                aria-label={`${character.label} ${label} color`}
                value={value.colors[i] ?? character.colors[i]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    colors: character.colors.map((d, j) =>
                      j === i ? e.target.value : (value.colors[j] ?? d),
                    ),
                  })
                }
                className="size-7 cursor-pointer rounded border bg-transparent p-0"
              />
              {label}
            </label>
          ))}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onChange({ ...value, colors: [...character.colors] })}
          >
            Reset colors
          </Button>
        </div>
      )}
      {value?.kind === "preset" && !character && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
          {AVATAR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              onClick={() => onChange({ ...value, colors: [c] })}
              className={`size-7 rounded-full focus-visible:outline-2 focus-visible:outline-ring ${color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`relative size-7 rounded-full has-focus-visible:outline-2 has-focus-visible:outline-ring ${custom ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
              // A rainbow wheel until a color is picked, then the picked color.
              style={{
                background: custom
                  ? color
                  : "radial-gradient(circle, #fff, transparent 65%), conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
              }}
            >
              <input
                type="color"
                aria-label="Custom color"
                value={color}
                onChange={(e) => onChange({ ...value, colors: [e.target.value] })}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </span>
            Custom
          </label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          // Hidden behind the "Upload picture" button, and out of the tab order so keyboard users meet the button once.
          tabIndex={-1}
          aria-label="Upload picture"
          id={`avatar-upload-${botId}`}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => file.current?.click()}>
          Upload picture
        </Button>
        {value?.kind === "image" && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
