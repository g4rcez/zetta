import { ActionHint } from "@/components/action-hint";
import { Link } from "@tanstack/react-router";

import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const Brand = ({ small = false }: { small?: boolean }) => (
  <ActionHint label="Zetta home">
    <Link to="/" aria-label="Zetta home" className="grid shrink-0 place-items-center">
      <Logo size={small ? 28 : 36} tile />
    </Link>
  </ActionHint>
);

export default function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <Brand small />
        <span className="font-heading text-lg font-medium tracking-tight">Zetta</span>
      </div>
      <div className="flex items-center gap-1">
        <ModeToggle inline />
        <UserMenu inline />
      </div>
    </header>
  );
}
