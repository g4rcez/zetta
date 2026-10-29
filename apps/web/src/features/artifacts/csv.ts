/** Parses CSV/TSV text (quoted fields, doubled quotes, CRLF). Stops after `maxRows` rows and says so. */
export function parseCsv(text: string, delimiter = ",", maxRows = 1000) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;
  const endRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length > maxRows) {
        truncated = true;
        rows.pop();
        break;
      }
    } else field += c;
  }
  if (!truncated && (field !== "" || row.length > 0)) endRow();
  return { rows, truncated };
}
