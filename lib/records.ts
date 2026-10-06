import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, SEGMENT_LABEL, SEGMENTS, type Account, type AccountType, type Segment } from './accounts';
import { fromBool, guardText, normalizeDate, readTable, toBool, toCsv, unguardText } from './csv';
import { yearOf, type FiscalConfig } from './fiscal';
import { parseYen } from './money';
import type { JournalLine, Voucher } from './journal';

// ---------------------------------------------------------------- 仕訳帳.csv
// 1行＝仕訳の1行。同じ伝票IDの行で1つの取引。伝票の項目（日付・区分・摘要など）は各行に同じ値を書く
const JOURNAL_COLUMNS = [
  '伝票ID', '伝票番号', '日付', '行番号', '借方科目コード', '借方科目', '借方金額', '貸方科目コード', '貸方科目', '貸方金額',
  '区分', '摘要', '行の摘要', '取引先', '取り込み元', '取り込み元ID', '年度', '作成日時', '更新日時',
] as const;

export function journalToCsv(vouchers: Voucher[], accounts: Account[], fiscal: FiscalConfig): string {
  const name = (code: string) => accounts.find((a) => a.code === code)?.name ?? '';
  const sorted = [...vouchers].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  return toCsv(JOURNAL_COLUMNS, sorted.flatMap((v) => v.lines.map((l, i) => [
    v.id, v.number, v.date, i + 1,
    l.debitAccount, l.debitAccount ? name(l.debitAccount) : '', l.debitAccount ? l.debitAmount : '',
    l.creditAccount, l.creditAccount ? name(l.creditAccount) : '', l.creditAccount ? l.creditAmount : '',
    SEGMENT_LABEL[v.segment], guardText(v.description), guardText(l.memo), guardText(v.counterparty), v.source, guardText(v.sourceId),
    yearOf(fiscal, v.date)?.start ?? '', v.createdAt, v.updatedAt,
  ])));
}

const segmentOf = (s: string): Segment => SEGMENTS.find((k) => k === s || SEGMENT_LABEL[k] === s) ?? 'nonprofit';

export function journalFromCsv(text: string): Voucher[] {
  const t = readTable(text);
  const byId = new Map<string, { v: Voucher; lines: { no: number; line: JournalLine }[] }>();
  for (const r of t.rows) {
    const id = t.get(r, '伝票ID');
    if (!id) continue;
    let entry = byId.get(id);
    if (!entry) {
      entry = {
        v: {
          id, number: Number(t.get(r, '伝票番号')) || 0, date: normalizeDate(t.get(r, '日付')), segment: segmentOf(t.get(r, '区分')),
          description: unguardText(t.get(r, '摘要')), counterparty: unguardText(t.get(r, '取引先')),
          source: t.get(r, '取り込み元'), sourceId: unguardText(t.get(r, '取り込み元ID')),
          lines: [], createdAt: t.get(r, '作成日時'), updatedAt: t.get(r, '更新日時'),
        },
        lines: [],
      };
      byId.set(id, entry);
    }
    const da = t.get(r, '借方科目コード');
    const ca = t.get(r, '貸方科目コード');
    entry.lines.push({
      no: Number(t.get(r, '行番号')) || entry.lines.length + 1,
      line: {
        debitAccount: da, debitAmount: da ? parseYen(t.get(r, '借方金額')) ?? 0 : 0,
        creditAccount: ca, creditAmount: ca ? parseYen(t.get(r, '貸方金額')) ?? 0 : 0,
        memo: unguardText(t.get(r, '行の摘要')),
      },
    });
  }
  return [...byId.values()].map(({ v, lines }) => ({ ...v, lines: lines.sort((a, b) => a.no - b.no).map((x) => x.line) }));
}

// ---------------------------------------------------------------- 勘定科目.csv
const ACCOUNT_COLUMNS = ['コード', '科目', '種類', '区分の初期値', '課税売上に数える', '要確認', '使う'] as const;

export function accountsToCsv(list: Account[]): string {
  return toCsv(ACCOUNT_COLUMNS, list.map((a) => [
    a.code, guardText(a.name), ACCOUNT_TYPE_LABEL[a.type], SEGMENT_LABEL[a.segment], fromBool(a.taxableSales), fromBool(a.needsCheck), fromBool(a.active),
  ]));
}

export function accountsFromCsv(text: string): Account[] {
  const t = readTable(text);
  const typeOf = (s: string): AccountType | undefined => ACCOUNT_TYPES.find((k) => k === s || ACCOUNT_TYPE_LABEL[k] === s);
  return t.rows.flatMap((r) => {
    const code = t.get(r, 'コード');
    const type = typeOf(t.get(r, '種類'));
    if (!/^\d{3}$/.test(code) || !type) return [];
    return [{
      code, name: unguardText(t.get(r, '科目')) || code, type, segment: segmentOf(t.get(r, '区分の初期値')),
      taxableSales: toBool(t.get(r, '課税売上に数える')), needsCheck: toBool(t.get(r, '要確認')), active: t.get(r, '使う') === '' || toBool(t.get(r, '使う')),
    }];
  });
}

// ---------------------------------------------------------------- 取り込み記録.csv
export interface ImportLog {
  at: string;
  actor: string;
  kind: string; // 取り込みの種類（画面の名前）
  fileName: string;
  added: number;
  skipped: number;
}

const IMPORT_COLUMNS = ['日時', '操作した人', '取り込み元', 'ファイル名', '取り込んだ件数', '取り込まなかった件数'] as const;

export function importLogToCsv(list: ImportLog[]): string {
  return toCsv(IMPORT_COLUMNS, list.map((l) => [l.at, l.actor, l.kind, guardText(l.fileName), l.added, l.skipped]));
}

export function importLogFromCsv(text: string): ImportLog[] {
  const t = readTable(text);
  return t.rows.map((r) => ({
    at: t.get(r, '日時'), actor: t.get(r, '操作した人'), kind: t.get(r, '取り込み元'), fileName: unguardText(t.get(r, 'ファイル名')),
    added: Number(t.get(r, '取り込んだ件数')) || 0, skipped: Number(t.get(r, '取り込まなかった件数')) || 0,
  })).filter((l) => l.at);
}
