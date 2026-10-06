import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS } from '@/lib/accounts';
import { decodeText, toCsv } from '@/lib/csv';
import { buildCandidates, guessBank, ImportFormatError, parseDate, type BankOptions } from '@/lib/importers';
import type { Voucher } from '@/lib/journal';
import { addVouchers } from '@/lib/ledger';
import { TEST_SETTINGS, line, testDeps } from './helpers';

const ctx = (journal: Voucher[] = [], settings = TEST_SETTINGS) => ({ settings, accounts: DEFAULT_ACCOUNTS, journal });

const RECEIPTS = toCsv(['ID', '日付', '会社名', '登録番号', '金額', '支払い方法', '分類', '画像ファイル名', '画像リンク', '登録日時', '登録者', '登録者ID'], [
  ['r1', '2026-05-01', 'コンビニ', '', 550, '現金', '消耗品費', '', '', '', '代表者', ''],
  ['r2', '2026/5/2', 'タクシー', '', '1,200', 'クレジットカード', '旅費交通費', '', '', '', 'スタッフA', 's1'],
  ['r3', '2026-05-03', '謎の店', '', 800, '現金', '謎の分類', '', '', '', '', ''],
  ['r4', '2025-05-03', '昔の店', '', 800, '現金', '雑費', '', '', '', '', ''],
]);

describe('日付', () => {
  it('いろいろな書き方を読む', () => {
    expect(['2026-10-01', '2026/10/1', '20261001', '2026年10月1日', 'R8.10.1', '令和8年10月1日', '2026/2/30', 'x'].map(parseDate))
      .toEqual(['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', '', '']);
  });
});

describe('領収書アプリ', () => {
  it('分類→科目、支払い方法→貸方。決まらない分類・付け始める前は取り込まない', () => {
    const c = buildCandidates('receipts', RECEIPTS, ctx());
    expect(c.map((x) => x.status)).toEqual(['ok', 'ok', 'needsAccount', 'error']);
    expect(c[0].input).toMatchObject({ date: '2026-05-01', segment: 'common', counterparty: 'コンビニ', source: 'receipts', sourceId: 'r1' });
    expect(c[0].input.lines).toEqual([line('505', 550, '', 0), line('', 0, '101', 550, '現金')]);
    expect(c[1].input.lines[1].creditAccount).toBe('201');
    expect(c[1].input.description).toContain('スタッフA');
    expect(c[2].note).toContain('謎の分類');
    expect(c[2].include).toBe(false);
  });

  it('Excel で保存し直した Shift_JIS の CSV も読める', () => {
    const text = decodeText(iconv.encode(RECEIPTS.replace(/^﻿/, ''), 'shift_jis'));
    expect(buildCandidates('receipts', text, ctx())[0].input.counterparty).toBe('コンビニ');
  });

  it('違う形のファイルは、足りない列を伝える', () => {
    expect(() => buildCandidates('receipts', 'a,b\n1,2', ctx())).toThrow(ImportFormatError);
  });

  it('取り込んだ後にもう一度読むと「取り込み済み」', async () => {
    const deps = await testDeps();
    const first = buildCandidates('receipts', RECEIPTS, ctx());
    await addVouchers(deps, first.filter((c) => c.include).map((c) => c.input));
    const again = buildCandidates('receipts', RECEIPTS, ctx(await deps.store.loadJournal()));
    expect(again.map((x) => x.status)).toEqual(['duplicate', 'duplicate', 'needsAccount', 'error']);
  });
});

