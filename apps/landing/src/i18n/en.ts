// English is the source of truth. pt-br.ts must satisfy the same shape, so a missing key fails type-checking.
// Claims here match code that exists in the repo. No testimonials, pricing or metrics: PRODUCT.md forbids inventing them.
// The screenshots in public/screens are real captures of the app in light mode, taken on a throwaway install with demo data.

export type ProductRow = {
  id: "inbox" | "chat" | "tasks" | "routines";
  title: string;
  body: string;
  alt: string;
};
export type Station = { title: string; body: string; tags: string[] };

export const en = {
  meta: {
    title: "Zetta: bots that work on your server while you do something else",
    description:
      "Zetta is an open source, self-hosted workspace for bots. Ask your chief for an outcome. Come back to results, or to the one thing that needs you.",
  },
  header: {
    home: "Zetta home",
    nav: {
      product: "Product",
      network: "Integrations",
      selfHost: "Self-host",
    },
    github: "Star on GitHub",
    switchLabel: "PT",
    switchName: "Português (Brasil)",
    switchHref: "/pt-br/",
  },
  hero: {
    title: "Ask for the outcome. Your chief does the rest.",
    lead: "Zetta is an open source web app that you host yourself. Give your personal chief a job, such as a weekly brief or a pull request review. It hands the work to specialist bots on your server, and you come back to the result, or to the one question it cannot answer alone.",
    primary: "Self-host Zetta",
    secondary: "Star on GitHub",
    note: "Open source under the MIT license. Runs on your server.",
    screenAlt:
      "The Zetta chat in light mode: the chief answers that it asked three bots, and one stopped to ask before sending. Demo data.",
  },
  product: {
    title: "See what your bots did, and what they need from you",
    note: "Screenshots of Zetta in light mode, with demo data.",
    rows: [
      {
        id: "inbox",
        title: "Your bots ask only when they need you",
        body: "The Inbox lists what is working, what is blocked and what has a new result. Deleting files, administrator commands and sending mail wait for your approval. A task is marked done only when it is done.",
        alt: "The Inbox lists two items that need you: send the newsletter to the whole team list, and a blocked GitHub login. Demo data.",
      },
      {
        id: "chat",
        title: "One chat for each intention",
        body: "Each bot keeps many chats, one for each intention, so the context stays clean and you can find the work later. Rooms put several bots and people in one conversation.",
        alt: "A chat with the Writer bot. The newsletter draft ends with a question that waits for approval. Demo data.",
      },
      {
        id: "tasks",
        title: "Who has what, and what is stuck",
        body: "Tasks move from backlog to in progress, blocked, review and done. Each card shows the bot that owns it, so blocked work stands out.",
        alt: "The task board with columns backlog, in progress, blocked and review, each card showing its bot. Demo data.",
      },
      {
        id: "routines",
        title: "Work that starts without you",
        body: "Schedule a briefing, a newsletter or a review queue to run on its own. The agenda syncs both ways with the main calendar of each Google account you connect.",
        alt: "The routines page: a morning briefing, a Friday newsletter and a pull request queue, each with its next run. Demo data.",
      },
    ] satisfies ProductRow[],
  },
  network: {
    title: "Connect the accounts and agents you already have",
    lead: "Everything below exists in the repository today. Ordinary actions run on their own. A blocked or uncertain result always comes back to you.",
    items: [
      {
        title: "Connected apps",
        body: "Connect the accounts your bots need from Studio. Sharing a bot never shares your credentials.",
        tags: ["GitHub", "Linear", "Notion", "Sentry", "PostHog", "Cloudflare", "Gmail", "Drive"],
      },
      {
        title: "Telegram and WhatsApp",
        body: "Message your bots from Telegram with your own bot token, or from WhatsApp through your own WAHA server. Sending from WhatsApp stays off until you turn it on.",
        tags: ["Telegram", "WhatsApp"],
      },
      {
        title: "Your coding tools",
        body: "Claude Code or Cursor can work as a member of your team through a built-in connection, with the same permission checks as the web app.",
        tags: ["Claude Code", "Cursor"],
      },
      {
        title: "The agents you already use",
        body: "The server runs Pi, Codex, OMP, Claude Code, OpenCode and Cursor. Each bot can use a different one.",
        tags: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
      },
      {
        title: "Browser and computer",
        body: "Bots can use a browser or a Linux desktop on your server. At a sign-in, a person takes over and the bot carries on after. You set limits on memory, CPU and how many run at once.",
        tags: [],
      },
      {
        title: "Memory and knowledge",
        body: "Bots keep what matters between chats. Company knowledge is searchable, even with a local embedding model.",
        tags: [],
      },
    ] satisfies Station[],
  },
  selfHost: {
    title: "Run it on your server",
    lead: "You need Git and Docker. Zetta starts a web app, an API and a Postgres database.",
    note: "Free under the MIT license. It is early: read the repository and its issues before you depend on it.",
    docs: "Read the docs on GitHub",
    steps: [
      { title: "Get the code", body: "Clone the repository." },
      {
        title: "Create the settings",
        body: "Write the two .env files. This makes the secrets for you. The full list of settings is in apps/server/.env.schema.",
      },
      { title: "Start it", body: "Build and start the three containers." },
      {
        title: "Finish setup in the browser",
        body: "Open http://localhost:3001 and paste the setup key from apps/server/.env. You become the admin of this install.",
      },
    ],
    copy: "Copy",
    copied: "Copied",
    last: {
      title: "Help other teams find Zetta",
      body: "A star on GitHub is the fastest way to help. Issues and pull requests are welcome too.",
      primary: "Star on GitHub",
      secondary: "Open an issue",
      repo: "github.com/g4rcez/zetta",
    },
  },
  footer: {
    tagline: "Bots that work on your server while you do something else.",
    license: "MIT license",
    links: { repo: "Repository", docs: "Docs", issues: "Issues" },
  },
};

export type Copy = typeof en;
