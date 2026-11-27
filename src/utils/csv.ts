/** Quotes a CSV cell and neutralizes spreadsheet formula injection. */
export function csvCell(value: string) {
  const text = value.replace(/\r?\n/g, ' ')
  // Spreadsheet apps may ignore leading whitespace before a formula marker.
  const safe = /^\s*[=+\-@\t]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
