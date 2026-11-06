import { indentWithTab } from "@codemirror/commands";
import { keymap, lineNumbers } from "@codemirror/view";

import { Editor } from "@/components/editor/editor";
import { languageOfFile } from "./playground-api";

// Read once when the editor starts: a code file wants line numbers, and Tab indents instead of moving focus.
const CODE = [lineNumbers(), keymap.of([indentWithTab])];

/**
 * One file of a playground, edited as code in the language of its extension. It fills its box and scrolls inside it.
 * Switching files starts a new editor (and its own undo history).
 */
export function CodeEditor({
  path,
  value,
  onChange,
  readOnly,
}: {
  path: string;
  value: string;
  onChange: (text: string) => void;
  readOnly: boolean;
}) {
  return (
    // Plain on purpose: source code, not natural language, so there is no `@` or `#` mention picker.
    <Editor
      key={path}
      aria-label={`Code of ${path}`}
      value={value}
      onChange={onChange}
      disabled={readOnly}
      language={languageOfFile(path)}
      extensions={CODE}
    />
  );
}
