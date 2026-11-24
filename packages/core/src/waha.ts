/**
 * The WhatsApp server (WAHA) every person shares who uses WhatsApp without a server of their own. Its address is the setting `wahaUrl`
 * (registry, `settings.ts`); its API key is a sealed connection of this provider, saved with this transport purpose. The column
 * `installation_settings.waha_connection_id` records which connection. Only erasable syntax: the server and the web app import this file.
 */
export const WAHA_KEY_CONNECTION_PROVIDER = "waha";
export const WAHA_KEY_PURPOSE = "installation.waha-key";
/** What a person's plugin uses when neither they nor the administrator gave an address: the WAHA container Zetta starts next to itself. */
export const DEFAULT_WAHA_URL = "http://127.0.0.1:3010";
