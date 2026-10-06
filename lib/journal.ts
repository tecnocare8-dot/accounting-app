import { accountMap, SEGMENTS, type Account, type Segment } from './accounts';
import { isClosedDate, isDate, yearOf, type FiscalConfig } from './fiscal';
import { isYen } from './money';

// 伝票（1つの取引）。行は1行に借方・貸方の両方かどちらかを書く。区分は伝票に1つ

export interface JournalLine {
  debitAccount: string; // 科目コード。空＝この行に借方なし
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  memo: string;
}

export interface Voucher {
  id: string;
  /** 年度ごとの通し番号（画面で「No.12」と出す） */
  number: number;
  date: string;
  segment: Segment;
  description: string;
  counterparty: string;
  /** 取り込み元（手入力は空）と、取り込み元でのID。同じ組み合わせは二度入れない */
  source: string;
  sourceId: string;
  lines: JournalLine[];
  createdAt: string;
  updatedAt: string;
}

/** 画面・取り込みから受け取る中身（番号・日時はこちらで付ける） */
export type VoucherInput = Pick<Voucher, 'date' | 'segment' | 'description' | 'counterparty' | 'lines'> & Partial<Pick<Voucher, 'source' | 'sourceId'>>;

export class ValidationError extends Error {
  constructor(public messages: string[]) {
    super(messages.join('\n'));
  }
}
export class NotFoundError extends Error {}

export const sumDebit = (lines: JournalLine[]) => lines.reduce((s, l) => s + (l.debitAccount ? l.debitAmount : 0), 0);
export const sumCredit = (lines: JournalLine[]) => lines.reduce((s, l) => s + (l.creditAccount ? l.creditAmount : 0), 0);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/** 送られてきた値を形だけ整える（中身の正しさは validateVoucher で確かめる） */
export function cleanInput(raw: unknown): VoucherInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    date: str(r.date, 10),
    segment: (SEGMENTS as readonly string[]).includes(r.segment as string) ? (r.segment as Segment) : ('' as Segment),
    description: str(r.description, 200),
    counterparty: str(r.counterparty, 100),
    source: str(r.source, 60),
    sourceId: str(r.sourceId, 200),
    lines: lines.slice(0, 100).map((l) => {
      const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const da = str(x.debitAccount, 10);
      const ca = str(x.creditAccount, 10);
      return {
        debitAccount: da, debitAmount: da ? int(x.debitAmount) : 0,
        creditAccount: ca, creditAmount: ca ? int(x.creditAmount) : 0,
        memo: str(x.memo, 200),
      };
    }).filter((l) => l.debitAccount || l.creditAccount),
  };
}

/** 保存できる伝票か。だめな理由を日本語で返す（空＝保存できる） */
export function validateVoucher(v: VoucherInput, accounts: Account[], fiscal: FiscalConfig): string[] {
  const errors: string[] = [];
  const map = accountMap(accounts);
  if (!isDate(v.date)) errors.push('日付を正しく入れてください。');
  else if (!yearOf(fiscal, v.date)) errors.push(`日付が、帳簿を付け始めた日（${fiscal.firstYearStart}）より前です。`);
  else if (isClosedDate(fiscal, v.date)) errors.push('締めた年度の日付には、伝票を入れたり直したりできません。');
  if (!SEGMENTS.includes(v.segment)) errors.push('区分（収益事業・非収益事業・共通）を選んでください。');
  if (!v.lines.length) errors.push('仕訳の行を入れてください。');
  v.lines.forEach((l, i) => {
    const n = `${i + 1}行目`;
    for (const [side, code, amount] of [['借方', l.debitAccount, l.debitAmount], ['貸方', l.creditAccount, l.creditAmount]] as const) {
      if (!code) continue;
      if (!map.has(code)) errors.push(`${n}：${side}の科目（${code}）がありません。`);
      if (!isYen(amount) || amount === 0) errors.push(`${n}：${side}の金額は1円以上の整数で入れてください。`);
    }
  });
  if (v.lines.length && !errors.some((e) => e.includes('金額'))) {
    const d = sumDebit(v.lines);
    const c = sumCredit(v.lines);
    if (d !== c) errors.push(`借方の合計（${d.toLocaleString()}円）と貸方の合計（${c.toLocaleString()}円）が合いません。`);
  }
  return errors;
}

/** 相手科目の表示（行が複数の科目にわたるときは「諸口」） */
export function counterAccount(v: Voucher, code: string, side: 'debit' | 'credit'): string {
  const others = new Set(v.lines.map((l) => (side === 'debit' ? l.creditAccount : l.debitAccount)).filter((c) => c && c !== code));
  return others.size === 1 ? [...others][0] : others.size ? '諸口' : '';
}

/** 伝票の区分の初期値：収入の科目があればその区分（売上と手数料の伝票は売上で決める）、なければ最初の支出の科目の区分、どちらもなければ非収益事業 */
export function defaultSegment(lines: JournalLine[], accounts: Account[]): Segment {
  const map = accountMap(accounts);
  const used = lines.flatMap((l) => [l.debitAccount, l.creditAccount]).map((c) => (c ? map.get(c) : undefined)).filter((a): a is Account => !!a);
  return (used.find((a) => a.type === 'revenue') ?? used.find((a) => a.type === 'expense'))?.segment ?? 'nonprofit';
}
