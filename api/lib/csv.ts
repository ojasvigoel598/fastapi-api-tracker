/**
 * Escape a single CSV cell value (RFC 4180).
 *
 * - Fields containing a comma, quote, or newline are wrapped in double quotes
 *   and any embedded `"` is doubled (`""`).
 * - Values that start with `=`, `+`, `-`, `@`, tab, or CR are prefixed with a
 *   single quote so a spreadsheet can't treat them as a formula when the
 *   export is opened in Excel/Sheets (formula-injection guard).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const needsQuotes = /[",\r\n]/.test(text);
  let escaped = text.replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = `'${escaped}`;
  }
  return needsQuotes ? `"${escaped}"` : escaped;
}
