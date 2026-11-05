import { useState } from "react";

import { Button } from "@/components/ui";
import { Badge } from "../shared/ui";
import { SkillPicker, type PickerItem } from "./skill-picker";
import { WARNING_TEXT, type SkillWarning, type Trust } from "./skills-api";

/** What a bot offered with zetta:skills (apps/server/src/modules/chat/service.ts, proposal kind install_skills). */
export type SkillsOffer = {
  repo: string;
  ref: string;
  trust: Trust | null;
  skills: {
    name: string;
    path: string;
    description: string;
    warnings: SkillWarning[];
    installed: boolean;
  }[];
  preselected: string[];
  /** The bots the chief named for a team build: offered as the first choice. */
  forBots?: { id: string; name: string }[];
};
export type SkillsChoice = { paths: string[]; target: "bot" | "all" | "picked" };

const TRUST_LABEL: Record<Trust, string> = { official: "Official", trusted: "Trusted" };

/**
 * The card where a bot asks to install skills: the person chooses which ones and who gets them. Nothing is installed until they press
 * Install, and "Not now" installs nothing.
 */
export function SkillsInstallCard({
  offer,
  busy,
  error,
  onDecide,
}: {
  offer: SkillsOffer;
  busy: boolean;
  error?: string | undefined;
  onDecide: (approve: boolean, choice?: SkillsChoice) => void;
}) {
  const [selected, setSelected] = useState<string[]>(offer.preselected);
  const named = offer.forBots?.map((b) => b.name).join(", ") ?? "";
  const [target, setTarget] = useState<SkillsChoice["target"]>(named ? "picked" : "bot");
  const targets: SkillsChoice["target"][] = named ? ["picked", "bot", "all"] : ["bot", "all"];
  const targetLabel = (t: SkillsChoice["target"]) =>
    t === "picked" ? named : t === "bot" ? "This bot" : "All bots";
  // Skills the person already has can be chosen too, to give them to more bots.
  const onlyInstalled =
    selected.length > 0 &&
    offer.skills.filter((k) => selected.includes(k.path)).every((k) => k.installed);
  const items: PickerItem[] = offer.skills.map((k) => ({
    key: k.path,
    name: k.name,
    description: k.description,
    href: `https://github.com/${offer.repo}/blob/${offer.ref}/${k.path}`,
    installed: k.installed,
    blocked: k.warnings[0] ? WARNING_TEXT[k.warnings[0]] : undefined,
  }));
  return (
    <section
      aria-label="Install skills?"
      className="space-y-3 rounded-2xl border bg-muted/40 p-5 text-sm"
    >
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Install skills?</h3>
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>
            {offer.repo} · {offer.ref.slice(0, 7)}
          </span>
          {offer.trust ? (
            <Badge tone="success">{TRUST_LABEL[offer.trust]}</Badge>
          ) : (
            <Badge tone="warning">Not on the trusted list</Badge>
          )}
        </p>
      </div>
      <SkillPicker items={items} selected={selected} onChange={setSelected} />
      <div
        role="group"
        aria-label="Who gets it"
        className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
      >
        <span>Who gets it</span>
        <span className="flex gap-1 rounded-full bg-muted p-1">
          {targets.map((t) => (
            <Button
              key={t}
              size="sm"
              type="button"
              variant={target === t ? "outline" : "ghost"}
              aria-pressed={target === t}
              onClick={() => setTarget(t)}
            >
              {targetLabel(t)}
            </Button>
          ))}
        </span>
      </div>
      <p className="text-muted-foreground">
        Bots follow a skill's instructions, so only install ones you trust.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => onDecide(true, { paths: selected, target })}
        >
          {selected.length === 0
            ? "Install"
            : onlyInstalled
              ? `Add ${selected.length} ${selected.length === 1 ? "skill" : "skills"} to ${target === "all" ? "all bots" : target === "picked" ? named : "this bot"}`
              : `Install ${selected.length} ${selected.length === 1 ? "skill" : "skills"}`}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onDecide(false)}>
          Not now
        </Button>
      </div>
    </section>
  );
}
