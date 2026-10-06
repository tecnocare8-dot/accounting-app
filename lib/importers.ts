import { accountMap, type Account } from './accounts';
import { parseCsv } from './csv';
import { isClosedDate, isDate, yearOf } from './fiscal';
import { defaultSegment, type JournalLine, type Voucher, type VoucherInput } from './journal';
import { parseYen } from './money';
import type { Settings } from './settings';

// CSV から伝票の候補を作る。候補は画面で確かめて（科目・区分を直し、入れるものを選んで）から帳簿に入れる

export const IMPORT_KINDS = ['receipts', 'document-payouts', 'document-incomes', 'document-payments', 'bank'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  receipts: '領収書アプリ（領収書一覧.csv）',
  'document-payouts': '書類アプリ：業務委託の支払い（支払記録.csv）',
  'document-incomes': '書類アプリ：請求書のない入金（その他の入金.csv）',
  'document-payments': '書類アプリ：請求書の入金（入金記録.csv）',
  bank: '銀行の明細',
};

export type CandidateStatus = 'ok' | 'needsAccount' | 'duplicate' | 'maybeDuplicate' | 'excluded' | 'error';
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  ok: '取り込める', needsAccount: '科目を選んでください', duplicate: '取り込み済み', maybeDuplicate: '二重の恐れ', excluded: '取り込まない', error: '取り込めない',
};

export interface Candidate {
  row: number; // CSV の何行目か（見出しの次を1）
  status: CandidateStatus;
  note: string;
  /** 初期の「取り込む」の印 */
  include: boolean;
  input: VoucherInput & { source: string; sourceId: string };
}

export interface BankOptions {
  /** 預金の科目（普通預金など） */
  bankAccount: string;
  dateCol: number;
  descCol: number;
  /** 入金・出金が別の列のとき */
  inCol: number;
  outCol: number;
  /** 1つの列に＋−で入っているとき（inCol・outCol より優先） */
  amountCol: number;
  /** 見出しの行（0から） */
  headerRow: number;
}

export interface ParsedTable {
  headers: string[];
  headerRow: number;
}

// ---------------------------------------------------------------- 共通

const WAREKI: Record<string, number> = { R: 2018, H: 1988, 令和: 2018, 平成: 1988 };

