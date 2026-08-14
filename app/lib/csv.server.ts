export type CsvRow = Record<string, string>;

/**
 * Parse CSV into rows keyed by header.
 *
 * Tokenises the whole document in one pass rather than splitting on newlines
 * first: a quoted cell may legally contain newlines, and `generateCsv` emits
 * exactly that for multi-line metafield values. Splitting first meant an
 * exported multi-line value came back as several broken rows, so
 * export → edit → import silently corrupted `multi_line_text_field` data.
 */
export function parseCsv(content: string): CsvRow[] {
  const rows = tokenize(content);
  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((values) =>
    headers.reduce<CsvRow>((acc, header, i) => {
      acc[header] = values[i] ?? "";
      return acc;
    }, {}),
  );
}

export function generateCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCell).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCell(row[h] ?? "")).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

/**
 * Split a CSV document into rows of cells, honouring quoted cells that contain
 * commas, escaped quotes (`""`), or newlines. Blank rows are dropped so a
 * trailing newline doesn't produce a phantom record.
 */
function tokenize(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  const endCell = () => {
    row.push(current);
    current = "";
  };
  const endRow = () => {
    endCell();
    // A row of entirely empty cells is padding, not data.
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (inQuotes) {
      // Normalise CRLF inside a quoted cell so values don't carry stray \r.
      if (ch === "\r" && content[i + 1] === "\n") continue;
      current += ch;
      continue;
    }

    if (ch === ",") {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      // Bare \r or the \r of a CRLF terminator; the \n case is handled above.
      if (content[i + 1] !== "\n") endRow();
    } else {
      current += ch;
    }
  }

  // Flush whatever the final line left behind (no trailing newline).
  if (current !== "" || row.length > 0) endRow();

  return rows;
}

function escapeCell(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
