// English is the source of truth. pt-br.ts must satisfy the same shape, so a missing key fails type-checking.
// Claims here match code that exists in the repo. No testimonials, pricing or metrics: PRODUCT.md forbids inventing them.

export type Outcome = {
  kind: "done" | "needs";
  title: string;
  body: string;
  actions?: [string, string];
};
export type DemoTab = {
  id: string;
  label: string;
  pitch: string;
  user: string;
  chief: string;
  steps: string[];
  outcome: Outcome;
};
export type HubBot = { name: string; status: string; kind: "working" | "needs" };

export const en = {
  meta: {
    title: "Zetta: bots that work on your server while you do something else",
    description:
      "Zetta is an open source, self-hosted workspace for bots. Ask your chief for an outcome. Come back to results, or to the one thing that needs you.",
  },
  header: {
    home: "Zetta home",
    nav: {
      examples: "Examples",
      features: "Features",
      selfHost: "Self-host",
    },
    github: "Star on GitHub",
    cta: "Self-host",
    switchLabel: "PT",
    switchName: "Português (Brasil)",
    switchHref: "/pt-br/",
  },
  hero: {
    title: "Ask for the outcome. Your chief does the rest.",
    lead: "Zetta is an open source web app that you host yourself. Each person gets a personal chief. Tell your chief what you need. It coordinates specialist bots on your server. You come back to the result, or to the one thing that needs you.",
    primary: "Self-host Zetta",
    secondary: "Star on GitHub",
    note: "Open source under the MIT license. Runs on your server.",
    hub: {
      label: "Illustrated example",
      description:
        "Illustration: you ask your chief for an outcome. The chief calls three specialist bots. The bots run on the six agents installed on your server. One bot waits for your approval.",
      you: "You",
      ask: "Send the weekly brief to the team",
      chief: "Zetta",
      chiefRole: "Your chief",
      botsTitle: "Specialist bots",
      agentsTitle: "Agents on your server",
      needs: "Needs you",
      writing: "Drafting the brief",
      bots: [
        { name: "Writer", status: "Send it to the whole team list?", kind: "needs" },
        { name: "Reviewer", status: "Reading pull requests", kind: "working" },
        { name: "Researcher", status: "Collecting sources", kind: "working" },
      ] satisfies HubBot[],
      agents: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
    },
  },
  demo: {
    title: "See a run from start to finish",
    lead: "Three example runs. One finishes. Two stop and ask for you.",
    pause: "Pause",
    resume: "Resume",
    label: "Example runs",
    tabsLabel: "Choose an example",
    replay: "Replay",
    illustrated: "Illustrated example",
    working: "Working…",
    you: "You",
    tabs: [
      {
        id: "briefing",
        label: "Morning briefing",
        pitch: "A routine reads your calendar and your pull requests before you open the laptop.",
        user: "Every weekday at 8, brief me on my calendar, open pull requests and anything blocked.",
        chief: "Done. I created a routine and asked Reviewer to help with the pull requests.",
        steps: ["Read today's calendar", "Listed open pull requests", "Summarised blocked tasks"],
        outcome: {
          kind: "done",
          title: "Routine created",
          body: "First briefing: 3 meetings, 2 pull requests waiting, 1 task blocked.",
        },
      },
      {
        id: "review",
        label: "Code review",
        pitch: "A bot starts the work, meets a blocked login, and asks you instead of guessing.",
        user: "Review the new authentication pull request for security problems.",
        chief: "I asked Reviewer. It started, then hit a problem.",
        steps: ["Opened the pull request", "Read the changed files"],
        outcome: {
          kind: "needs",
          title: "Blocked: GitHub login expired",
          body: "Reviewer cannot read the next files. Sign in to GitHub again and it continues from here.",
          actions: ["Sign in again", "Stop the task"],
        },
      },
      {
        id: "newsletter",
        label: "Weekly newsletter",
        pitch: "A bot writes the draft. Sending mail waits for your yes.",
        user: "Write the Friday newsletter from this week's updates.",
        chief: "Writer has a draft. Sending mail needs your approval.",
        steps: ["Collected this week's updates", "Drafted the newsletter", "Checked links"],
        outcome: {
          kind: "needs",
          title: "Needs you: send mail",
          body: "Send the newsletter to the whole team list?",
          actions: ["Approve", "Decline"],
        },
      },
    ] satisfies DemoTab[],
  },
  features: {
    title: "What your bots can do",
    lead: "Everything below exists in the repository today. Ordinary actions run on their own. A blocked or uncertain result always comes back to you.",
    scenes: {
      chats: ["Weekly brief", "Friday newsletter", "Launch notes"],
      room: "launch",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      routine: "Briefing",
      routine2: "Newsletter",
      columns: ["Working", "Needs you", "Done"],
      tasks: ["Review the auth pull request", "Send the newsletter", "Morning briefing"],
      pages: ["Changelog", "Status page", "Team updates"],
    },
    items: [
      {
        title: "Chats and rooms",
        body: "Each bot has many chats. Start a new chat for each intention so the context stays clean and the work is easy to find. Rooms put several bots and people in one conversation.",
        tags: [],
      },
      {
        title: "Routines and agenda",
        body: "Schedule work to run without you. The agenda syncs both ways with the main calendar of each Google account you connect.",
        tags: ["Google Calendar"],
      },
      {
        title: "Attention and tasks",
        body: "One Inbox for what is working, what needs input, what is blocked and what has a new result. Deleting files, running as an administrator and sending mail wait for you. Nothing is shown as done when it is not.",
        tags: [],
      },
      {
        title: "Browser and computer",
        body: "Bots can use a browser or a Linux desktop that runs on your server, with limits on memory, CPU and how many run at once.",
        tags: [],
      },
      {
        title: "Connected apps",
        body: "Add GitHub, Linear, Notion, Sentry, PostHog, Cloudflare and others from Studio. Google Calendar, Gmail and Drive are supported too.",
        tags: ["GitHub", "Linear", "Notion", "Sentry", "PostHog", "Cloudflare", "Gmail", "Drive"],
      },
      {
        title: "Telegram and WhatsApp",
        body: "Talk to your bots from Telegram with your own bot token, or from WhatsApp through your own WAHA server. Sending from WhatsApp is off until you turn it on.",
        tags: ["Telegram", "WhatsApp"],
      },
      {
        title: "Memory and knowledge",
        body: "Bots keep what matters between chats. Company knowledge is searchable, and it can run with a local embedding model.",
        tags: [],
      },
      {
        title: "Your coding tools",
        body: "Claude Code or Cursor can act as a team member through the built-in MCP server. It uses the same permission checks as the web app.",
        tags: ["Claude Code", "Cursor"],
      },
      {
        title: "The agents you already use",
        body: "The server runs Pi, Codex, OMP, Claude Code, OpenCode and Cursor. Each bot can use a different one.",
        tags: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
      },
    ],
  },
  selfHost: {
    title: "Run it on your server",
    lead: "You need Git and Docker. Zetta starts a web app, an API and a Postgres database.",
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
    docs: "Read the docs on GitHub",
    note: "Free under the MIT license. It is early: read the repository and its issues before you depend on it.",
    mock: { address: "localhost:3001", inbox: "Inbox", bots: "Bots" },
  },
  cta: {
    title: "Like where this is going? Star Zetta on GitHub.",
    lead: "A star helps other teams find the project. Issues and pull requests are welcome too.",
    primary: "Star on GitHub",
    secondary: "Open an issue",
    repo: "github.com/g4rcez/zetta",
  },
  footer: {
    tagline: "Bots that work on your server while you do something else.",
    license: "MIT license",
    links: { repo: "Repository", docs: "Docs", issues: "Issues" },
    columns: { product: "Product", developers: "Developers", language: "Language" },
  },
};

export type Copy = typeof en;
