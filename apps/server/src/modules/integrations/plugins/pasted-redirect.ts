import { PluginError } from "./registry";

/**
 * The query of an OAuth redirect that could not load, as the user pasted it: the whole address from the browser bar
 * (`http://127.0.0.1:53682/?state=…&code=…&scope=…`), or only its query (`?state=…&code=…`). `state` is required: it is what ties the paste
 * to the sign-in this user started, and the plugin checks it like it does on a normal callback.
 */
export function pastedParams(text: string): URLSearchParams {
  const pasted = text.trim().replace(/^["'<]+|["'>]+$/g, "");
  let query = "";
  try {
    query = new URL(pasted).search;
  } catch {
    query = pasted.includes("?") ? pasted.slice(pasted.indexOf("?")) : pasted;
  }
  const params = new URLSearchParams(query.replace(/^\?/, "").replace(/#.*$/, ""));
  if (!params.get("state") || !(params.get("code") || params.get("error")))
    throw new PluginError(
      "PASTE_INVALID",
      "That is not the address Google ended on.",
      "Copy the whole address from the browser bar of the page that did not load, and paste it here.",
    );
  return params;
}
