import { Link } from "@tanstack/react-router";
import {
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CaretUpIcon,
  LinkSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { KeyboardEvent } from "react";
import { toast } from "sonner";
import { Modal } from "@g4rcez/components/modal";
import { Button } from "@/components/ui";
import { useMedia } from "@/lib/use-media";
import { StatusIcon } from "./task-badges";
import { TaskDetail } from "./task-page";
import type { Task } from "./tasks-api";

const iconButton =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40";

type PeekProps = {
  /** The id in the URL. */
  taskId: string;
  /** The tasks on the board now, in the order they show, for "N of M" and the up and down buttons. */
  tasks: Task[];
  knownLabels: string[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onChange: (task: Task) => void;
  onDeleted: (id: string) => void;
};

/** Escape closes the panel, unless it is already doing something with that key (a menu, a text field). */
const closesPanel = (e: KeyboardEvent) =>
  e.key === "Escape" &&
  !e.defaultPrevented &&
  !(e.target as HTMLElement).closest(
    "input, textarea, [contenteditable], [role=menu], [role=listbox], [role=dialog]",
  );

function PeekPanel({
  taskId,
  tasks,
  knownLabels,
  onOpen,
  onClose,
  onChange,
  onDeleted,
}: PeekProps) {
  const index = tasks.findIndex((t) => t.id === taskId);
  const current = tasks[index];
  const previous = tasks[index - 1];
  const next = tasks[index + 1];
  const copyLink = () =>
    navigator.clipboard.writeText(`${window.location.origin}/tasks/${taskId}`).then(
      () => void toast.success("Link copied"),
      () => void toast.error("Could not copy the link"),
    );

  return (
    <section
      aria-label="Task details"
      onKeyDown={(e) => closesPanel(e) && onClose()}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex items-center gap-1 border-b px-3 py-2">
        {current && <StatusIcon status={current.status} />}
        {current && (
          <span className="ml-1 text-sm text-muted-foreground tabular-nums">
            {index + 1} of {tasks.length}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous task"
          disabled={!previous}
          onClick={() => previous && onOpen(previous.id)}
          className="ml-1"
        >
          <CaretUpIcon aria-hidden className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next task"
          disabled={!next}
          onClick={() => next && onOpen(next.id)}
        >
          <CaretDownIcon aria-hidden className="size-4" />
        </Button>
        <span className="ml-auto" />
        <Link
          to="/tasks/$taskId"
          params={{ taskId }}
          aria-label="Open as a page"
          title="Open as a page"
          className={iconButton}
        >
          <ArrowsOutSimpleIcon aria-hidden className="size-4" />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy link"
          title="Copy link"
          onClick={() => void copyLink()}
        >
          <LinkSimpleIcon aria-hidden className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close" title="Close" onClick={onClose}>
          <XIcon aria-hidden className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* `key` gives each task its own state, so the thread of the last task never shows on the next. */}
        <TaskDetail
          key={taskId}
          id={taskId}
          variant="peek"
          initial={current}
          knownLabels={knownLabels}
          onChange={onChange}
          onDeleted={() => onDeleted(taskId)}
        />
      </div>
    </section>
  );
}

/** The task open on the board. A pane beside the board on wide screens, so the board stays usable; a sheet on narrow ones. */
export function TaskPeek(props: PeekProps) {
  const desktop = useMedia("(min-width: 1024px)");
  const reduceMotion = useReducedMotion();
  if (!desktop) {
    return (
      <Modal
        type="drawer"
        forceType
        open
        onChange={(open) => !open && props.onClose()}
        ariaTitle="Task details"
        closable={false}
        resizer={false}
        overlayClickClose
        className="max-w-full p-0"
        bodyClassName="flex w-screen max-w-full flex-col p-0 sm:w-xl"
      >
        <PeekPanel {...props} />
      </Modal>
    );
  }
  return (
    <aside className="flex min-h-0 w-[min(52rem,55vw)] shrink-0 flex-col border-l">
      {/* DESIGN.md "Motion": panels arrive in 200ms; with reduced motion they just appear. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <PeekPanel {...props} />
      </motion.div>
    </aside>
  );
}
