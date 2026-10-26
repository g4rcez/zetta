# RFC-004f4: Verify identity web and repair theme/header behavior

Parent: [004f](004f-connect-enrollment-status-and-login.md). Status: review; theme and responsive header corrections verified in the actual browser. This bounded slice is authorized by the user's v1 continuation and coordinator assignment. It does not complete identity enrollment or access acceptance.

## UI review

- Loading: theme initialization is local; existing identity loading states are unchanged.
- Empty: no data list; Light, Dark and System remain available.
- Errors: preserve the native provider's storage-failure fallback; remove the observed executable-script mismatch.
- Optimistic: immediate local theme state, no server mutation or rollback.
- Pagination: not applicable.
- Auth visibility: appearance remains available before signin and grants no account authority.
- Accessibility: keep the labelled keyboard-accessible shared dropdown, focus behavior and theme feedback. No modal or new dynamic region.
- Micro-interactions: keep native system preference, persisted selection, color-scheme and transition suppression. No added motion.

No blocking product decisions were identified. The existing shared theme wrapper, header and account menu are the only product files changed; there is no new dependency or provider implementation.

## Reproduction and root cause

Before this change the coordinator's actual local browser emitted `Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client...` on loading `/login`. It was independently visible in the local development server console stream and browser error capture.

Installed source establishes the precise mismatch:

- `apps/web/src/main.tsx` mounts with `ReactDOM.createRoot`; this is a client-rendered SPA, with no server-rendered theme bootstrap.
- Installed `next-themes` 0.4.6 `dist/index.mjs` always returns its inline executable ThemeScript. Its existing `useEffect` separately applies the chosen theme, and its media/storage listeners implement later changes.
- Installed React/ReactDOM 19.3.1 `react-dom-client.development.js` script creation branch deliberately makes client-inserted scripts inert and emits this warning for executable script types. Its `isScriptDataBlock` path accepts non-executable types.

This is pre-existing library composition behavior, unrelated to the newly added identity requests. No auth storage was inspected.

## Change

`apps/web/src/components/theme-provider.tsx` now passes `scriptProps.type = "text/plain"` after preserving other caller script attributes. This explicitly disables the unused SSR bootstrap in the SPA. Native next-themes context, storage, system listeners and client theme effects remain responsible for appearance. This does not suppress console methods or filter diagnostics. The short comment records the otherwise surprising SPA-only configuration; an SSR migration must revisit it.

Source SHA-256: `fa510319d7045b30e50a8525f0915848001c8ae59075c9d38eadd20d3ef12d8d`.

## Verification

All commands below completed with exit 0:

```sh
# workdir apps/web
bun --no-env-file run build
# workdir repository root
bun --no-env-file apps/web/node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
bun --no-env-file apps/web/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext,dom --jsx react-jsx --esModuleInterop --verbatimModuleSyntax --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/web/src/components/theme-provider.tsx
```

Production build transformed 2530 modules. Source LSP diagnostics: none. The optional no-excuse script remains unavailable under the known repository TypeScript 6 versus script TypeScript 7 unstable-API mismatch; no success is claimed for it. No new implementation-mirroring unit test was added for this small configuration correction.

Coordinator actual browser receipt, returned through the task channel: Light applied `html.class` and `colorScheme` light and persisted across reload; Dark applied dark; System resolved dark matching the browser's `matchMedia`; newly emitted executable-script warnings after a fresh reload: zero. The coordinator also reports actual signup/enrollment, removal/replay and repair scenarios passed; their broader evidence remains coordinator-owned rather than inferred from these source checks.

## Responsive header correction

The coordinator's actual 320px browser screenshot, `docs/verification/identity-browser/admin-hidden-token-320.png`, has full-page width 380px: the header's unbounded signed-in name `Synthetic Browser Admin` expanded the account button beside navigation/theme controls. The worker inspected that screenshot before editing. Unsigned content had already fit 320px, isolating the header's signed-in account control.

UI review: loading uses a 32px mobile placeholder; signed-out Sign In remains visible; no error/mutation/pagination or access contract changes. The account icon retains a full-name accessible label and shared menu keyboard/focus behavior. No new animation or optimistic state was introduced.

`header.tsx` permits the action group to shrink. `user-menu.tsx` uses the existing shared icon-size button and a labelled account icon below the existing `sm` breakpoint; above it, the displayed name truncates inside a 160px maximum. The popup aligns to the end, uses a 256px width bounded by viewport minus 16px, and wraps its full-name/email content. Full identity remains in the popup and accessible trigger name; only the compact header presentation changes.

Both updated sources have clean LSP diagnostics. After this correction, the web project TypeScript check and production build again exited 0 (2530 modules). No implementation-mirroring unit test was added for CSS utility changes. Source SHA-256 values:

- `header.tsx`: `300fadb71f0048237308cce2d06d15b16edbe45a2ade17df788cb6dbe4b84d5f`
- `user-menu.tsx`: `e1b411902aeba8cbb11e2919bf804862c577bd92e7a22dbde62cba1824e9deaf`

Coordinator live receipt: signed-in320px document scroll width and viewport both measured320; Enter opened the account menu with full accessible name/email and Sign Out, Escape closed it. Tablet768px and desktop1280px each measured matching document/viewport widths. Fresh fixed-source browser harness99641 exited0 after connection/container/network cleanup. Screenshots `admin-menu-fixed-320.png` and `admin-fixed-desktop.png` plus the full journey record are in [browser evidence](../docs/verification/identity-browser/walkthrough.md). The worker did not drive that browser; the coordinator observed these results independently.

No manifests, lockfiles, schema, auth routes, generated routes, identity feature components, commits or staging were changed by this slice. The broader identity journey, 320/768/desktop checks and resource-denial acceptance remain recorded by the coordinator under their own actual evidence.
