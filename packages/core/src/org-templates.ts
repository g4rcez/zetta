import type { OrgRank } from "./org";

/**
 * Seats that most organizations have, written in plain words. A template fills a new seat (title, what it does, what it may decide alone
 * and what goes up) and says which bot template suits it, or null when it is usually a person. A preset is a whole structure made of them.
 */

export const ORG_TEMPLATE_CATEGORIES = [
  { id: "leadership", label: "Leadership" },
  { id: "product-engineering", label: "Product & engineering" },
  { id: "go-to-market", label: "Marketing & sales" },
  { id: "support", label: "Customer support" },
  { id: "operations", label: "People, money & operations" },
] as const;
export type OrgTemplateCategory = (typeof ORG_TEMPLATE_CATEGORIES)[number]["id"];

/** Icon keys of a seat; the web app maps each one to a Phosphor icon. */
export const ORG_ICONS = [
  "briefcase",
  "code",
  "palette",
  "chart-bar",
  "megaphone",
  "headset",
  "scales",
  "users",
  "coins",
  "compass",
  "shield",
  "gear",
  "pencil",
  "bug",
  "terminal",
  "handshake",
] as const;
export type OrgIcon = (typeof ORG_ICONS)[number];

export type OrgRoleTemplate = {
  key: string;
  title: string;
  rank: OrgRank;
  category: OrgTemplateCategory;
  /** What the seat is responsible for, in a sentence or two. */
  description: string;
  /** What the seat may decide alone. */
  decides: string;
  /** What goes up to its manager. */
  goesUp: string;
  /** The department the seat belongs to; a leader's seat runs it. */
  unit: string;
  icon: OrgIcon;
  /** An id of `BOT_TEMPLATES` in the web app, or null when the seat is usually held by a person. */
  suggestedBotTemplate: string | null;
};

const t = (v: OrgRoleTemplate): OrgRoleTemplate => v;

