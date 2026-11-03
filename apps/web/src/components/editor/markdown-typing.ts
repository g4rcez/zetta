import { indentLess, indentMore, insertNewlineAndIndent, insertTab } from "@codemirror/commands";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
} from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";

/** A line that starts a Markdown list item: `-`, `*`, `+`, `1.` or `1)`, with an optional `[ ]` task box. */
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

const inList = (state: EditorState) =>
  LIST_ITEM.test(state.doc.lineAt(state.selection.main.head).text);

const inCode = (state: EditorState) => {
  for (
    let n = syntaxTree(state).resolveInner(state.selection.main.head, -1);
    n.parent;
    n = n.parent
  )
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
};

/**
 * Tab keeps its textarea meaning (it moves focus) except where a person expects an indent:
 * on a list line it nests the item, in a code block it indents the code.
 */
const tab: Command = (view) => {
  const { state } = view;
  if (inList(state)) return indentMore(view);
  if (!inCode(state)) return false;
  return state.selection.ranges.some((r) => !r.empty) ? indentMore(view) : insertTab(view);
};
const shiftTab: Command = (view) =>
  inList(view.state) || inCode(view.state) ? indentLess(view) : false;

/** Wraps each selection in `mark` (`**`, `_`), or takes it off when it is already there. Without a selection it puts the caret between two marks. */
const toggle =
  (mark: string): Command =>
  (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const { doc } = view.state;
        const n = mark.length;
        const before = doc.sliceString(Math.max(0, range.from - n), range.from);
        const after = doc.sliceString(range.to, range.to + n);
        if (before === mark && after === mark)
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        return {
          changes: [
            { from: range.from, insert: mark },
            { from: range.to, insert: mark },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      }),
      { userEvent: "input" },
    );
    return true;
  };

// Enter on an empty item ends the list at once. The default would first turn a two-item list into a loose one.
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

export const markdownBindings: readonly KeyBinding[] = [
  { key: "Enter", run: continueMarkup },
  { key: "Shift-Enter", run: (v) => continueMarkup(v) || insertNewlineAndIndent(v) },
  { key: "Backspace", run: deleteMarkupBackward },
  { key: "Tab", run: tab },
  { key: "Shift-Tab", run: shiftTab },
  { key: "Mod-b", run: toggle("**") },
  { key: "Mod-i", run: toggle("_") },
];

const WRAP_KEYS = new Set(["*", "_", "~"]);

/**
 * Typing `*`, `_` or `~` over selected text wraps it, as code editors do with brackets. The inner text stays selected, so a second press stacks
 * (`*` then `*` gives bold). Nothing happens across lines or in code, where the key is a plain character.
 */
export const wrapOnType = (view: EditorView, from: number, to: number, text: string) => {
  const { state } = view;
  const range = state.selection.main;
  if (!WRAP_KEYS.has(text) || range.empty || from !== range.from || to !== range.to) return false;
  if (state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number || inCode(state))
    return false;
  view.dispatch({
    changes: [
      { from: range.from, insert: text },
      { from: range.to, insert: text },
    ],
    selection: EditorSelection.range(range.from + 1, range.to + 1),
    userEvent: "input.type",
  });
  return true;
};

/** Typing helpers for Markdown that a plain textarea does not have. Enter and Backspace on a list use the Markdown language's own commands. */
export const markdownTyping: Extension = [
  keymap.of(markdownBindings),
  EditorView.inputHandler.of(wrapOnType),
];
