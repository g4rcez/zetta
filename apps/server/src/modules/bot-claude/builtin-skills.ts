import type { Asset } from "./profile";

/**
 * Skills every Claude Code and Hermes run gets, next to the ones the owner wrote (an owner skill with the same name wins).
 * Text only: no shell injection, so they pass the same checks as an owner's skill.
 */
const skill = (name: string, description: string, body: string): Asset => ({
  id: `builtin:${name}`,
  kind: "skill",
  name,
  description,
  body: body.trim(),
  tools: [],
  model: null,
  enabled: true,
});

export const BUILTIN_SKILLS: readonly Asset[] = [
  skill(
    "zetta-recover-from-failure",
    "Use when a tool call, command, request or step failed, returned an error, or gave the same result again.",
    `
A failure is information. Do these steps in order.

1. Read the exact error. Do not guess what it means.
2. Name the cause type: wrong input or assumption, missing environment (file, tool, network), permission or sign-in, flaky (timeout, rate limit), or a logic error in your own work.
3. Check the real state before you act again. A step may have worked in part. Do not repeat an action that already took effect.
4. Change one thing, then try again. Never send the same call again. A flaky error may need one more try after a short wait; every other cause needs a different approach.
5. Use another path to the same goal: another tool, route or smaller step. Stay inside the user's request: never switch to a source or site the user did not name. Search the wiki for a gotcha page first (zetta:wiki search).
6. After two different approaches fail, stop and ask for help with one specific question. Say what you tried and what each attempt returned. A bot that is not the Chief sends zetta:escalate. The Chief sends zetta:handoff only for a blocker that only a person can clear.
7. When you recover from a failure that another bot could meet, save it as a zetta:wiki page of type gotcha: the problem, the cause, and the fix.
`,
  ),
  skill(
    "zetta-long-running-work",
    "Use when a goal needs many steps, more than one turn, or hours of work, or when you work inside a loop.",
    `
Long work survives only if every step can be picked up again.

1. Split the goal into checkpoints. Each checkpoint has a result you can check.
2. Do one checkpoint at a time. Finish it before you start the next.
3. Write the state down at each checkpoint: what is done, what is left, what you do next, and what you learned. Inside a loop, put this in zetta:goal_progress. With code access, also keep a short progress note in the workspace.
4. Make each step safe to repeat. Check what exists before you create it, so a second run does not duplicate the work.
5. If the work does not fit in this turn and you are not in a loop, end with a zetta:goal block so the user can start one.
6. If a step fails, use the zetta-recover-from-failure skill. Do not give up on the goal because one path is closed.
7. If the last steps made no progress, change approach: take a smaller step, or question an assumption.
`,
  ),
  skill(
    "zetta-verify-before-done",
    "Use before you say the work is done, before zetta:goal_done, and before you report a result to the user.",
    `
Do not say the work is done until you checked it.

1. List what "done" means. In a loop, use the "done when" text. Otherwise use what the user asked for.
2. Check each item with evidence you can show: command output, a test result, a file you read back, a page you opened, or a link.
3. Read the result as the user would see it, not as you wrote it.
4. If one item fails, fix it or say plainly that it is not done. Never write "done" for work you did not check.
5. In the final report, state what you checked and how. State what you could not check and why.
`,
  ),
];
