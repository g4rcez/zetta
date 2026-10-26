import { Bug, BookOpen, ChartLine, Cloud, GitBranch, Globe, KeyRound, Library, ListChecks, Mail, MessageCircle, NotebookText, Plug } from "lucide-react";
import type { ComponentType } from "react";

import chromeDevtools from "./logos/chrome-devtools.png";
import cloudflare from "./logos/cloudflare.png";
import context7 from "./logos/context7.png";
import github from "./logos/github.svg";
import { GoogleLogo } from "./google-connect";
import linear from "./logos/linear.svg";
import notion from "./logos/notion.png";
import playwright from "./logos/playwright.svg";
import posthog from "./logos/posthog.svg";
import sentry from "./logos/sentry.png";
import { RedditLogo } from "./reddit-connect";
import { TelegramLogo } from "./telegram-logo";
import whatsapp from "./logos/whatsapp.svg";

type IconProps = { className?: string; "aria-hidden"?: boolean };

const ICONS: Record<string, ComponentType<IconProps>> = {
  bug: Bug, "bug-play": Bug, "chart-line": ChartLine, cloud: Cloud, "book-open": BookOpen, github: GitBranch, "list-checks": ListChecks, notebook: NotebookText, library: Library, globe: Globe,
  mail: Mail, "message-circle": MessageCircle, telegram: TelegramLogo, reddit: RedditLogo, "key-round": KeyRound,
};

/** Brand marks downloaded from each vendor's own site (favicon / brand asset), keyed by plugin id. `plate` sits a light tile behind marks that are dark-on-transparent. */
const LOGOS: Record<string, { src: string; plate?: boolean }> = {
  sentry: { src: sentry }, posthog: { src: posthog }, cloudflare: { src: cloudflare }, "cloudflare-docs": { src: cloudflare }, github: { src: github, plate: true }, linear: { src: linear },
  notion: { src: notion }, context7: { src: context7 }, playwright: { src: playwright }, "chrome-devtools": { src: chromeDevtools }, whatsapp: { src: whatsapp },
};

/** Logo for a plugin: its vendor's brand mark when we have one, else the lucide icon named by the definition (unknown names fall back to a plug). */
export function PluginIcon({ id, name, className = "size-5" }: { id?: string; name: string; className?: string }) {
  if (id === "google") return <GoogleLogo className={className} />;
  const logo = id ? LOGOS[id] : undefined;
  if (logo) return <img src={logo.src} alt="" aria-hidden draggable={false} loading="lazy" className={`${className} shrink-0 rounded-[22%] object-contain ${logo.plate ? "bg-white p-px" : ""}`} />;
  const Icon = ICONS[name] ?? Plug;
  return <Icon aria-hidden className={className} />;
}