/** 「2026-10-01」「2026/10/1」「20261001」「2026年10月1日」「R8.10.1」「令和8年10月1日」を YYYY-MM-DD に。読めなければ空 */
export function parseDate(s: string): string {
  const t = s.trim();
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(t) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  let y: number | null = m ? Number(m[1]) : null;
  if (!m) {
    m = /^(R|H|令和|平成)\s*(\d{1,2})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(t);
    if (m) {
      y = WAREKI[m[1]] + Number(m[2]);
      m = [m[0], String(y), m[3], m[4]] as unknown as RegExpExecArray;
    }
  }
  if (!m || y === null) return '';
  const d = `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isDate(d) ? d : '';
}

/** 見出しで列を探す（Excel で列を並べ替えられても読めるように） */
function table(text: string) {
  const [header = [], ...rows] = parseCsv(text);
  const index = new Map(header.map((h, i) => [h.trim(), i]));
  return {
    rows,
    has: (name: string) => index.has(name),
    get: (row: string[], name: string) => {
      const i = index.get(name);
      return i === undefined ? '' : (row[i] ?? '').trim();
    },
  };
}

function need(t: ReturnType<typeof table>, names: string[], file: string) {
  const missing = names.filter((n) => !t.has(n));
  if (missing.length) throw new ImportFormatError(`${file} の形ではありません（「${missing.join('」「')}」の列がありません）。ファイルを確かめてください。`);
}

export class ImportFormatError extends Error {}

const debit = (code: string, amount: number, memo = ''): JournalLine => ({ debitAccount: code, debitAmount: amount, creditAccount: '', creditAmount: 0, memo });
const credit = (code: string, amount: number, memo = ''): JournalLine => ({ debitAccount: '', debitAmount: 0, creditAccount: code, creditAmount: amount, memo });

interface Context {
  settings: Settings;
  accounts: Account[];
  journal: Voucher[];
}

/** 共通の確かめ：取り込み済み・日付・科目 */
function finish(ctx: Context, row: number, input: Candidate['input'], extra: { status?: CandidateStatus; note?: string } = {}): Candidate {
  const keys = new Set(ctx.journal.map((v) => `${v.source}\u0000${v.sourceId}`));
  const map = accountMap(ctx.accounts);
  // 科目が決まっていない行（空のコード）も残す。画面で科目を選んでもらう
  const lines = input.lines.filter((l) => l.debitAmount > 0 || l.creditAmount > 0);
  const full = { ...input, lines, segment: input.segment || defaultSegment(lines, ctx.accounts) };
  let status: CandidateStatus = extra.status ?? 'ok';
  let note = extra.note ?? '';
  if (status === 'ok') {
    if (keys.has(`${input.source}\u0000${input.sourceId}`)) [status, note] = ['duplicate', '前に取り込んでいます'];
    else if (!isDate(input.date)) [status, note] = ['error', '日付が読めません'];
    else if (!yearOf(ctx.settings, input.date)) [status, note] = ['error', '帳簿を付け始めた日より前です'];
    else if (isClosedDate(ctx.settings, input.date)) [status, note] = ['error', '締めた年度の日付です'];
    else if (!lines.length) [status, note] = ['error', '金額が0です'];
    else if (lines.some((l) => (l.debitAmount > 0 && !map.has(l.debitAccount)) || (l.creditAmount > 0 && !map.has(l.creditAccount)))) {
      [status, note] = ['needsAccount', note || '科目が決まっていません'];
    }
  }
  return { row, status, note, include: status === 'ok', input: full };
}

// ---------------------------------------------------------------- 領収書アプリ

export function fromReceipts(text: string, ctx: Context): Candidate[] {
  const t = table(text);
  need(t, ['ID', '日付', '会社名', '金額', '支払い方法', '分類'], '領収書一覧.csv');
  const { receiptCategoryMap: cat, paymentMethodMap: pay } = ctx.settings;
  return t.rows.map((r, i) => {
    const company = t.get(r, '会社名');
    const category = t.get(r, '分類');
    const method = t.get(r, '支払い方法') || '現金';
    const amount = parseYen(t.get(r, '金額')) ?? 0;
    const expense = cat[category] ?? '';
    const by = t.get(r, '登録者');
    return finish(ctx, i + 1, {
      date: parseDate(t.get(r, '日付')), segment: '' as VoucherInput['segment'],
      description: `${company}${category ? `（${category}）` : ''}${by ? `／${by}` : ''}`, counterparty: company,
      source: 'receipts', sourceId: t.get(r, 'ID'),
      lines: [debit(expense, amount), credit(pay[method] ?? '102', amount, method)],
    }, expense ? {} : { note: category ? `分類「${category}」の科目が決まっていません` : '分類が空です' });
  });
}

// ---------------------------------------------------------------- 書類アプリ

export function fromDocumentPayouts(text: string, ctx: Context): Candidate[] {
  const t = table(text);
  need(t, ['ID', '支払い番号', '状態', '支払い先番号', '支払日', '報酬の額（税抜）', '消費税', '源泉徴収税', '差引支払額'], '支払記録.csv');
  return t.rows.map((r, i) => {
    const amount = parseYen(t.get(r, '報酬の額（税抜）')) ?? 0;
    const tax = parseYen(t.get(r, '消費税')) ?? 0;
    const wht = parseYen(t.get(r, '源泉徴収税')) ?? 0;
    const net = parseYen(t.get(r, '差引支払額')) ?? 0;
    const number = t.get(r, '支払い番号');
    const input = {
      date: parseDate(t.get(r, '支払日')), segment: '' as VoucherInput['segment'],
      description: `${number} ${t.get(r, '業務の内容')}`.trim(), counterparty: t.get(r, '支払い先番号'),
      source: 'document-payout', sourceId: t.get(r, 'ID'),
      lines: [debit(ctx.settings.payoutAccount, amount + tax), credit('202', wht, '源泉徴収税'), credit('102', net)],
    };
    if (t.get(r, '状態') === '取消') return finish(ctx, i + 1, input, { status: 'excluded', note: '取り消した支払いです' });
    if (amount + tax !== wht + net) return finish(ctx, i + 1, input, { status: 'error', note: '報酬＋消費税と、源泉徴収税＋差引支払額が合いません' });
    return finish(ctx, i + 1, input);
  });
}

function incomeLines(ctx: Context, amount: number, fee: number, cash: boolean): JournalLine[] {
  return [debit(cash ? '101' : '102', amount), debit('502', fee, '振込手数料など'), credit(ctx.settings.documentIncomeAccount, amount + fee)];
}

export function fromDocumentIncomes(text: string, ctx: Context): Candidate[] {
  const t = table(text);
  need(t, ['ID', '入金番号', '状態', '入金元', '入金日', '入金額', '手数料'], 'その他の入金.csv');
  return t.rows.map((r, i) => {
    const amount = parseYen(t.get(r, '入金額')) ?? 0;
    const fee = parseYen(t.get(r, '手数料')) ?? 0;
    const input = {
      date: parseDate(t.get(r, '入金日')), segment: '' as VoucherInput['segment'],
      description: `${t.get(r, '入金番号')} ${t.get(r, '入金元')}${t.get(r, 'サービス提供月') ? `（${t.get(r, 'サービス提供月')}分）` : ''}`.trim(),
      counterparty: t.get(r, '入金元'), source: 'document-income', sourceId: t.get(r, 'ID'),
      lines: incomeLines(ctx, amount, fee, false),
    };
    if (t.get(r, '状態') === '取消') return finish(ctx, i + 1, input, { status: 'excluded', note: '取り消した入金です' });
    return finish(ctx, i + 1, input);
  });
}

export function fromDocumentPayments(text: string, ctx: Context): Candidate[] {
  const t = table(text);
  need(t, ['ID', '請求書番号', '入金日', '金額', '手数料', '方法'], '入金記録.csv');
  return t.rows.map((r, i) => {
    const amount = parseYen(t.get(r, '金額')) ?? 0;
    const fee = parseYen(t.get(r, '手数料')) ?? 0;
    return finish(ctx, i + 1, {
      date: parseDate(t.get(r, '入金日')), segment: '' as VoucherInput['segment'],
      description: `請求書 ${t.get(r, '請求書番号')} の入金`, counterparty: '',
      source: 'document-payment', sourceId: t.get(r, 'ID'),
      lines: incomeLines(ctx, amount, fee, t.get(r, '方法') === '現金'),
    });
  });
}

// ---------------------------------------------------------------- 銀行の明細

const has = (h: string, words: string[]) => words.some((w) => h.includes(w));

/** 見出しの行と、列の当たりを付ける（銀行ごとに形が違うので、画面で直せるようにする） */
export function guessBank(text: string): ParsedTable & Omit<BankOptions, 'bankAccount' | 'headerRow'> {
  const rows = parseCsv(text);
  let headerRow = rows.slice(0, 15).findIndex((r) => r.some((h) => has(h, ['日付', '年月日', '取引日', '日'])) && r.filter((h) => h.trim()).length >= 3);
  if (headerRow < 0) headerRow = 0;
  const headers = (rows[headerRow] ?? []).map((h) => h.trim());
  const find = (words: string[], not: string[] = []) => headers.findIndex((h) => has(h, words) && !has(h, not));
  return {
    headers,
    headerRow,
    dateCol: find(['取引日', '年月日', '日付', '日']),
    descCol: find(['摘要', '内容', '取引名', 'お取引', '備考']),
    inCol: find(['入金', 'お預り', '預入', 'お預入']),
    outCol: find(['出金', 'お引出', '引出', 'お支払', '支払']),
    amountCol: -1,
  };
}

export function fromBank(text: string, opts: BankOptions, ctx: Context): Candidate[] {
  const rows = parseCsv(text).slice(opts.headerRow + 1);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const seen = new Map<string, number>();
  const others = ctx.journal.filter((v) => v.source !== `bank:${opts.bankAccount}`);
  const out: Candidate[] = [];
  rows.forEach((r, i) => {
    const date = parseDate(cell(r, opts.dateCol));
    const desc = cell(r, opts.descCol);
    let amount: number;
    if (opts.amountCol >= 0) amount = parseYen(cell(r, opts.amountCol)) ?? 0;
    else amount = (parseYen(cell(r, opts.inCol)) ?? 0) - (parseYen(cell(r, opts.outCol)) ?? 0);
    if (!date && !amount) return; // 空の行・合計の行
    const base = `${date}|${amount}|${desc}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const rule = ctx.settings.bankRules.find((b) => desc.includes(b.keyword));
    const counter = rule?.accountCode ?? '';
    const abs = Math.abs(amount);
    const input = {
      date, segment: '' as VoucherInput['segment'], description: desc, counterparty: '',
      source: `bank:${opts.bankAccount}`, sourceId: `${base}|${n}`,
      lines: amount >= 0 ? [debit(opts.bankAccount, abs), credit(counter, abs)] : [debit(counter, abs), credit(opts.bankAccount, abs)],
    };
    if (rule && !rule.accountCode) return out.push(finish(ctx, i + 1, input, { status: 'excluded', note: `規則「${rule.keyword}」で取り込まない` }));
    const c = finish(ctx, i + 1, input, counter ? {} : { note: '摘要に合う規則がありません' });
    // 書類アプリ・領収書などから、同じ口座の同じ金額の動きがすでに入っていれば、二重の恐れ
    if (c.status === 'ok' || c.status === 'needsAccount') {
      const twin = others.find((v) => Math.abs(Date.parse(v.date) - Date.parse(date)) <= 3 * 86400_000
        && v.lines.some((l) => (amount >= 0 ? l.debitAccount === opts.bankAccount && l.debitAmount === abs : l.creditAccount === opts.bankAccount && l.creditAmount === abs)));
      if (twin) return out.push({ ...c, status: 'maybeDuplicate', include: false, note: `帳簿に同じ金額の動きがあります（${twin.date} ${twin.description}）` });
    }
    out.push(c);
  });
  return out;
}

export function buildCandidates(kind: ImportKind, text: string, ctx: Context, bank?: BankOptions): Candidate[] {
  switch (kind) {
    case 'receipts': return fromReceipts(text, ctx);
    case 'document-payouts': return fromDocumentPayouts(text, ctx);
    case 'document-incomes': return fromDocumentIncomes(text, ctx);
    case 'document-payments': return fromDocumentPayments(text, ctx);
    case 'bank':
      if (!bank) throw new ImportFormatError('銀行の明細の列を選んでください。');
      return fromBank(text, bank, ctx);
  }
}

