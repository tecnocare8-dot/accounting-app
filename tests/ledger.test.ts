import { describe, expect, it } from 'vitest';
import { addVoucher, addVouchers, deleteVoucher, saveAccount, updateSettings, updateVoucher } from '@/lib/ledger';
import { line, testDeps, vid } from './helpers';

const base = { date: '2026-05-10', segment: 'common', description: 'コピー用紙', counterparty: 'A店', lines: [line('505', 1100, '102', 1100)] };

describe('伝票の追加・修正・削除', () => {
  it('足すと年度ごとの番号が付き、変更履歴に残る', async () => {
    const deps = await testDeps();
    const a = await addVoucher(deps, vid(1), base);
    const b = await addVoucher(deps, vid(2), { ...base, date: '2026-06-01' });
    const c = await addVoucher(deps, vid(3), { ...base, date: '2027-04-01' });
    expect([a.number, b.number, c.number]).toEqual([1, 2, 1]);
    expect(await deps.store.loadJournal()).toHaveLength(3);
    const audit = await deps.store.loadAudit();
    expect(audit.map((x) => x.action)).toEqual(['追加', '追加', '追加']);
    expect(audit[0].detail).toContain('借 505 1100');
  });

  it('同じIDで2回送っても1件（二度押し）', async () => {
    const deps = await testDeps();
    await Promise.all([addVoucher(deps, vid(1), base), addVoucher(deps, vid(1), base)]);
    expect(await deps.store.loadJournal()).toHaveLength(1);
  });

  it('貸借が合わないと保存しない', async () => {
    const deps = await testDeps();
    await expect(addVoucher(deps, vid(1), { ...base, lines: [line('505', 1100, '102', 1000)] })).rejects.toThrow('合いません');
    expect(await deps.store.loadJournal()).toHaveLength(0);
  });

  it('直すと前と後が変更履歴に残る。取り込み元は変わらない', async () => {
    const deps = await testDeps();
    await addVoucher(deps, vid(1), { ...base, source: 'receipts', sourceId: 'r1' });
    const v = await updateVoucher(deps, vid(1), { ...base, description: 'トナー', lines: [line('505', 3300, '102', 3300)], source: 'x', sourceId: 'y' });
    expect(v).toMatchObject({ description: 'トナー', source: 'receipts', sourceId: 'r1', number: 1 });
    const audit = await deps.store.loadAudit();
    expect(audit[1].action).toBe('修正');
    expect(audit[1].detail).toMatch(/前：.*1100.*→ 後：.*3300/);
  });

  it('消すときは理由が要り、元の伝票の中身が変更履歴に残る', async () => {
    const deps = await testDeps();
    await addVoucher(deps, vid(1), base);
    await expect(deleteVoucher(deps, vid(1), ' ')).rejects.toThrow('理由');
    await deleteVoucher(deps, vid(1), '二重に入れた');
    expect(await deps.store.loadJournal()).toHaveLength(0);
    const last = (await deps.store.loadAudit()).at(-1)!;
    expect(last.action).toBe('削除');
    expect(last.detail).toContain('二重に入れた');
    expect(last.detail).toContain('"description":"コピー用紙"');
  });

  it('締めた年度の伝票は、足す・直す・消すのどれもできない', async () => {
    const deps = await testDeps();
    await addVoucher(deps, vid(1), base);
    const s = await deps.store.loadSettings();
    await deps.store.saveSettings({ ...s, closedYears: [{ start: '2026-04-01', end: '2027-03-31' }] });
    await expect(addVoucher(deps, vid(2), base)).rejects.toThrow('締めた年度');
    await expect(updateVoucher(deps, vid(1), { ...base, date: '2027-05-01' })).rejects.toThrow('締めた年度');
    await expect(deleteVoucher(deps, vid(1), 'x')).rejects.toThrow('締めた年度');
  });
});

describe('まとめて足す（取り込み）', () => {
  it('取り込み元IDが同じものは二度入れない（同じファイルの中・前回の取り込みとも）', async () => {
    const deps = await testDeps();
    const r = (id: string) => ({ ...base, source: 'receipts', sourceId: id });
    const first = await addVouchers(deps, [r('a'), r('b'), r('a')]);
    expect(first.added).toHaveLength(2);
    expect(first.skipped).toEqual([{ index: 2, reason: 'すでに取り込み済み' }]);
    const again = await addVouchers(deps, [r('a'), r('c'), { ...r('d'), lines: [] }]);
    expect(again.added.map((v) => v.sourceId)).toEqual(['c']);
    expect(again.skipped.map((s) => s.index)).toEqual([0, 2]);
    expect((await deps.store.loadJournal()).map((v) => v.number)).toEqual([1, 2, 3]);
  });
});

describe('科目と設定', () => {
  it('科目を足すと、同じ種類の次のコードになる。名前を変えると仕訳帳の科目名も変わる', async () => {
    const deps = await testDeps();
    const a = await saveAccount(deps, { name: 'セミナー会場費', type: 'expense', segment: 'common' });
    expect(a.code).toBe('515');
    await addVoucher(deps, vid(1), { ...base, lines: [line(a.code, 5000, '102', 5000)] });
    await saveAccount(deps, { code: a.code, name: '会場費', type: 'expense', segment: 'profit' });
    expect((await deps.store.loadAccounts()).find((x) => x.code === a.code)).toMatchObject({ name: '会場費', segment: 'profit' });
    await expect(saveAccount(deps, { code: a.code, name: '会場費', type: 'asset', segment: 'profit' })).rejects.toThrow('種類は変えられません');
    await expect(saveAccount(deps, { name: '会場費', type: 'expense', segment: 'common' })).rejects.toThrow('すでにあります');
  });

  it('伝票がある日より後に、帳簿を付け始めた日を動かせない。ない科目を対応表に入れられない', async () => {
    const deps = await testDeps();
    await addVoucher(deps, vid(1), base);
    await expect(updateSettings(deps, { firstYearStart: '2026-06-01' })).rejects.toThrow('2026-05-10 の伝票');
    await expect(updateSettings(deps, { payoutAccount: '777' })).rejects.toThrow('777');
    const s = await updateSettings(deps, { closingMonth: 12, closedYears: [{ start: '2026-04-01', end: '2027-03-31' }] });
    expect(s.closingMonth).toBe(12);
    expect(s.closedYears).toEqual([]);
    expect((await deps.store.loadAudit()).at(-1)!.detail).toContain('closingMonth：3 → 12');
  });
});
