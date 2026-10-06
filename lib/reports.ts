import { accountMap, isDebitNormal, isProfitAndLoss, RETAINED_EARNINGS, sortAccounts, type Account, type AccountType, type Segment } from './accounts';
import { counterAccount, type Voucher } from './journal';

// 試算表と総勘定元帳。
// 資産・負債・純資産は「期間の終わりまでの累計」、収入・支出は「年度の始まりから期間の終わりまで」。
// 年度の始まりより前の収入−支出は、締め（段階3）の前でも正しく見えるよう、繰越利益の期首残高に足して見せる

export interface ReportRange {
  /** 年度の始まり */
  from: string;
  /** 期間の終わり（その日を含む） */
  to: string;
  /** 区分で絞り込む（なし＝法人全体） */
  segment?: Segment;
}

export interface TrialRow {
  code: string;
  name: string;
  type: AccountType;
  opening: number; // 期首残高（その科目が増える向きを＋）
  debit: number; // 期間の借方合計
  credit: number;
  closing: number;
}

export interface TrialBalance {
  rows: TrialRow[];
  totalDebit: number;
  totalCredit: number;
  /** 期間の収入−支出 */
  netIncome: number;
}

const inSegment = (v: Voucher, seg?: Segment) => !seg || v.segment === seg;

function signed(type: AccountType, debit: number, credit: number) {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

export function trialBalance(vouchers: Voucher[], accounts: Account[], range: ReportRange): TrialBalance {
  const map = accountMap(accounts);
  const sums = new Map<string, { before: [number, number]; during: [number, number] }>();
  const at = (code: string) => {
    let s = sums.get(code);
    if (!s) sums.set(code, (s = { before: [0, 0], during: [0, 0] }));
    return s;
  };
  for (const v of vouchers) {
    if (!inSegment(v, range.segment) || v.date > range.to) continue;
    const key = v.date < range.from ? 'before' : 'during';
    for (const l of v.lines) {
      if (l.debitAccount) at(l.debitAccount)[key][0] += l.debitAmount;
      if (l.creditAccount) at(l.creditAccount)[key][1] += l.creditAmount;
    }
  }
  // 前年度までの収入−支出 → 繰越利益の期首へ
  let carried = 0;
  for (const [code, s] of sums) {
    const a = map.get(code);
    if (a && isProfitAndLoss(a.type)) carried += a.type === 'revenue' ? s.before[1] - s.before[0] : -(s.before[0] - s.before[1]);
  }
  const rows: TrialRow[] = [];
  let netIncome = 0;
  for (const a of sortAccounts(accounts)) {
    const s = sums.get(a.code);
    const opening = isProfitAndLoss(a.type) ? 0 : (s ? signed(a.type, ...s.before) : 0) + (a.code === RETAINED_EARNINGS ? carried : 0);
    const [debit, credit] = s?.during ?? [0, 0];
    if (!opening && !debit && !credit && !a.active) continue;
    if (!opening && !debit && !credit && a.code !== RETAINED_EARNINGS) continue;
    const closing = opening + signed(a.type, debit, credit);
    if (a.type === 'revenue') netIncome += closing;
    if (a.type === 'expense') netIncome -= closing;
    rows.push({ code: a.code, name: a.name, type: a.type, opening, debit, credit, closing });
  }
  // 科目表にない科目（ファイルを手で直した など）も、漏れないように出す
  for (const [code, s] of sums) {
    if (map.has(code) || !(s.during[0] || s.during[1] || s.before[0] || s.before[1])) continue;
    const opening = s.before[0] - s.before[1];
    rows.push({ code, name: `（不明な科目 ${code}）`, type: 'asset', opening, debit: s.during[0], credit: s.during[1], closing: opening + s.during[0] - s.during[1] });
  }
  return {
    rows,
    totalDebit: rows.reduce((t, r) => t + r.debit, 0),
    totalCredit: rows.reduce((t, r) => t + r.credit, 0),
    netIncome,
  };
}

/** 借方残高の合計＝貸方残高の合計 になっているか（期末の残高で確かめる） */
export function balanceCheck(tb: TrialBalance): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const r of tb.rows) {
    const dn = isDebitNormal(r.type);
    const v = r.closing;
    if ((dn && v >= 0) || (!dn && v < 0)) debit += Math.abs(v);
    else credit += Math.abs(v);
  }
  return { debit, credit };
}

export interface LedgerEntry {
  voucherId: string;
  number: number;
  date: string;
  segment: Segment;
  description: string;
  counter: string; // 相手科目のコード、または「諸口」
  debit: number;
  credit: number;
  balance: number;
}

export interface GeneralLedger {
  account: Account;
  opening: number;
  entries: LedgerEntry[];
  closing: number;
}

export function generalLedger(vouchers: Voucher[], accounts: Account[], code: string, range: ReportRange): GeneralLedger | null {
  const account = accounts.find((a) => a.code === code);
  if (!account) return null;
  const tb = trialBalance(vouchers, accounts, range);
  const opening = tb.rows.find((r) => r.code === code)?.opening ?? 0;
  let balance = opening;
  const entries: LedgerEntry[] = [];
  const sorted = vouchers
    .filter((v) => inSegment(v, range.segment) && v.date >= range.from && v.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  for (const v of sorted) {
    for (const l of v.lines) {
      const debit = l.debitAccount === code ? l.debitAmount : 0;
      const credit = l.creditAccount === code ? l.creditAmount : 0;
      if (!debit && !credit) continue;
      balance += signed(account.type, debit, credit);
      entries.push({
        voucherId: v.id, number: v.number, date: v.date, segment: v.segment, description: l.memo || v.description,
        counter: counterAccount(v, code, debit ? 'debit' : 'credit'), debit, credit, balance,
      });
    }
  }
  return { account, opening, entries, closing: balance };
}

/** 課税売上（区分に関係なく、課税売上に数える科目の貸方−借方）。段階4で年度ごとの監視に使う */
export function taxableSales(vouchers: Voucher[], accounts: Account[], from: string, to: string): number {
  const taxable = new Set(accounts.filter((a) => a.taxableSales).map((a) => a.code));
  let total = 0;
  for (const v of vouchers) {
    if (v.date < from || v.date > to) continue;
    for (const l of v.lines) {
      if (taxable.has(l.creditAccount)) total += l.creditAmount;
      if (taxable.has(l.debitAccount)) total -= l.debitAmount;
    }
  }
  return total;
}
