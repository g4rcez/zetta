import { Bug, BookOpen, ChartLine, Cloud, GitBranch, Globe, Library, ListChecks, Mail, MessageCircle, NotebookText, Plug } from "lucide-react";
import type { ComponentType } from "react";

import { TelegramLogo } from "./telegram-logo";

const ICONS: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  bug: Bug, "bug-play": Bug, "chart-line": ChartLine, cloud: Cloud, "book-open": BookOpen, github: GitBranch, "list-checks": ListChecks, notebook: NotebookText, library: Library, globe: Globe,
  mail: Mail, "message-circle": MessageCircle, telegram: TelegramLogo,
};
/** Maps a plugin's icon name (a lucide name, or a brand logo such as "telegram") to a component; unknown names fall back to a plug. */
export function PluginIcon({ name, className = "size-5" }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Plug;
  return <Icon aria-hidden className={className} />;
}
