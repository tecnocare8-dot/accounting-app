// 台帳のCSV。Excelでそのまま開けるよう、先頭に印（BOM）を付けた UTF-8・改行 CRLF で書く。
// 利用者がExcelで保存し直すと Shift_JIS・BOMなし・日付が「2026/10/1」になるので、読むときはそれも受け付ける

export function csvField(v: string | number | boolean): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: (string | number | boolean)[][]): string {
  const lines = [header as string[], ...rows].map((r) => r.map(csvField).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** UTF-8 として読めなければ、Excel の日本語版が使う Shift_JIS として読む */
export function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('shift_jis').decode(data);
  }
}

/** 見出しの名前で列を探す（Excelで列を並べ替えられても読めるように） */
export function readTable(text: string): { rows: string[][]; get: (row: string[], name: string) => string } {
  const [header = [], ...rows] = parseCsv(text);
  const index = new Map(header.map((h, i) => [h.trim(), i]));
  return {
    rows,
    get: (row, name) => {
      const i = index.get(name);
      return i === undefined ? '' : (row[i] ?? '').trim();
    },
  };
}

/** 「2026-10-01」「2026/10/1」を YYYY-MM-DD にする。読めなければ空文字 */
export function normalizeDate(s: string): string {
  const r = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s.trim());
  if (!r) return '';
  return `${r[1]}-${r[2].padStart(2, '0')}-${r[3].padStart(2, '0')}`;
}

/** 「3,300」「¥3,300」「3300円」を数にする。読めなければ 0 */
export function toNumber(s: string): number {
  const n = Number(s.replace(/[,¥￥円\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function toBool(s: string): boolean {
  return ['はい', 'true', 'TRUE', '1'].includes(s.trim());
}

export function fromBool(b: boolean): string {
  return b ? 'はい' : 'いいえ';
}

/**
 * Excel で開いたときに式として動かないよう、= + - @ で始まる文字の前に ' を付ける（数式の埋め込み対策）。
 * 読むときは外す
 */
export const guardText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
export const unguardText = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
