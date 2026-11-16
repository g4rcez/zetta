import {
  BriefcaseIcon,
  BugIcon,
  ChartBarIcon,
  CodeIcon,
  CoinsIcon,
  CompassIcon,
  CrownIcon,
  FlagIcon,
  GearIcon,
  HandshakeIcon,
  HeadsetIcon,
  MegaphoneIcon,
  PaletteIcon,
  PencilIcon,
  ScalesIcon,
  ShieldIcon,
  StarIcon,
  TerminalIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react";
import { ORG_RANK_LABELS, type OrgRank } from "@zetta/core/org";
import type { OrgIcon } from "@zetta/core/org-templates";

import { BotIdentity } from "@/components/bot-identity";
import { IconHint } from "@/components/icon-hint";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@zetta/ui/lib/utils";
import type { OrgPosition, OrgProblem } from "./org-api";
import { holderLine } from "./org-graph";

const GLYPHS: Record<OrgIcon, Icon> = {
  briefcase: BriefcaseIcon,
  code: CodeIcon,
  palette: PaletteIcon,
  "chart-bar": ChartBarIcon,
  megaphone: MegaphoneIcon,
  headset: HeadsetIcon,
  scales: ScalesIcon,
  users: UsersIcon,
  coins: CoinsIcon,
  compass: CompassIcon,
  shield: ShieldIcon,
  gear: GearIcon,
  pencil: PencilIcon,
  bug: BugIcon,
  terminal: TerminalIcon,
  handshake: HandshakeIcon,
};

/** The picture of a role template. Decorative: the title is always written next to it. */
export function RoleGlyph({ icon, className }: { icon: OrgIcon; className?: string }) {
  const Glyph = GLYPHS[icon];
  return <Glyph aria-hidden="true" className={cn("size-4 shrink-0", className)} />;
}

const RANK_ICONS: Partial<Record<OrgRank, Icon>> = {
  ceo: CrownIcon,
  executive: StarIcon,
  lead: FlagIcon,
};

/** The mark of a seat that leads: a crown for the CEO, a star for an executive, a flag for a team leader. A member has none. */
export function RankMark({ rank }: { rank: OrgRank }) {
  const Mark = RANK_ICONS[rank];
  if (!Mark) return null;
  return (
    <IconHint label={ORG_RANK_LABELS[rank]}>
      <Mark className="size-4 shrink-0 text-warn" />
    </IconHint>
  );
}

/** What a person reads when a seat shows as open although somebody was put in it. */
export function problemText(p: OrgProblem): string {
  if (p.code === "member_removed") return `${p.was} is no longer a member, so this seat is open.`;
  if (p.code === "bot_private")
    return p.mine
      ? `Your bot ${p.was} is private again, so it left this seat. Share it with the team to put it back.`
      : `${p.was} is not shared with the team any more, so this seat is open.`;
  if (p.code === "bot_archived") return `${p.was} was archived, so this seat is open.`;
  return `${p.was} is gone, so this seat is open.`;
}

/**
 * Whoever holds a seat, drawn by face: a person with their picture, a bot with its avatar and name (never a bare name), or a dashed
 * circle for a seat nobody holds.
 */
export function SeatHolder({
  item,
  size = 24,
  className,
}: {
  item: Pick<OrgPosition, "holder" | "problem">;
  size?: number;
  className?: string;
}) {
  const h = item.holder;
  if (h?.kind === "bot")
    return (
      <BotIdentity
        bot={{ id: h.botId, name: h.name, avatar: h.avatar }}
        size={size}
        className={className}
      />
    );
  if (h?.kind === "person")
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)}>
        <UserAvatar name={h.name} avatar={h.avatar} size={size} />
        <span className="min-w-0 truncate text-sm font-medium">{h.name}</span>
      </span>
    );
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-muted-foreground", className)}>
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full border border-dashed"
      />
      <span className="min-w-0 truncate text-sm">{holderLine(item)}</span>
    </span>
  );
}
