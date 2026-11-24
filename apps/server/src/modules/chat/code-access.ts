// The process-wide answer to "may code run?" for `codeEnabled`, which many callers use without a service in hand. `services.ts` sets it at
// start with the setting-backed policy (modules/settings/code-access.ts). Before that (a unit test, a tool) the registry default holds: on.
let policy: () => boolean = () => true;
export const configureCodeAccess = (p: () => boolean) => {
  policy = p;
};
export const codeAccessOn = () => policy();
