// Zetta's service worker. It caches nothing on purpose: the app talks to /api all the time, and a cached answer from /api or /api/auth
// could show one account's data to another. It exists so the app can be installed on a phone and so notifications work there
// (`new Notification()` throws on Android Chrome and in an installed iOS app; `registration.showNotification()` does not).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A notification opens an in-app path from `data.url`; anything that leaves this origin opens the app's home instead.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const asked = new URL(event.notification.data?.url ?? "/", self.location.origin);
  const url = asked.origin === self.location.origin ? asked.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      if (open.url !== url) await open.navigate(url);
    }),
  );
});
