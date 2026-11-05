// What the stand-in `claude` (bin/claude) answers for the Chief in the team demo (record.ts team). Same rule format as replies.ts.
//
// The story: the person asks for a team; the Chief asks, posts a design, and after the "go ahead" builds it in three steps. After each step
// of cards the server calls the Chief again with a hidden message that says "This is step N of at most 4": those lines pick the rules.
import type { Rule } from "./replies.ts";

const block = (kind: string, body: Record<string, unknown>) =>
  `\`\`\`zetta:${kind}\n${JSON.stringify(body)}\n\`\`\``;

export const teamRules: Rule[] = [
  // Step 3: the cards of step 2 were decided. The roles are set, so the room can copy them.
  {
    req: "step 3 of at most 4",
    steps: 0,
    reply: [
      "The roles and the skill are in place. Last step: the project room.",
      block("team", {
        action: "open_room",
        team: "Blog launch",
        title: "Blog launch kickoff",
        goal: "Publish 3 posts and a newsletter in two weeks.",
        context: "Start with the post list. The researcher gathers sources first.",
      }),
    ].join("\n"),
  },
  {
    req: "step 3 of at most 4",
    steps: 1,
    reply:
      "Approve the room and the team is ready. The room waits for you: nobody works in it until you write there.",
  },

  // Step 2: the cards of step 1 were decided. The new roles exist now, so they can be given to the members.
  {
    req: "step 2 of at most 4",
    steps: 0,
    reply: [
      "The roles and the skill exist. Now I give each member a role and teach Writer the blog style.",
      block("team", {
        action: "update",
        team: "Blog launch",
        roles: [
          { bot: "Researcher", role: "Blog researcher" },
          { bot: "Writer", role: "Blog writer" },
          { bot: "Editor", role: "Blog editor" },
        ],
      }),
      block("skill_library", { action: "attach", skill: "blog-style", bots: ["Writer"] }),
      block("next_wave", { next: "Open the project room for the team." }),
    ].join("\n"),
  },
  {
    req: "step 2 of at most 4",
    steps: 3,
    reply: "Two cards wait for you: the roles of the team and the blog-style skill for Writer.",
  },

  // The "go ahead": hire, create the team, and send the first cards.
  {
    req: "go ahead",
    steps: 0,
    reply: [
      "Building it now. First the new bot and the team, then the cards that need your approval.",
      block("create_bot", {
        name: "Editor",
        description: "Edits drafts for clarity, tone and facts.",
        personality: "You are Editor, a careful editor who respects the author's voice.",
        instructions:
          "Edit drafts for clarity and tone. Flag every claim that has no source. Never change the author's meaning.",
      }),
      block("create_team", {
        name: "Blog launch",
        goal: "Publish 3 posts and a newsletter in two weeks, with no paid tools.",
        context:
          "Audience: developers who follow our product. Tone: plain and friendly. Posts go out on Tuesdays.",
        members: [{ bot: "Researcher" }, { bot: "Writer" }, { bot: "Editor" }],
      }),
      block("team", {
        action: "role_create",
        name: "Blog researcher",
        description: "Finds sources and checks facts",
      }),
      block("team", {
        action: "role_create",
        name: "Blog writer",
        description: "Drafts the posts and the newsletter",
      }),
      block("team", {
        action: "role_create",
        name: "Blog editor",
        description: "Edits drafts for clarity and tone",
      }),
      block("skill_library", {
        action: "create",
        name: "blog-style",
        description: "How our blog posts are written",
        body: "Write in the second person with short paragraphs, one idea each. Start with the point. End with one next step for the reader.",
      }),
      block("next_wave", {
        next: "Give each member its role and teach Writer the blog-style skill.",
      }),
    ].join("\n"),
  },
  {
    req: "go ahead",
    steps: 7,
    reply:
      "The team Blog launch exists, with Editor as a new hire. Four cards wait for you: three roles and the blog-style skill. Approve them and I continue.",
  },

  // The answers to the brief: read the skill library, then post the design and wait for the OK.
  {
    req: "publish 3 posts",
    steps: 0,
    reply: [
      "Let me check what your library already has.",
      block("skill_library", { action: "list" }),
    ].join("\n"),
  },
  {
    req: "publish 3 posts",
    steps: 1,
    reply: [
      "Here is the design for **Blog launch**:",
      "- **Researcher** (you already have it): finds sources and checks facts.",
      "- **Writer** (you already have it): drafts the posts and the newsletter. I will teach it your blog style with a new skill, not by changing the bot.",
      "- **Editor** (new hire): edits for clarity, tone and facts.",
      '- **Project room** "Blog launch kickoff": it waits until you start it.',
      "Nothing is created yet. Shall I go ahead?",
    ].join("\n"),
  },

  // The first message: ask the brief.
  {
    req: "blog launch",
    steps: 0,
    reply:
      "Happy to. Three quick questions: what is the goal, what must be delivered, and what are the limits (budget, tools, deadline)?",
  },
];
