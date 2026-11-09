import { ShieldWarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ARTIFACT_HTML_CSP } from "@zetta/core/artifact-csp";
import { Button, Checkbox } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Badge, Loading } from "../shared/ui";
import { createAppHost, type Prompt } from "./app-host";
import { appsApi, appsQueries, type AppPage } from "./apps-api";

/** Flags of the frame: scripts only. No same-origin (the page has no cookies and no API), no popups, no forms, no top navigation. */
export const APP_FRAME_SANDBOX = "allow-scripts allow-forms";

/**
 * Draws the page of an app and is the only way it reaches the server. The page runs in a sandboxed frame and can only post messages; the
 * host (`app-host.ts`) reads them, calls the API as the person, and answers. A change that needs approval is shown HERE, in a bar the
 * page cannot draw over or answer.
 */
export function AppFrame({ appRef, className = "" }: { appRef: string; className?: string }) {
  const page = useQuery(appsQueries.ui(appRef));
  if (page.isPending) return <Loading />;
  if (page.error || !page.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {page.error ? errorMessage(page.error) : "This app has no page."}
      </p>
    );
  // A new version is a new document: the frame is made again, so nothing of the old page stays.
  return (
    <Frame
      key={`${page.data.app}:${page.data.version}`}
      page={page.data}
      appRef={appRef}
      className={className}
    />
  );
}

function Frame({ page, appRef, className }: { page: AppPage; appRef: string; className: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [prompts, setPrompts] = useState<readonly Prompt[]>([]);
  useEffect(() => {
    const host = createAppHost({
      tools: page.tools,
      api: { call: (tool, input) => appsApi.call(appRef, tool, input), answer: appsApi.answer },
      reply: (r) => frame.current?.contentWindow?.postMessage(r, "*"),
      onPrompts: setPrompts,
    });
    const onMessage = (e: MessageEvent) => {
      // Only this frame's own window: any other script that posts to this window is not the page.
      const w = frame.current?.contentWindow;
      if (!w || e.source !== w) return;
      void host.handle(e.data);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      host.dispose();
    };
  }, [page, appRef]);
  return (
    <div className={`flex min-h-96 min-w-0 flex-col ${className}`}>
      {prompts[0] && (
        <div className="px-4 py-2 md:px-8">
          <ChangePrompt prompt={prompts[0]} more={prompts.length - 1} appName={page.name} />
        </div>
      )}
      <iframe
        ref={frame}
        title={page.name}
        srcDoc={page.html}
        sandbox={APP_FRAME_SANDBOX}
        {...{ csp: ARTIFACT_HTML_CSP }}
        className="min-h-96 w-full flex-1 bg-background"
      />
    </div>
  );
}

/** The question for a change the page asked for. It belongs to Zetta, so it sits outside the frame with the tool and the exact input. */
export function ChangePrompt({
  prompt,
  more,
  appName,
}: {
  prompt: Prompt;
  more: number;
  appName: string;
}) {
  const [remember, setRemember] = useState(false);
  const input = JSON.stringify(prompt.input ?? {}, null, 2) ?? "{}";
  return (
    <div
      role="alertdialog"
      aria-label={`${appName} asks to change something`}
      className="space-y-2 rounded-lg border border-warn/50 bg-warn/5 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldWarningIcon className="text-warn" aria-hidden="true" />
        <span>
          <strong>{appName}</strong> wants to run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{prompt.tool}</code>
        </span>
        <Badge tone={prompt.kind === "mutation" ? "warning" : "neutral"}>
          {prompt.kind === "mutation" ? "Changes something" : "Reads"}
        </Badge>
        {more > 0 && <span className="text-xs text-muted-foreground">{more} more waiting</span>}
      </div>
      <pre className="max-h-32 overflow-auto rounded bg-muted/60 p-2 text-xs break-words whitespace-pre-wrap">
        {input.length > 2000 ? `${input.slice(0, 2000)}…` : input}
      </pre>
      <p className="text-xs text-muted-foreground">{prompt.reason}</p>
      <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
        Allow this tool while this page is open
      </Checkbox>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="destructive" autoFocus onClick={prompt.refuse}>
          Decline
        </Button>
        <Button size="sm" variant="success" onClick={() => prompt.allow(remember)}>
          Allow
        </Button>
      </div>
    </div>
  );
}
