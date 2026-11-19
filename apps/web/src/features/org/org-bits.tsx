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
import { botRole } from "@zetta/core/bot-role";
import { ORG_RANK_LABELS, type OrgRank } from "@zetta/core/org";
import type { OrgIcon } from "@zetta/core/org-templates";

import { BotIdentity } from "@/components/bot-identity";
import { IconHint } from "@/components/icon-hint";
import { PersonIdentity } from "@/components/person-identity";
import { cn } from "@zetta/ui/lib/utils";
import type { OrgPosition, OrgProblem } from "./org-api";
import { holderLine } from "./org-graph";
import { useQuery } from "@tanstack/react-query";
import type { AvatarValue as BotAvatarValue } from "@/components/bot-avatar";
import { chatQueries } from "../chat/chat-queries";

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
/**
 * The pictures of the bots this person can see, whole. The chart leaves out a large uploaded picture to stay small, so a seat would show
 * the plain fallback for a bot whose picture the rest of the app shows: this hands back the full one by bot id.
 */
export function useBotAvatars(): (
  botId: string,
  fallback: BotAvatarValue | null,
) => BotAvatarValue | null {
  const bots = useQuery(chatQueries.bots()).data;
  return (botId, fallback) => bots?.find((b) => b.id === botId)?.avatar ?? fallback;
}

export function SeatHolder({
  item,
  size = 24,
  className,
}: {
  item: Pick<OrgPosition, "holder" | "problem">;
  size?: number;
  className?: string;
}) {
  const avatarOf = useBotAvatars();
  const h = item.holder;
  if (h?.kind === "bot")
    return (
      <BotIdentity
        bot={{ id: h.botId, name: h.name, avatar: avatarOf(h.botId, h.avatar) }}
        size={size}
        // The seat title is already printed beside the holder, so it is not the fallback here.
        sub={
          h.private && !h.mine
            ? "Private bot: only its owner can talk to it"
            : botRole({ role: h.role, description: h.description })
        }
        trailing={
          h.private ? (
            <span className="shrink-0 rounded border px-1 text-xs font-normal text-muted-foreground">
              {h.mine ? "Private to you" : "Private"}
            </span>
          ) : undefined
        }
        className={className}
      />
    );
  if (h?.kind === "person")
    return (
      <PersonIdentity
        // A seat on the chart and a row of the list have a fixed height: only the big form (the seat's own page) adds the job title.
        person={{ name: h.name, avatar: h.avatar, title: size >= 32 ? h.jobTitle : undefined }}
        size={size}
        className={cn("gap-2", className)}
      />
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
