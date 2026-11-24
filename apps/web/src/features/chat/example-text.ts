/**
 * What the box holds after the person clicks an example question. An empty box takes the example. A box with text keeps it: the example
 * goes on a new line after it, so a click never destroys what was typed.
 */
export function withExample(current: string, example: string): string {
  const kept = current.trimEnd();
  return kept ? `${kept}\n${example}` : example;
}
