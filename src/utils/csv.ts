/**
 * CSV export.
 *
 * Values are quoted only when they need it, and every field is escaped so a
 * customer id, a comma in a country name, or a stray quote can never break the
 * column structure. The download happens client-side from a Blob — no server
 * round-trip and nothing leaves the browser.
 */

/**
 * RFC-4180 escaping: wrap in quotes if the value contains a comma, quote or
 * newline. Text cells are also guarded against CSV formula injection — a value
 * beginning with `=`, `+`, `-`, `@` or a control char is prefixed with an
 * apostrophe so a spreadsheet (Excel, LibreOffice, Google Sheets) treats it as
 * text rather than executing it. Numbers passed as `number` are left untouched,
 * so numeric columns stay usable.
 */
function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<T> {
  header: string;
  /** Raw, unformatted cell value — a CSV wants numbers, not "$14,710". */
  value: (row: T) => string | number | null;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeField(c.header)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escapeField(c.value(r))).join(','))
    .join('\r\n');
  // BOM so Excel opens UTF-8 (accented country and product names) correctly.
  return `\uFEFF${head}\r\n${body}`;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const blob = new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