export const ORG_ROLE_TEMPLATES: readonly OrgRoleTemplate[] = [
  t({
    key: "ceo",
    title: "CEO",
    rank: "ceo",
    category: "leadership",
    description:
      "Sets the direction of the company and answers for the results. Everyone else reports up to this seat.",
    decides: "Priorities, budget limits and who leads each area.",
    goesUp: "Nothing: this is the top. Big risks go to the owners or the board.",
    unit: "Company",
    icon: "compass",
    suggestedBotTemplate: null,
  }),
  t({
    key: "coo",
    title: "COO",
    rank: "executive",
    category: "leadership",
    description:
      "Keeps the company running day to day: processes, hiring pace and making sure teams deliver.",
    decides: "How work flows between teams and which process to change.",
    goesUp: "Changes to the plan, large costs and conflicts between leaders.",
    unit: "Operations",
    icon: "gear",
    suggestedBotTemplate: null,
  }),
  t({
    key: "cto",
    title: "CTO",
    rank: "executive",
    category: "leadership",
    description:
      "Owns the technology: what is built, how it is built and that it stays reliable and secure.",
    decides: "Tools, architecture and technical priorities.",
    goesUp: "Large spending, security incidents and anything that changes the product promise.",
    unit: "Engineering",
    icon: "terminal",
    suggestedBotTemplate: null,
  }),
  t({
    key: "cfo",
    title: "CFO",
    rank: "executive",
    category: "leadership",
    description: "Owns the money: budget, spending, forecasts and reports to the owners.",
    decides: "How the approved budget is spent and which costs to cut.",
    goesUp: "Budget increases, new debts and large one-off payments.",
    unit: "Finance",
    icon: "coins",
    suggestedBotTemplate: null,
  }),
  t({
    key: "cmo",
    title: "CMO",
    rank: "executive",
    category: "leadership",
    description: "Owns how the market hears about us: brand, campaigns and the message.",
    decides: "Campaign plans, channels and the tone of the brand.",
    goesUp: "Changes to the brand, large campaign spending and public statements about a crisis.",
    unit: "Marketing",
    icon: "megaphone",
    suggestedBotTemplate: null,
  }),
  t({
    key: "cpo",
    title: "Chief product officer",
    rank: "executive",
    category: "leadership",
    description:
      "Owns what the product does and why: the roadmap, what to build next and what to leave out.",
    decides: "The roadmap order and what ships.",
    goesUp: "A change of direction and anything that moves a promised date.",
    unit: "Product",
    icon: "briefcase",
    suggestedBotTemplate: null,
  }),
  t({
    key: "head-engineering",
    title: "Head of engineering",
    rank: "executive",
    category: "product-engineering",
    description:
      "Leads all engineering teams: hiring, delivery and the health of the code. Reports to the CTO or the CEO.",
    decides: "Team structure, delivery plans and technical standards.",
    goesUp: "Missed dates, large spending and people problems that need the CEO.",
    unit: "Engineering",
    icon: "terminal",
    suggestedBotTemplate: null,
  }),
  t({
    key: "eng-manager",
    title: "Engineering manager",
    rank: "lead",
    category: "product-engineering",
    description:
      "Leads one engineering team: keeps work moving, unblocks people and gives feedback.",
    decides: "Who works on what and how the team plans its weeks.",
    goesUp: "A date that will slip, a person who needs help and anything that needs budget.",
    unit: "Engineering",
    icon: "users",
    suggestedBotTemplate: null,
  }),
  t({
    key: "tech-lead",
    title: "Tech lead",
    rank: "lead",
    category: "product-engineering",
    description:
      "Guides how a team builds: designs the solution, reviews the hard changes and keeps the code simple.",
    decides: "How a feature is built and what a good change looks like.",
    goesUp: "A decision that affects other teams or that is expensive to undo.",
    unit: "Engineering",
    icon: "code",
    suggestedBotTemplate: "reviewer",
  }),
  t({
    key: "software-engineer",
    title: "Software engineer",
    rank: "member",
    category: "product-engineering",
    description:
      "Builds and fixes the product: writes the code, tests it and explains what changed.",
    decides: "How to write a change that was asked for, within the team's standards.",
    goesUp: "Anything unclear, a change bigger than asked and any risk to customer data.",
    unit: "Engineering",
    icon: "code",
    suggestedBotTemplate: "engineer",
  }),
  t({
    key: "qa-engineer",
    title: "QA engineer",
    rank: "member",
    category: "product-engineering",
    description:
      "Checks that the product works before customers see it: finds bugs and says how to repeat them.",
    decides: "Whether a change passes the checks and what to test next.",
    goesUp: "A serious bug close to a release and anything that blocks a launch.",
    unit: "Engineering",
    icon: "bug",
    suggestedBotTemplate: "reviewer",
  }),
  t({
    key: "devops-sre",
    title: "DevOps / reliability engineer",
    rank: "member",
    category: "product-engineering",
    description: "Keeps the product online: deployments, monitoring and fixing outages quickly.",
    decides: "How to deploy and how to respond to an alert.",
    goesUp: "An outage that customers feel and any cost that grows fast.",
    unit: "Engineering",
    icon: "shield",
    suggestedBotTemplate: "engineer",
  }),
  t({
    key: "product-manager",
    title: "Product manager",
    rank: "member",
    category: "product-engineering",
    description:
      "Turns what customers need into clear work: writes what to build, why, and how we know it is done.",
    decides: "The details of a feature and the order of work inside a project.",
    goesUp: "A change of scope, a missed date and a trade-off that touches other teams.",
    unit: "Product",
    icon: "briefcase",
    suggestedBotTemplate: "planner",
  }),
  t({
    key: "product-designer",
    title: "Product designer",
    rank: "member",
    category: "product-engineering",
    description: "Designs how the product looks and feels, and checks it with real users.",
    decides: "Layouts, wording on screen and the look of a feature.",
    goesUp: "A change to the brand and a design that needs a lot of extra work.",
    unit: "Product",
    icon: "palette",
    suggestedBotTemplate: null,
  }),
  t({
    key: "data-analyst",
    title: "Data analyst",
    rank: "member",
    category: "product-engineering",
    description: "Finds answers in the numbers and explains them so people can decide.",
    decides: "Which data to use and how to present it.",
    goesUp: "A result that changes a plan and any doubt about how good the data is.",
    unit: "Data",
    icon: "chart-bar",
    suggestedBotTemplate: "analyst",
  }),
  t({
    key: "marketing-manager",
    title: "Marketing manager",
    rank: "lead",
    category: "go-to-market",
    description:
      "Leads the marketing team: plans campaigns, watches the results and keeps the message clear.",
    decides: "Which campaigns run and how the team's time is used.",
    goesUp: "Spending beyond the plan and anything the public could read as a promise.",
    unit: "Marketing",
    icon: "megaphone",
    suggestedBotTemplate: null,
  }),
  t({
    key: "content-writer",
    title: "Content writer",
    rank: "member",
    category: "go-to-market",
    description: "Writes and edits articles, emails and posts in the voice of the company.",
    decides: "Wording, structure and which examples to use.",
    goesUp: "Claims about the product, numbers that need a source and anything about a competitor.",
    unit: "Marketing",
    icon: "pencil",
    suggestedBotTemplate: "editor",
  }),
  t({
    key: "sales-lead",
    title: "Sales lead",
    rank: "lead",
    category: "go-to-market",
    description:
      "Leads the sales team: sets targets, reviews deals and coaches the people who sell.",
    decides: "Which deals to pursue and how to split the leads.",
    goesUp: "Discounts beyond the limit, special contract terms and a big deal at risk.",
    unit: "Sales",
    icon: "handshake",
    suggestedBotTemplate: null,
  }),
  t({
    key: "account-executive",
    title: "Account executive",
    rank: "member",
    category: "go-to-market",
    description:
      "Talks to prospects and customers, understands what they need and closes the deal.",
    decides: "How to run a conversation and which follow-up to send.",
    goesUp: "A discount, a custom promise and a customer who wants to leave.",
    unit: "Sales",
    icon: "handshake",
    suggestedBotTemplate: "concierge",
  }),
  t({
    key: "support-lead",
    title: "Customer support lead",
    rank: "lead",
    category: "support",
    description:
      "Leads the support team: keeps answers quick and good, and brings customer problems to the product team.",
    decides: "How the queue is split and which answers become standard.",
    goesUp: "A refund beyond the limit, an angry customer and a bug that hits many people.",
    unit: "Support",
    icon: "headset",
    suggestedBotTemplate: null,
  }),
  t({
    key: "support-agent",
    title: "Support agent",
    rank: "member",
    category: "support",
    description: "Answers customers, solves what it can and passes on what it cannot.",
    decides: "How to explain a fix and which standard answer fits.",
    goesUp: "Refunds, account problems it cannot fix and anything about security or privacy.",
    unit: "Support",
    icon: "headset",
    suggestedBotTemplate: "support",
  }),
  t({
    key: "people-hr",
    title: "People & HR manager",
    rank: "lead",
    category: "operations",
    description:
      "Looks after the people: hiring, onboarding, feedback and keeping the team healthy.",
    decides: "How onboarding runs and which questions go in an interview.",
    goesUp: "Hiring offers, conflicts between people and any change to pay or contracts.",
    unit: "People",
    icon: "users",
    suggestedBotTemplate: "coach",
  }),
  t({
    key: "finance-ops",
    title: "Finance & operations manager",
    rank: "lead",
    category: "operations",
    description:
      "Keeps the books, pays the bills and makes sure the company follows its own rules.",
    decides: "Which invoices to pay inside the budget and how to file the records.",
    goesUp: "Spending beyond the budget, late payments and anything about taxes.",
    unit: "Finance",
    icon: "coins",
    suggestedBotTemplate: "analyst",
  }),
  t({
    key: "legal-counsel",
    title: "Legal counsel",
    rank: "member",
    category: "operations",
    description: "Reads contracts and rules, and says what the company can and cannot do.",
    decides: "Whether a standard contract can be signed as it is.",
    goesUp:
      "Anything that goes to court, a rule the company may have broken and unusual contract terms.",
    unit: "Legal",
    icon: "scales",
    suggestedBotTemplate: "researcher",
  }),
  t({
    key: "executive-assistant",
    title: "Executive assistant",
    rank: "member",
    category: "operations",
    description:
      "Keeps a leader's day in order: calendar, messages, travel and the notes from meetings.",
    decides: "How to arrange a day and which routine messages to answer.",
    goesUp: "Anything that commits the leader's money or time in a new way.",
    unit: "Company",
    icon: "compass",
    suggestedBotTemplate: "concierge",
  }),
];

