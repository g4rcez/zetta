import type { ReactNode, Ref } from "react";

import { Logo } from "@/components/logo";

/**
 * The frame of the sign-in and create-account screens: the robot, one heading and a short line, centered in a card on the
 * content ground. The library's fields draw their own `<fieldset>` with `margin: 0`, which beats Tailwind's `space-y-*`
 * margins, so the groups inside use `flex` with `gap`.
 */
export function AuthCard({
  title,
  description,
  headingRef,
  children,
}: {
  title: string;
  description: string;
  headingRef: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-8">
      <section className="flex w-full max-w-sm flex-col gap-8 rounded-xl border bg-card p-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Logo size={56} />
          <div className="flex flex-col gap-1">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight text-balance outline-none"
            >
              {title}
            </h1>
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}

/** A failed attempt: a destructive 10% tint with colored text, next to the button that was pressed. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </p>
  );
}
