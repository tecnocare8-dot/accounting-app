import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS } from '@/lib/accounts';
import { cleanInput, counterAccount, defaultSegment, validateVoucher, type Voucher } from '@/lib/journal';
import { accountsFromCsv, accountsToCsv, journalFromCsv, journalToCsv } from '@/lib/records';
import { DEFAULT_SETTINGS } from '@/lib/settings';

const fiscal = { closingMonth: 3, firstYearStart: '2026-04-01', closedYears: [{ start: '2026-04-01', end: '2027-03-31' }] };
const line = (d: string, da: number, c: string, ca: number, memo = '') => ({ debitAccount: d, debitAmount: da, creditAccount: c, creditAmount: ca, memo });

describe('伝票の検証', () => {
  const ok = { date: '2027-05-01', segment: 'common' as const, description: '文房具', counterparty: '', lines: [line('505', 1100, '102', 1100)] };

  it('貸借が合い、科目があれば保存できる', () => {
    expect(validateVoucher(ok, DEFAULT_ACCOUNTS, fiscal)).toEqual([]);
  });

  it('複数行で貸借を合わせられる（講師謝金・源泉・振込）', () => {
    const v = { ...ok, lines: [line('501', 11000, '', 0), line('', 0, '202', 1123), line('', 0, '102', 9877)] };
    expect(validateVoucher(v, DEFAULT_ACCOUNTS, fiscal)).toEqual([]);
  });

  it('貸借が合わない・科目がない・金額が0・締めた年度はだめ', () => {
    expect(validateVoucher({ ...ok, lines: [line('505', 1100, '102', 1000)] }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('合いません');
    expect(validateVoucher({ ...ok, lines: [line('999', 1100, '102', 1100)] }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('（999）がありません');
    expect(validateVoucher({ ...ok, lines: [line('505', 0, '102', 0)] }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('1円以上');
    expect(validateVoucher({ ...ok, lines: [line('505', 1.5, '102', 1.5)] }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('整数');
    expect(validateVoucher({ ...ok, date: '2026-12-01' }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('締めた年度');
    expect(validateVoucher({ ...ok, date: '2025-12-01' }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('付け始めた日');
    expect(validateVoucher({ ...ok, lines: [] }, DEFAULT_ACCOUNTS, fiscal).join()).toContain('行を入れて');
  });

  it('送られてきた値を整える（文字の金額・空の行）', () => {
    const v = cleanInput({ date: '2027-05-01', segment: 'x', lines: [{ debitAccount: '505', debitAmount: '1100' }, {}, { creditAccount: '102', creditAmount: 1100 }] });
    expect(v.segment).toBe('');
    expect(v.lines).toEqual([line('505', 1100, '', 0), line('', 0, '102', 1100)]);
  });

  it('区分の初期値は、最初の収入・支出の科目の区分', () => {
    expect(defaultSegment([line('102', 1, '406', 1)], DEFAULT_ACCOUNTS)).toBe('profit');
    expect(defaultSegment([line('102', 1, '401', 1)], DEFAULT_ACCOUNTS)).toBe('nonprofit');
    expect(defaultSegment([line('102', 1, '103', 1)], DEFAULT_ACCOUNTS)).toBe('nonprofit');
  });
});

describe('仕訳帳.csv', () => {
  const v: Voucher = {
    id: 'v-1', number: 3, date: '2027-05-01', segment: 'profit', description: '=研修, "A社"', counterparty: '+病院',
    source: 'bank:102', sourceId: '2027-05-01|-100|振込|1',
    lines: [line('102', 9670, '', 0, '入金'), line('502', 330, '', 0), line('', 0, '404', 10000)],
    createdAt: '2027-05-01T00:00:00.000Z', updatedAt: '2027-05-02T00:00:00.000Z',
  };

  it('書いて読むと元に戻る（式の対策の印も外れる）', () => {
    const csv = journalToCsv([v], DEFAULT_ACCOUNTS, fiscal);
    expect(csv).toContain(`'=研修`);
    expect(csv).toContain('研修収入');
    expect(journalFromCsv(csv)).toEqual([v]);
  });

  it('Excel で保存し直した CSV（日付が 2027/5/1、金額にカンマ）も読める', () => {
    const csv = journalToCsv([v], DEFAULT_ACCOUNTS, fiscal).replaceAll('2027-05-01,', '2027/5/1,').replace(',9670,', ',"9,670",');
    const [back] = journalFromCsv(csv);
    expect(back.date).toBe('2027-05-01');
    expect(back.lines[0].debitAmount).toBe(9670);
  });

  it('相手科目：1つならその科目、複数なら諸口', () => {
    expect(counterAccount(v, '404', 'credit')).toBe('諸口');
    expect(counterAccount(v, '102', 'debit')).toBe('404');
  });
});

describe('勘定科目.csv', () => {
  it('書いて読むと元に戻る', () => {
    expect(accountsFromCsv(accountsToCsv(DEFAULT_ACCOUNTS))).toEqual(DEFAULT_ACCOUNTS);
  });
  it('初期設定の対応表の科目は、すべて初期の科目にある', () => {
    const codes = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
    const used = [...Object.values(DEFAULT_SETTINGS.receiptCategoryMap), ...Object.values(DEFAULT_SETTINGS.paymentMethodMap),
      DEFAULT_SETTINGS.payoutAccount, DEFAULT_SETTINGS.documentIncomeAccount];
    expect(used.filter((c) => !codes.has(c))).toEqual([]);
  });
});
