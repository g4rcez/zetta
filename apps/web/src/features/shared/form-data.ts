/** A text field of a submitted form. A field the form does not have is `""`: `String(null)` would be the text "null". */
export const formText = (f: FormData, key: string): string => String(f.get(key) ?? "");
