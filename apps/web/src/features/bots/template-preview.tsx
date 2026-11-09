import { CheckIcon } from "@phosphor-icons/react";

import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui";
import { Badge } from "../shared/ui";
import { PluginIcon } from "../plugins/plugin-icon";
import {
  TEMPLATE_CATEGORIES,
  templateSettings,
  templateSteps,
  type BotTemplate,
} from "./bot-templates";

/** What the engine will be if the person creates the bot right away. */
export type TemplateEngine = { label: string; ready: boolean };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title} className="space-y-2">
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * Everything a template sets up, beside the gallery: what the bot does, the settings it switches on, plugins that help,
 * and first messages to try. Two ways on: create it as shown, or take it into the wizard and change it first.
 */
export function TemplatePreview({
  template,
  engine,
  tools,
  busy,
  onCreate,
  onCustomize,
}: {
  template: BotTemplate;
  engine: TemplateEngine;
  /** The template's plugins with their catalog names, required ones first. */
  tools: { id: string; name: string; why: string; need: "required" | "suggested" }[];
  busy: boolean;
  onCreate: () => void;
  onCustomize: () => void;
}) {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === template.category)?.label;
  return (
    <section
      aria-label={`${template.title} template`}
      className="space-y-5 rounded-lg border bg-card p-5 text-sm"
    >
      <header className="flex items-start gap-3">
        <BotAvatar
          bot={{ id: template.id, avatar: template.avatar }}
          size={48}
          square
          className="shrink-0"
        />
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{template.title}</h2>
          <p className="text-xs text-muted-foreground">{category}</p>
          <p className="mt-1.5 text-pretty text-muted-foreground">{template.description}</p>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <Button type="button" disabled={busy} onClick={onCreate}>
          {busy ? "Creating…" : `Create ${template.title}`}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCustomize}>
          Customize first
        </Button>
        <p className="text-xs text-muted-foreground">
          {engine.ready
            ? `Runs on ${engine.label}.`
            : `${engine.label} gives canned replies. Pick another engine under Customize, or later in its settings.`}
        </p>
      </div>

      <Section title="What it will do">
        <ul className="space-y-1.5">
          {templateSteps(template).map((s) => (
            <li key={s} className="flex gap-2 text-pretty">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Set up for you">
        <dl className="divide-y border-y">
          {templateSettings(template).map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {tools.length > 0 && (
        <Section title={tools.some((t) => t.need === "required") ? "Plugins" : "Works well with"}>
          <ul className="space-y-2">
            {tools.map((t) => (
              <li key={t.id} className="flex items-start gap-2.5">
                <PluginIcon id={t.id} name={t.name} className="mt-0.5 size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    {t.name}
                    {t.need === "required" && <Badge tone="warning">Required</Badge>}
                  </span>
                  <span className="block text-xs text-pretty text-muted-foreground">{t.why}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Plugins use your own sign-in, so you connect them after the bot exists. A required
            plugin is one it cannot do its job without.
          </p>
        </Section>
      )}

      <Section title="Try asking">
        <ul className="space-y-1.5 text-pretty text-muted-foreground">
          {template.starters.map((s) => (
            <li key={s}>“{s}”</li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
