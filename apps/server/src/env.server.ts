import "varlock/auto-load";
export { ENV } from "./env";

/** Packaged desktop builds serve the frontend from their own origin, not ZETTA_SERVER_URL. */
export const desktopOrigins = ["views://mainview"];
