import { Link } from "@tanstack/react-router";

import { Badge } from "../shared/ui";
import type { BotOrigin } from "../chat/chat-client";

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

/**
 * Where an imported bot came from: who made it, a link to the original, and the outside apps it was built to use, each with the Zetta
 * plugin that does the same job (or a plain "no Zetta equivalent"). Shown in the bot's settings only when the bot was imported.
 */
export function BotOriginSection({ origin }: { origin: BotOrigin }) {
  const when = dateOf(origin.importedAt);
  return (
    <div className="space-y-4 text-sm">
      <p>
        Imported from the Grok Bot marketplace, made by{" "}
        <span className="font-medium">{origin.creator || "an unknown creator"}</span>
        {when ? `, on ${when}` : ""}.{" "}
        <a
          href={origin.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          See the original
        </a>
        .
      </p>
      {origin.integrations.length > 0 && (
        <section aria-label="What it was built to use">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            It was built to use
          </h3>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {origin.integrations.map((i) => (
              <li key={i.name} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{i.name}</p>
                  {i.description && (
                    <p className="text-xs text-muted-foreground">{i.description}</p>
                  )}
                </div>
                {i.pluginId ? (
                  <Link
                    to="/plugins/$pluginId"
                    params={{ pluginId: i.pluginId }}
                    className="shrink-0 underline underline-offset-2"
                  >
                    Set up {i.pluginId}
                  </Link>
                ) : (
                  <Badge>No Zetta equivalent</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
