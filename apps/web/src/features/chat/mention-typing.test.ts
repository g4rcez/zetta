import { expect, test } from "bun:test";

// Typing `@` in the chat's text box, picking with Enter, in a fake DOM. It runs in its own process (see the script for why).
test("@ offers the bots in MentionTextarea (form and controlled) and MentionField, and Enter picks one", async () => {
  const run = Bun.spawn(
    ["bun", "--no-env-file", "run", `${import.meta.dir}/mention-typing.script.tsx`],
    {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);
  await run.exited;
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  expect(line, stderr.slice(0, 600)).toBeDefined();
  expect(JSON.parse(line!.slice(7))).toEqual({
    form: {
      start: "Check the news",
      opened: "BotsDa Vinci@DaVinci",
      picked: "Check the news with @DaVinci ",
    },
    controlled: {
      opened: "BotsDa Vinci@DaVinci",
      pickedValue: "Goal @DaVinci ",
      keysWhileOpen: [],
      keysAfter: ["Enter"],
    },
    field: { opened: "BotsDa Vinci@DaVinci", picked: "Who is @DaVinci " },
  });
}, 30_000);