describe('書類アプリ', () => {
  it('業務委託の支払い：講師謝金／預り金（源泉）・普通預金。取消は入れない', () => {
    const csv = toCsv(['ID', '支払い番号', '状態', '支払い先番号', '支払日', '業務の内容', '報酬の種類', '報酬の額（税抜）', '消費税', '源泉徴収', '源泉徴収税', '差引支払額'], [
      ['p1', 'PAY-2026-0001', '支払済み', 'P0001', '2026-06-30', 'セミナー講師', 'fee', 10000, 1000, 'はい', 1021, 9979],
      ['p2', 'PAY-2026-0002', '取消', 'P0002', '2026-06-30', '', 'fee', 5000, 0, 'いいえ', 0, 5000],
      ['p3', 'PAY-2026-0003', '支払済み', 'P0003', '2026-06-30', '', 'fee', 5000, 0, 'いいえ', 0, 5000],
    ]);
    const c = buildCandidates('document-payouts', csv, ctx());
    expect(c.map((x) => x.status)).toEqual(['ok', 'excluded', 'ok']);
    expect(c[0].input.lines).toEqual([line('501', 11000, '', 0), line('', 0, '202', 1021, '源泉徴収税'), line('', 0, '102', 9979)]);
    expect(c[2].input.lines).toHaveLength(2);
  });

  it('入金：普通預金・支払手数料／受託研修収入（設定の科目）', () => {
    const inc = toCsv(['ID', '入金番号', '状態', '入金元の種類', '入金元', 'サービス提供月', '入金日', '入金額', '手数料'], [
      ['i1', 'INC-2026-0001', '記録済み', 'その他', 'B病院', '', '2026-07-10', 49560, 440],
    ]);
    const c = buildCandidates('document-incomes', inc, ctx());
    expect(c[0].input.lines).toEqual([line('102', 49560, '', 0), line('502', 440, '', 0, '振込手数料など'), line('', 0, '406', 50000)]);
    // 収入の科目（受託研修収入＝収益事業）で決まる
    expect(c[0].input.segment).toBe('profit');
    const pay = toCsv(['ID', '請求書ID', '請求書番号', '入金日', '金額', '手数料', '方法', '登録日時'], [['m1', 'd1', 'INV-2026-0001', '2026-07-11', 3000, 0, '現金', '']]);
    const p = buildCandidates('document-payments', pay, ctx());
    expect(p[0].input.lines).toEqual([line('101', 3000, '', 0), line('', 0, '406', 3000)]);
    expect(p[0].input.segment).toBe('profit');
  });
});

describe('銀行の明細', () => {
  const BANK = [
    '口座番号,1234567',
    '',
    '取引日,摘要,お支払金額,お預り金額,残高',
    '2026/07/01,ｽﾄﾗｲﾌﾟ ｼﾞﾔﾊﾟﾝ,,9800,109800',
    '2026/07/02,ﾃﾞﾝﾜﾘﾖｳ,3300,,106500',
    '2026/07/02,ﾃﾞﾝﾜﾘﾖｳ,3300,,103200',
    '2026/07/03,ﾌﾘｺﾐ ｺｳｼ,9979,,93221',
    '2026/07/05,ﾅｿﾞ,100,,93121',
  ].join('\r\n');

  it('見出しの行と列の当たりを付ける', () => {
    const g = guessBank(BANK);
    // 空の行は数えない
    expect(g).toMatchObject({ headerRow: 1, dateCol: 0, descCol: 1, inCol: 3, outCol: 2, amountCol: -1 });
  });

  it('規則で科目を決め、取り込まない規則・同じ日の同じ明細・二重の恐れを見分ける', () => {
    const settings = { ...TEST_SETTINGS, bankRules: [{ keyword: 'ｽﾄﾗｲﾌﾟ', accountCode: '' }, { keyword: 'ﾃﾞﾝﾜ', accountCode: '503' }] };
    const paid: Voucher = {
      id: 'v-x', number: 1, date: '2026-06-30', segment: 'common', description: '講師謝金', counterparty: '', source: 'document-payout', sourceId: 'p1',
      lines: [line('501', 11000, '', 0), line('', 0, '202', 1021), line('', 0, '102', 9979)], createdAt: '', updatedAt: '',
    };
    const g = guessBank(BANK);
    const opts: BankOptions = { bankAccount: '102', ...g };
    const c = buildCandidates('bank', BANK, ctx([paid], settings), opts);
    expect(c.map((x) => x.status)).toEqual(['excluded', 'ok', 'ok', 'maybeDuplicate', 'needsAccount']);
    expect(c[1].input.lines).toEqual([line('503', 3300, '', 0), line('', 0, '102', 3300)]);
    expect(c[1].input.sourceId).not.toBe(c[2].input.sourceId);
    expect(c[3].note).toContain('講師謝金');
  });

  it('＋−が1つの列に入っている形', () => {
    const csv = '日付,内容,金額\n2026-07-01,利息,12\n2026-07-02,手数料,-110';
    const c = buildCandidates('bank', csv, ctx([], { ...TEST_SETTINGS, bankRules: [{ keyword: '利息', accountCode: '421' }, { keyword: '手数料', accountCode: '502' }] }),
      { bankAccount: '102', headerRow: 0, dateCol: 0, descCol: 1, inCol: -1, outCol: -1, amountCol: 2 });
    expect(c.map((x) => x.input.lines)).toEqual([
      [line('102', 12, '', 0), line('', 0, '421', 12)],
      [line('502', 110, '', 0), line('', 0, '102', 110)],
    ]);
    expect(c.map((x) => x.input.segment)).toEqual(['nonprofit', 'common']);
  });
});
