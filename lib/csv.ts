const RISKY_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  text = text.replace(/\r\n|\r|\n/g, " ");
  if (text.length > 0 && RISKY_PREFIXES.includes(text[0])) {
    text = `'${text}`;
  }
  if (text.includes('"')) {
    text = text.replace(/"/g, '""');
  }
  if (text.includes(",") || text.includes('"') || text.includes(" ")) {
    return `"${text}"`;
  }
  return text;
}

export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row[column])).join(","),
  );
  return [header, ...body].join("\n");
}
