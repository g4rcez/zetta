import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder as placeholderText,
  rectangularSelection,
} from "@codemirror/view";
import { InputField } from "@g4rcez/components";
import { classHighlighter } from "@lezer/highlight";
import { cn } from "@zetta/ui/lib/utils";
import { markdownTyping } from "./markdown-typing";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

/** A change that comes from the `value` prop. It is not sent back through `onChange`, and `maxLength` does not cut it. */
const external = Annotation.define<boolean>();

/** Ctrl/Cmd+F opens a find and replace bar. Only a labeled field has it: in the chat box the shortcut stays with the browser's page search. */
const findInText: Extension = [search({ top: true }), keymap.of(searchKeymap)];

const COMPLETION_KEYS = new Set(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"]);

/** How many values sent through `onChange` wait for their echo in `value`. */
const MAX_ECHOES = 50;

export type EditorProps = {
  /** Controlled text. Use `defaultValue` instead for a form field that keeps its own text. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((text: string) => void) | undefined;
  /** The text and the caret, after every edit and every move of the caret. */
  onSelect?: ((text: string, caret: number) => void) | undefined;
  /** Runs before CodeMirror sees the key. Call `e.preventDefault()` to take the key (Enter to send, a picker list). */
  onKeyDown?: ((e: KeyboardEvent, view: EditorView) => void) | undefined;
  onPaste?: ((e: ClipboardEvent, view: EditorView) => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** The view, for callers that read the selection or write a change. */
  viewRef?: RefObject<EditorView | null> | undefined;
  /** With a name, a hidden `<textarea>` carries the text, so `FormData`, `required` and the form's `input` events work as with a textarea. */
  name?: string | undefined;
  required?: boolean | undefined;
  maxLength?: number | undefined;
  /** The least height, in lines. */
  rows?: number | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
  id?: string | undefined;
  enterKeyHint?: string | undefined;
  "aria-label"?: string | undefined;
  /** More attributes of the editable element (`role`, `aria-expanded`, ...). */
  attributes?: Record<string, string | undefined> | undefined;
  /** More CodeMirror extensions, read once when the editor starts (for example the mention chips). */
  extensions?: Extension | undefined;
  /** The user can drag the bottom edge to change the height, as in a textarea. */
  resizable?: boolean | undefined;
};

const contentAttributes = (p: EditorProps) =>
  EditorView.contentAttributes.of(
    Object.fromEntries(
      Object.entries({
        id: p.id,
        "aria-label": p["aria-label"],
        "aria-required": p.required ? "true" : undefined,
        "aria-disabled": p.disabled ? "true" : undefined,
        enterkeyhint: p.enterKeyHint,
        ...p.attributes,
      }).filter((e): e is [string, string] => e[1] !== undefined),
    ),
  );

/**
 * The app's text box: CodeMirror 6 in Markdown mode. A fenced block is highlighted in the language of its info string, loaded on demand.
 * Styles are in `codemirror.css`. Keys that matter in a text box stay as in a textarea: Tab moves focus (except on a list line or in a code block), Enter adds a line.
 * Markdown typing helps: Enter continues a list, Backspace removes an empty marker, Tab nests an item, Ctrl/Cmd+B and +I mark bold and italic.
 * Gutters (line numbers, folding) and the active-line highlight are left out on purpose: they are for code editors, not for a text box.
 */
export function Editor(props: EditorProps) {
  const { name, required, rows, className, disabled, placeholder, resizable } = props;
  const host = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLTextAreaElement>(null);
  const view = useRef<EditorView | null>(null);
  const echoes = useRef<string[]>([]);
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  const [slots] = useState(() => ({
    editable: new Compartment(),
    placeholder: new Compartment(),
    attributes: new Compartment(),
  }));
  const [initial] = useState(() => props.value ?? props.defaultValue ?? "");
  const attributesKey = JSON.stringify([
    props.id,
    props["aria-label"],
    props.enterKeyHint,
    required,
    disabled,
    props.attributes,
  ]);

  useEffect(() => {
    const p = live.current;
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          highlightSpecialChars(),
          rectangularSelection(),
          crosshairCursor(),
          EditorState.allowMultipleSelections.of(true),
          EditorState.tabSize.of(4),
          indentUnit.of("    "),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ icons: false }),
          highlightSelectionMatches(),
          Prec.high(markdownTyping),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          markdown({ codeLanguages: languages, addKeymap: false }),
          syntaxHighlighting(classHighlighter),
          p.extensions ?? [],
          slots.editable.of([
            EditorView.editable.of(!p.disabled),
            EditorState.readOnly.of(!!p.disabled),
          ]),
          slots.placeholder.of(p.placeholder ? placeholderText(p.placeholder) : []),
          slots.attributes.of(contentAttributes(p)),
          EditorState.transactionFilter.of((tr) => {
            const max = live.current.maxLength;
            return max !== undefined &&
              tr.docChanged &&
              !tr.annotation(external) &&
              tr.newDoc.length > max
              ? []
              : tr;
          }),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (e, v) => {
                // An open completion list owns these keys, as the mention list does for the caller.
                if (COMPLETION_KEYS.has(e.key) && completionStatus(v.state) === "active")
                  return false;
                live.current.onKeyDown?.(e, v);
                return e.defaultPrevented;
              },
              paste: (e, v) => {
                live.current.onPaste?.(e, v);
                return e.defaultPrevented;
              },
              blur: () => {
                live.current.onBlur?.();
              },
            }),
          ),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged && !u.selectionSet) return;
            const text = u.state.doc.toString();
            const fromProp = u.transactions.some((t) => t.annotation(external));
            if (u.docChanged) {
              const area = mirror.current;
              if (area) {
                area.value = text;
                // The form listens to `input` to know it has unsaved edits.
                const win = area.ownerDocument.defaultView;
                area.dispatchEvent(new (win?.Event ?? Event)("input", { bubbles: true }));
              }
              if (!fromProp) {
                echoes.current = [...echoes.current, text].slice(-MAX_ECHOES);
                live.current.onChange?.(text);
              }
            }
            if (!fromProp) live.current.onSelect?.(text, u.state.selection.main.head);
          }),
        ],
      }),
    });
    view.current = editor;
    if (props.viewRef) props.viewRef.current = editor;
    if (p.autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
      if (props.viewRef) props.viewRef.current = null;
    };
    // The view lives as long as the component; everything else reaches it through `live` and the compartments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        slots.editable.reconfigure([
          EditorView.editable.of(!disabled),
          EditorState.readOnly.of(!!disabled),
        ]),
        slots.placeholder.reconfigure(placeholder ? placeholderText(placeholder) : []),
        slots.attributes.reconfigure(contentAttributes(live.current)),
      ],
    });
  }, [slots, disabled, placeholder, attributesKey]);

  // A new `value` from the parent replaces the text, unless it is only the echo of what the user typed.
  useEffect(() => {
    const v = view.current,
      value = props.value;
    if (!v || value === undefined) return;
    const at = echoes.current.indexOf(value);
    if (at >= 0) {
      echoes.current = echoes.current.slice(at + 1);
      return;
    }
    echoes.current = [];
    const text = v.state.doc.toString();
    if (value !== text)
      v.dispatch({
        changes: { from: 0, to: text.length, insert: value },
        selection: { anchor: value.length },
        annotations: external.of(true),
      });
  }, [props.value]);

  return (
    <div
      className={cn("cm-root relative min-w-0", className)}
      data-resizable={resizable ? "" : undefined}
      style={{ "--editor-rows": rows ?? 1 } as CSSProperties}
      // A click on the padding around the text still puts the caret in the editor.
      onClick={(e) => e.target === e.currentTarget && view.current?.focus()}
    >
      <div ref={host} />
      {(name || required) && (
        <textarea
          ref={mirror}
          name={name}
          required={required}
          defaultValue={initial}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onInvalid={() => view.current?.focus()}
        />
      )}
    </div>
  );
}