export const orgTemplateByKey = (key: string) => ORG_ROLE_TEMPLATES.find((x) => x.key === key);

/** One seat of a preset: a template, optionally with its own title or unit, and the seats that report to it. */
export type OrgPresetNode = {
  template: string;
  title?: string;
  unit?: string;
  children?: readonly OrgPresetNode[];
};

export type OrgPreset = {
  key: string;
  title: string;
  description: string;
  /** `company` starts with the CEO and fits an empty chart; `department` hangs under a seat the admin picks. */
  scope: "company" | "department";
  root: OrgPresetNode;
};

const n = (template: string, children?: readonly OrgPresetNode[]): OrgPresetNode =>
  children ? { template, children } : { template };

export const ORG_PRESETS: readonly OrgPreset[] = [
  {
    key: "solo-founder",
    title: "Solo founder with bots",
    description: "You at the top and a bot for each job you would like to hand over.",
    scope: "company",
    root: n("ceo", [
      n("executive-assistant"),
      n("software-engineer"),
      n("content-writer"),
      n("support-agent"),
      n("data-analyst"),
    ]),
  },
  {
    key: "small-startup",
    title: "Small startup",
    description: "A CEO with technology, product, marketing, sales, support and finance.",
    scope: "company",
    root: n("ceo", [
      n("cto", [
        n("tech-lead", [n("software-engineer"), n("software-engineer"), n("qa-engineer")]),
      ]),
      n("cpo", [n("product-manager"), n("product-designer")]),
      n("cmo", [n("content-writer")]),
      n("sales-lead", [n("account-executive")]),
      n("support-lead", [n("support-agent")]),
      n("finance-ops"),
      n("executive-assistant"),
    ]),
  },
  {
    key: "agency",
    title: "Agency or services firm",
    description: "Delivery under an operations lead, sales on the side and finance at the top.",
    scope: "company",
    root: n("ceo", [
      n("coo", [
        n("product-manager"),
        n("product-designer"),
        n("software-engineer"),
        n("software-engineer"),
        n("content-writer"),
      ]),
      n("sales-lead", [n("account-executive")]),
      n("finance-ops"),
    ]),
  },
  {
    key: "product-team",
    title: "Software product team",
    description: "Engineering with its managers, plus product, design and reliability.",
    scope: "department",
    root: n("head-engineering", [
      n("eng-manager", [n("software-engineer"), n("software-engineer"), n("qa-engineer")]),
      n("tech-lead"),
      n("devops-sre"),
      n("product-manager"),
      n("product-designer"),
    ]),
  },
  {
    key: "support-desk",
    title: "Customer support desk",
    description: "A support lead, the agents who answer and an analyst who finds patterns.",
    scope: "department",
    root: n("support-lead", [
      n("support-agent"),
      n("support-agent"),
      n("support-agent"),
      n("data-analyst"),
    ]),
  },
];

export const orgPresetByKey = (key: string) => ORG_PRESETS.find((x) => x.key === key);

/** A seat of a preset flattened for insertion: parents come before their children, and `parentRef` is an index into the list. */
export type OrgPresetRow = {
  ref: number;
  parentRef: number | null;
  templateKey: string;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  sortOrder: number;
};

/** Walks a preset top-down. A key that is not a template is skipped with its subtree, so a typo cannot half-build a chart. */
export function presetRows(preset: OrgPreset): OrgPresetRow[] {
  const rows: OrgPresetRow[] = [];
  const add = (node: OrgPresetNode, parentRef: number | null, sortOrder: number) => {
    const tpl = orgTemplateByKey(node.template);
    if (!tpl) return;
    const ref = rows.length;
    rows.push({
      ref,
      parentRef,
      templateKey: tpl.key,
      rank: tpl.rank,
      title: node.title ?? tpl.title,
      description: tpl.description,
      unit: node.unit ?? tpl.unit,
      sortOrder,
    });
    (node.children ?? []).forEach((c, i) => add(c, ref, i));
  };
  add(preset.root, null, 0);
  return rows;
}
