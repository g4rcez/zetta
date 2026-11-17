import { expect, test } from "bun:test";

// Typing in the inline editor of a message and the Up arrow of the message box, in a fake DOM. It runs in its own process (see the script).
test("the editor saves with Ctrl+Enter, cancels with Esc, keeps its text when the server refuses, and Up in an empty box edits the last message", async () => {
  const run = Bun.spawn(
    ["bun", "--no-env-file", "run", `${import.meta.dir}/message-edit-typing.script.tsx`],
    { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);
  await run.exited;
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  expect(line, stderr.slice(0, 800)).toBeDefined();
  expect(JSON.parse(line!.slice(7))).toEqual({
    ctrlEnter: {
      start: "see you at noon",
      // Enter alone is a line break in the editor: nothing is saved.
      afterEnter: [],
      saved: ["see you at one"],
      cancelled: [1],
    },
    saveButton: {
      unchanged: { saved: [], cancelled: [1] },
      emptyDisabled: true,
      saved: ["see you at two"],
    },
    refused: { alert: "You can only edit your own messages.", text: "see you at three" },
    upArrow: { afterEmpty: 1, final: 1 },
  });
}, 30_000);
