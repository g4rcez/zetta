import {
  BugIcon,
  BookOpenIcon,
  ChartLineIcon,
  CloudIcon,
  DatabaseIcon,
  GitBranchIcon,
  GlobeIcon,
  HouseIcon,
  KeyIcon,
  BooksIcon,
  ListChecksIcon,
  EnvelopeIcon,
  ChatCircleIcon,
  NotebookIcon,
  PlugIcon,
  PlugsConnectedIcon,
  KanbanIcon,
  WaveformIcon,
  TriangleIcon,
  AppleLogoIcon,
  PaletteIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

import bitwarden from "./logos/bitwarden.svg";
import chromeDevtools from "./logos/chrome-devtools.png";
import cloudflare from "./logos/cloudflare.png";
import composio from "./logos/composio.png";
import context7 from "./logos/context7.png";
import github from "./logos/github.svg";
import { GoogleLogo } from "./google-connect";
import homeassistant from "./logos/homeassistant.svg";
import linear from "./logos/linear.svg";
import notion from "./logos/notion.png";
import onepassword from "./logos/1password.svg";
import playwright from "./logos/playwright.svg";
import postgresql from "./logos/postgresql.svg";
import posthog from "./logos/posthog.svg";
import sentry from "./logos/sentry.png";
import { RedditLogo } from "./reddit-connect";
import { TelegramLogo } from "./telegram-logo";
import whatsapp from "./logos/whatsapp.svg";

type IconProps = { className?: string; "aria-hidden"?: boolean };

const ICONS: Record<string, ComponentType<IconProps>> = {
  bug: BugIcon,
  "bug-play": BugIcon,
  "chart-line": ChartLineIcon,
  cloud: CloudIcon,
  "book-open": BookOpenIcon,
  github: GitBranchIcon,
  "list-checks": ListChecksIcon,
  notebook: NotebookIcon,
  library: BooksIcon,
  globe: GlobeIcon,
  mail: EnvelopeIcon,
  "message-circle": ChatCircleIcon,
  telegram: TelegramLogo,
  reddit: RedditLogo,
  composio: PlugsConnectedIcon,
  "key-round": KeyIcon,
  database: DatabaseIcon,
  kanban: KanbanIcon,
  waveform: WaveformIcon,
  triangle: TriangleIcon,
  "apple-logo": AppleLogoIcon,
  palette: PaletteIcon,
  home: HouseIcon,
};

/** Brand marks downloaded from each vendor's own site (favicon / brand asset), keyed by plugin id. `plate` sits a light tile behind marks that are dark-on-transparent; `corners: "none"` keeps a mark whose own outline is not a square. */
const LOGOS: Record<string, { src: string; plate?: boolean; corners?: "round" | "none" }> = {
  sentry: { src: sentry },
  posthog: { src: posthog },
  cloudflare: { src: cloudflare },
  "cloudflare-docs": { src: cloudflare },
  github: { src: github, plate: true },
  homeassistant: { src: homeassistant, corners: "none" },
  linear: { src: linear },
  notion: { src: notion },
  context7: { src: context7 },
  playwright: { src: playwright },
  "chrome-devtools": { src: chromeDevtools },
  whatsapp: { src: whatsapp },
  composio: { src: composio },
  "1password": { src: onepassword },
  bitwarden: { src: bitwarden },
  postgres: { src: postgresql },
};

/** Logo for a plugin: its vendor's brand mark when we have one, else the icon key named by the definition (unknown names fall back to a plug). */
export function PluginIcon({
  id,
  name,
  className = "size-5",
}: {
  id?: string;
  name: string;
  className?: string;
}) {
  if (id === "google") return <GoogleLogo className={className} />;
  const logo = id ? LOGOS[id] : undefined;
  // No zoom: a decorative logo (alt="").
  if (logo)
    return (
      <img
        src={logo.src}
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        className={`${className} shrink-0 object-contain ${logo.corners === "none" ? "" : "rounded-[22%]"} ${logo.plate ? "bg-white p-px" : ""}`}
      />
    );
  const Icon = ICONS[name] ?? PlugIcon;
  return <Icon aria-hidden className={className} />;
}
