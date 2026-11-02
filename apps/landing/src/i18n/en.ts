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
export type ActionRow = { text: string; kind: "ran" | "waits" };
export type SceneRow = { label: string; text: string; kind: "blocked" | "needs" | "result" };
export type AccessRow = { text: string; kind: "allowed" | "denied" };

export const en = {
  meta: {
    title: "Zetta: bots that work on your server while you do something else",
    description:
      "Zetta is an open source, self-hosted workspace for bots. Ask your chief for an outcome. Come back to results, or to the one thing that needs you.",
  },
  header: {
    home: "Zetta home",
    nav: {
      how: "How it works",
      features: "What it does",
      control: "Control",
      selfHost: "Self-host",
      faq: "FAQ",
    },
    github: "GitHub",
    cta: "Self-host",
    switchLabel: "PT",
    switchName: "Português (Brasil)",
    switchHref: "/pt-br/",
  },
  hero: {
    title: "Ask for the outcome. Your chief does the rest.",
    lead: "Zetta is a self-hosted workspace for bots. Tell your chief what you need. It coordinates specialist bots on your server, and you come back to the result, or to the one thing that needs you.",
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
  strip: {
    title: "Connect the apps your team already uses",
    label: "Apps and channels",
    pause: "Pause",
    play: "Play",
  },
  how: {
    title: "You ask. The work happens on the server.",
    lead: "Close the tab. Bots run on your server, not in your browser. Zetta calls you back only when a person is needed.",
    steps: [
      {
        title: "Ask your chief",
        body: "Write the outcome in plain words. No setup, no prompt engineering.",
      },
      {
        title: "The chief delegates",
        body: "It picks specialist bots, or asks you to create one.",
      },
      {
        title: "Bots work on the server",
        body: "Routines, plugins, a browser or a Linux desktop. You can close the tab.",
      },
      {
        title: "You are asked only when needed",
        body: "A missing detail, an expired login, a risky action. The Inbox shows it.",
      },
      {
        title: "You get the result",
        body: "A summary of what ran, and a list of the actions the bot took.",
      },
    ],
    vignettes: {
      inbox: "Inbox",
      delegate: ["The chief called Writer", "The chief called Reviewer"],
      server: [
        "Routine: every weekday at 08:00",
        "Browser: reading 3 pages",
        "Tab closed, still running",
      ],
      actions: "6 actions",
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
  },
  features: {
    title: "What your bots can do",
    lead: "Everything below exists in the repository today. Where a feature is early, the FAQ says so.",
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
        body: "One Inbox for what is working, what needs input, what is blocked and what has a new result. A kanban shows the same tasks as columns.",
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
  control: {
    title: "Autonomy that does not pretend",
    lead: "Zetta does not ask you to approve every step, and it does not report success it did not get.",
    points: [
      {
        title: "No fake success",
        body: "Missing information, expired logins, blocked tools and uncertain results show up in your Inbox. They are never hidden behind a green check.",
      },
      {
        title: "Approval only where it matters",
        body: "Ordinary actions run on their own. Deleting files, running as an administrator and sending mail wait for you.",
      },
      {
        title: "Sharing stops at the bot",
        body: "Teammates can use a bot you share. Your conversations, credentials, files and memories stay yours.",
      },
      {
        title: "The server decides",
        body: "Sign-in and permissions are checked on the server. There is one admin per install, and being admin does not open private chats.",
      },
    ],
    scenes: {
      honest: {
        rows: [
          { label: "Blocked", text: "GitHub login expired", kind: "blocked" },
          {
            label: "Needs you",
            text: "Send the newsletter to the whole team list?",
            kind: "needs",
          },
          {
            label: "New result",
            text: "Routine created. First briefing is ready.",
            kind: "result",
          },
        ] satisfies SceneRow[],
      },
      approval: {
        ran: "Ran on its own",
        waits: "Waits for you",
        rows: [
          { text: "Read 12 updates", kind: "ran" },
          { text: "Open a browser tab", kind: "ran" },
          { text: "Send mail to the team list", kind: "waits" },
          { text: "Delete files", kind: "waits" },
        ] satisfies ActionRow[],
      },
      sharing: {
        bot: "Writer",
        shared: "Shared with the team",
        stays: "Stays yours",
        items: ["Your conversations", "Credentials", "Files", "Memories"],
      },
      server: {
        title: "Checked on the server",
        allowed: "Allowed",
        denied: "Denied",
        rows: [
          { text: "Open the shared Writer bot", kind: "allowed" },
          { text: "Read another person's private chat", kind: "denied" },
        ] satisfies AccessRow[],
      },
    },
  },
  teams: {
    title: "For teams with and without engineers",
    lead: "Everyone gets a personal chief. Bots, workspaces and roles keep the team organized.",
    scene: {
      workspace: "Launch",
      people: "People",
      bots: "Bots",
      roles: ["Admin", "Member", "Member"],
      team: "Team",
      private: "Private",
    },
    items: [
      {
        title: "Plain language by default",
        body: "Set up a bot with a form, or by talking to it. A bot is ready only after a real test chat and your yes.",
      },
      {
        title: "Advanced when you want it",
        body: "Models, agents, connected apps and permissions have their own controls for the people who need them.",
      },
      {
        title: "Workspaces and roles",
        body: "Group bots into workspaces. Bots are visible to the team by default, and can be private.",
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
    mock: { address: "localhost:3001", inbox: "Inbox", bots: "Bots" },
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "What is Zetta?",
        a: "A web app you host yourself to manage autonomous bots. Each person gets a personal chief. You give the chief an outcome, and it coordinates specialist bots on the server.",
      },
      {
        q: "Do I need to code?",
        a: "No. You set up a bot with a form or by chatting with it. The technical options are there when you want them.",
      },
      {
        q: "Which models and agents does it use?",
        a: "The server runs the agents installed on it: Pi, Codex, OMP, Claude Code, OpenCode and Cursor. Each of them signs in to its own provider, so you bring those accounts.",
      },
      {
        q: "Where do my data and keys live?",
        a: "On your server, in your Postgres. Stored secrets are encrypted with a key you set. Sharing a bot never shares conversations, credentials, files or memories.",
      },
      {
        q: "Does a bot ask me about everything?",
        a: "No. Ordinary actions run on their own. Deleting files, running as an administrator and sending mail wait for your approval, and a blocked or uncertain result comes back to you.",
      },
      {
        q: "Can I use it from Telegram or WhatsApp?",
        a: "Telegram works with your own bot from BotFather. WhatsApp works through a WAHA server that you run, paired with a QR code. Sending from WhatsApp is off by default.",
      },
      {
        q: "What does it cost?",
        a: "Zetta is free under the MIT license. You pay for your server and for the model providers your agents use. There is no hosted plan.",
      },
      {
        q: "Is it ready for production?",
        a: "It is early. The product definition describes the intended first version, and some parts are still in progress. Read the repository and its issues before you depend on it.",
      },
      {
        q: "Is there a desktop app?",
        a: "The repository has a desktop app in apps/desktop. This page has no download for it yet.",
      },
    ],
  },
  cta: {
    title: "Run your first chief.",
    lead: "Clone it, start it, and ask for something small.",
    primary: "Self-host Zetta",
    secondary: "Read the docs",
  },
  footer: {
    tagline: "Bots that work on your server while you do something else.",
    license: "MIT license",
    links: { repo: "Repository", docs: "Docs", issues: "Issues" },
    columns: { product: "Product", developers: "Developers", language: "Language" },
  },
};

export type Copy = typeof en;
