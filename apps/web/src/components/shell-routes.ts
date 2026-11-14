import { useRouterState } from "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * The signed-in layout draws the app shell (sidebar and panel) around every page. A route sets this to `false`
     * only for a reason the shell cannot serve, such as a window that must hold one screen alone. Say why next to it.
     */
    shell?: boolean;
  }
}

type MatchLike = { routeId: string; staticData?: { shell?: boolean } };

/** Routes under `routes/_auth` are the signed-in app; everything else (landing, login, onboarding, pairing) is public. */
export const isSignedInRoute = (matches: readonly MatchLike[]) =>
  matches.some((match) => match.routeId.startsWith("/_auth"));

/** A signed-in page gets the shell unless one of its matched routes opts out. */
export const wantsShell = (matches: readonly MatchLike[]) =>
  isSignedInRoute(matches) && matches.every((match) => match.staticData?.shell !== false);

export const useRouteChrome = () =>
  useRouterState({
    select: (state) => ({
      signedIn: isSignedInRoute(state.matches),
      shell: wantsShell(state.matches),
    }),
    structuralSharing: true,
  });
