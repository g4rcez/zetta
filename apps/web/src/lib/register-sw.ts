/**
 * Registers the service worker (public/sw.js) in a production build served over HTTPS. It only makes the app installable and lets
 * notifications work on phones; it caches nothing. Where it cannot register (the desktop app, plain HTTP), the app works as before.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
