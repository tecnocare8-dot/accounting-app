import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS } from '@/lib/accounts';
import type { Voucher } from '@/lib/journal';
import { balanceCheck, generalLedger, taxableSales, trialBalance } from '@/lib/reports';
import { line } from './helpers';

let n = 0;
const v = (date: string, segment: Voucher['segment'], lines: Voucher['lines'], description = ''): Voucher => ({
  id: `v-${++n}`, number: n, date, segment, description, counterparty: '', source: '', sourceId: '', lines, createdAt: '', updatedAt: '',
});

// 手で計算した小さな例（2026年度＝2026-04-01〜2027-03-31）
const book = [
  v('2026-04-01', 'nonprofit', [line('102', 500000, '301', 500000)], '期首残高'),
  v('2026-05-01', 'profit', [line('102', 9670, '', 0), line('502', 330, '', 0), line('', 0, '404', 10000)], '研修'),
  v('2026-06-01', 'nonprofit', [line('103', 5000, '401', 5000)], '受講料'),
  v('2026-07-01', 'common', [line('501', 11000, '', 0), line('', 0, '202', 1123), line('', 0, '102', 9877)], '講師謝金'),
  v('2027-04-10', 'profit', [line('102', 2000, '404', 2000)], '翌年度の研修'),
];
const FY = { from: '2026-04-01', to: '2027-03-31' };
const row = (tb: ReturnType<typeof trialBalance>, code: string) => tb.rows.find((r) => r.code === code);

describe('試算表', () => {
  it('法人全体：手計算と一致し、貸借が合う', () => {
    const tb = trialBalance(book, DEFAULT_ACCOUNTS, FY);
    expect(row(tb, '102')).toMatchObject({ opening: 0, debit: 509670, credit: 9877, closing: 499793 });
    expect(row(tb, '103')?.closing).toBe(5000);
    expect(row(tb, '202')?.closing).toBe(1123);
    expect(row(tb, '301')?.closing).toBe(500000);
    expect(row(tb, '401')?.closing).toBe(5000);
    expect(row(tb, '404')?.closing).toBe(10000);
    expect(row(tb, '501')?.closing).toBe(11000);
    expect(row(tb, '502')?.closing).toBe(330);
    expect(tb.netIncome).toBe(3670);
    expect([tb.totalDebit, tb.totalCredit]).toEqual([526000, 526000]);
    expect(balanceCheck(tb)).toEqual({ debit: 516123, credit: 516123 });
  });

  it('翌年度：前年度の収入−支出が繰越利益の期首に入り、収入・支出は0から', () => {
    const tb = trialBalance(book, DEFAULT_ACCOUNTS, { from: '2027-04-01', to: '2027-04-30' });
    expect(row(tb, '301')).toMatchObject({ opening: 503670, closing: 503670 });
    expect(row(tb, '102')).toMatchObject({ opening: 499793, closing: 501793 });
    expect(row(tb, '401')).toBeUndefined();
    expect(row(tb, '404')?.closing).toBe(2000);
    const bc = balanceCheck(tb);
    expect(bc.debit).toBe(bc.credit);
  });

  it('区分で絞り込む', () => {
    const tb = trialBalance(book, DEFAULT_ACCOUNTS, { ...FY, segment: 'profit' });
    expect(tb.rows.map((r) => [r.code, r.closing])).toEqual([['102', 9670], ['301', 0], ['404', 10000], ['502', 330]]);
    expect(tb.netIncome).toBe(9670);
  });

  it('期間の途中まで', () => {
    const tb = trialBalance(book, DEFAULT_ACCOUNTS, { from: '2026-04-01', to: '2026-05-31' });
    expect(tb.netIncome).toBe(9670);
    expect(row(tb, '501')).toBeUndefined();
  });
});

describe('総勘定元帳', () => {
  it('普通預金：相手科目と残高', () => {
    const gl = generalLedger(book, DEFAULT_ACCOUNTS, '102', FY)!;
    expect(gl.entries.map((e) => [e.date, e.counter, e.debit, e.credit, e.balance])).toEqual([
      ['2026-04-01', '301', 500000, 0, 500000],
      ['2026-05-01', '404', 9670, 0, 509670],
      ['2026-07-01', '501', 0, 9877, 499793],
    ]);
    expect(gl.closing).toBe(499793);
  });

  it('研修収入：相手が複数なら諸口', () => {
    const gl = generalLedger(book, DEFAULT_ACCOUNTS, '404', FY)!;
    expect(gl.entries[0]).toMatchObject({ counter: '諸口', credit: 10000, balance: 10000 });
  });
});

describe('課税売上', () => {
  it('区分に関係なく、課税売上に数える科目だけ', () => {
    expect(taxableSales(book, DEFAULT_ACCOUNTS, FY.from, FY.to)).toBe(15000);
  });
});