export type EditorFieldProps = EditorProps & {
  title?: ReactNode;
  info?: ReactNode;
  error?: string | undefined;
  feedback?: ReactNode;
  reportStatus?: boolean | undefined;
  hiddenLabel?: boolean | undefined;
  container?: string | undefined;
};

/** The least height of a field, in lines: the `Textarea` it replaces has the same default. */
const FIELD_ROWS = 2;

/** The editor inside the library's field frame: label, `required` mark, error and feedback, as the `Textarea` it replaces. */
export function EditorField({
  title,
  info,
  error,
  feedback,
  reportStatus,
  hiddenLabel,
  container,
  className,
  ...editor
}: EditorFieldProps) {
  return (
    <InputField
      componentName="textarea"
      title={title}
      info={info}
      error={error}
      feedback={feedback}
      reportStatus={reportStatus}
      hiddenLabel={hiddenLabel}
      container={container}
      required={editor.required}
      disabled={editor.disabled}
      name={editor.name}
      labelClassName={editor.disabled ? undefined : "cm-field"}
    >
      <Editor
        aria-label={typeof title === "string" ? title : undefined}
        resizable
        {...editor}
        rows={editor.rows ?? FIELD_ROWS}
        extensions={[findInText, editor.extensions ?? []]}
        className={cn("w-full flex-1 text-foreground", className)}
      />
    </InputField>
  );
}
