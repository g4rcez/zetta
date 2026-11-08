import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { TaskFollowUp, TaskSteps } = await import("./task-plan");
const { tasksQueries } = await import("./tasks-api");
type Task = import("./tasks-api").Task;

const task = (over: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  description: "",
  status: "in_progress",
  priority: "none",
  labels: [],
  ownerUserId: "owner",
  assignee: "bot",
  assigneeUserId: null,
  assigneeName: null,
  botId: "00000000-0000-7000-8000-000000000001",
  conversationId: "00000000-0000-7000-8000-000000000002",
  parentTaskId: null,
  progress: "",
  followUp: "off",
  followUpReason: null,
  nextCheckAt: null,
  checks: 0,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  ...over,
});

const parent = task({ id: "p", title: "Launch notes" });
const steps = [
  task({ id: "s1", title: "Collect changes", status: "done", parentTaskId: "p" }),
  task({ id: "s2", title: "Write notes", status: "backlog", parentTaskId: "p" }),
];

const calls: { method: string; path: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push({
    method: init?.method ?? "GET",
    path: url.pathname,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });
  return Response.json({ task: steps[1] });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function mount(node: (client: QueryClient) => React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(tasksQueries.list().queryKey, [parent, ...steps]);
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node(client)}</QueryClientProvider>);
  });
  return { host: host as unknown as HTMLElement, client };
}

test("the steps show as a checklist with how many are done", async () => {
  const { host } = await mount(() => <TaskSteps task={parent} steps={steps} />);
  expect(host.textContent).toContain("1/2 done");
  const boxes = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  expect(host.textContent).toContain("Collect changes");
  expect(host.textContent).toContain("Write notes");
});

test("ticking a step marks it done at once and tells the server", async () => {
  calls.length = 0;
  const { host, client } = await mount(() => <TaskSteps task={parent} steps={steps} />);
  const box = host.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
  await act(async () => {
    box.click();
  });
  await settle();
  expect(calls).toContainEqual({
    method: "PATCH",
    path: "/api/tasks/s2",
    body: { status: "done" },
  });
  const cached = client.getQueryData<Task[]>(tasksQueries.list().queryKey);
  expect(cached?.find((t) => t.id === "s1")?.status).toBe("done");
});

test("removing a step asks the server to delete it", async () => {
  calls.length = 0;
  const { host } = await mount(() => <TaskSteps task={parent} steps={steps} />);
  const remove = host.querySelector('[aria-label="Remove step Write notes"]') as HTMLElement;
  await act(async () => {
    remove.click();
  });
  await settle();
  expect(calls).toContainEqual({ method: "DELETE", path: "/api/tasks/s2", body: undefined });
});

test("a task with no steps says where the plan comes from", async () => {
  const { host } = await mount(() => <TaskSteps task={parent} steps={[]} />);
  expect(host.textContent).toContain("No steps yet");
});

test("a followed task says so, when it is checked next, and can be stopped", async () => {
  const asked: string[] = [];
  const now = Date.parse("2026-11-07T12:00:00.000Z");
  const followed = task({
    id: "p",
    title: "T",
    followUp: "auto",
    nextCheckAt: new Date(now + 150_000).toISOString(),
    progress: "Notes A and B are written.",
  });
  const { host } = await mount(() => (
    <TaskFollowUp task={followed} now={now} onFollowUp={(to) => void asked.push(to)} />
  ));
  expect(host.textContent).toContain("Following");
  expect(host.textContent).toContain("Next check in 2m");
  expect(host.textContent).toContain("Notes A and B are written.");
  const stop = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Stop following",
  )!;
  await act(async () => {
    stop.click();
  });
  expect(asked).toEqual(["off"]);
});

test("a paused task shows why and can be resumed", async () => {
  const asked: string[] = [];
  const paused = task({
    id: "p",
    title: "T",
    followUp: "paused",
    followUpReason: "no progress recorded in the last 3 follow-ups",
  });
  const { host } = await mount(() => (
    <TaskFollowUp task={paused} onFollowUp={(to) => void asked.push(to)} />
  ));
  expect(host.textContent).toContain("Paused");
  expect(host.textContent).toContain("no progress recorded in the last 3 follow-ups");
  const resume = [...host.querySelectorAll("button")].find((b) => b.textContent === "Resume")!;
  await act(async () => {
    resume.click();
  });
  expect(asked).toEqual(["auto"]);
});

test("a task nobody follows offers to, a finished one and a task with no bot show nothing", async () => {
  const asked: string[] = [];
  const open = await mount(() => (
    <TaskFollowUp task={task({ id: "p", title: "T" })} onFollowUp={(to) => void asked.push(to)} />
  ));
  const follow = [...open.host.querySelectorAll("button")].find(
    (b) => b.textContent === "Follow up",
  )!;
  await act(async () => {
    follow.click();
  });
  expect(asked).toEqual(["auto"]);
  const finished = await mount(() => (
    <TaskFollowUp task={task({ id: "p", title: "T", status: "done" })} onFollowUp={() => {}} />
  ));
  expect(finished.host.textContent).toBe("");
  const noBot = await mount(() => (
    <TaskFollowUp
      task={task({ id: "p", title: "T", botId: null, conversationId: null })}
      onFollowUp={() => {}}
    />
  ));
  expect(noBot.host.textContent).toBe("");
});
