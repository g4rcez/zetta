import { BrowserWindow, Updater } from "electrobun/main";

const DEV_SERVER_PORT = 3000;
// The web dev server runs on HTTPS (self-signed, or the ZETTA_TLS_CERT/KEY pair of apps/web/.env); HTTP is the fallback for a custom setup.
const DEV_SERVER_URLS = [
  `https://localhost:${DEV_SERVER_PORT}`,
  `http://localhost:${DEV_SERVER_PORT}`,
];

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    for (const url of DEV_SERVER_URLS) {
      try {
        // Only a liveness probe: Bun does not read the macOS keychain, so the local mkcert CA is unknown to it. The webview trusts it.
        await fetch(url, { method: "HEAD", tls: { rejectUnauthorized: false } });
        console.log(`HMR enabled: Using web dev server at ${url}`);
        return url;
      } catch {}
    }
    console.log("Web dev server not running. Run dev:hmr for live reload.");
  }

  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

new BrowserWindow({
  title: "zetta",
  url,
  preload: url.startsWith("views://") ? 'history.replaceState(null, "", "/");' : undefined,
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  },
});

console.log("Electrobun desktop shell started.");
