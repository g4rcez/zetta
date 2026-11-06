import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { skillsApi } from "./skills-api";

/** The files next to a skill's SKILL.md (scripts, references, assets), read-only. The list is read from the server when it is opened. */
export function SkillFiles({ id, count }: { id: string; count: number }) {
  const [open, setOpen] = useState(false);
  const { data, error } = useQuery({
    queryKey: ["skills", "files", id],
    queryFn: () => skillsApi.get(id),
    select: (skill) => skill.files,
    enabled: open,
  });
  return (
    <div className="text-xs">
      <Button
        size="sm"
        variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {count} {count === 1 ? "file" : "files"} next to SKILL.md
      </Button>
      {open && (
        <ul aria-label="Files of this skill" className="mt-1 space-y-0.5 pl-3 font-mono">
          {error && <li className="font-sans text-destructive">Could not load the files.</li>}
          {!data && !error && <li className="font-sans text-muted-foreground">Loading…</li>}
          {data?.map((f) => (
            <li key={f.path} className="flex flex-wrap gap-x-3">
              <span className="break-all">{f.path}</span>
              <span className="tabular-nums text-muted-foreground">{formatSize(f.size)}</span>
              {f.mode === "executable" && (
                <span className="font-sans text-muted-foreground">executable</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
