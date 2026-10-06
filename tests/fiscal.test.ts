import { describe, expect, it } from 'vitest';
import { fiscalYears, isClosedDate, isDate, yearEndFrom, yearOf } from '@/lib/fiscal';

const cfg = { closingMonth: 3, firstYearStart: '2026-04-01', closedYears: [] as { start: string; end: string }[] };

describe('事業年度', () => {
  it('年度の終わりは、始まり以降で最初の決算月の末日', () => {
    expect(yearEndFrom('2026-04-01', 3)).toBe('2027-03-31');
    expect(yearEndFrom('2026-04-01', 12)).toBe('2026-12-31');
    expect(yearEndFrom('2027-01-01', 2)).toBe('2027-02-28');
    expect(yearEndFrom('2028-01-01', 2)).toBe('2028-02-29');
    expect(yearEndFrom('2026-03-15', 3)).toBe('2026-03-31');
  });

  it('日付から年度を出す。付け始める前は null', () => {
    expect(yearOf(cfg, '2027-03-31')).toMatchObject({ start: '2026-04-01', end: '2027-03-31', short: false });
    expect(yearOf(cfg, '2027-04-01')).toMatchObject({ start: '2027-04-01', end: '2028-03-31' });
    expect(yearOf(cfg, '2026-03-31')).toBeNull();
  });

  it('設立した年度（途中から始まる）は1年未満', () => {
    const c = { ...cfg, firstYearStart: '2026-10-06' };
    expect(yearOf(c, '2026-12-01')).toMatchObject({ start: '2026-10-06', end: '2027-03-31', short: true });
  });

  it('決算月を変えると、締めていない年度だけ範囲が変わり、変えた直後の年度は1年未満になる', () => {
    const closed = { ...cfg, closedYears: [{ start: '2026-04-01', end: '2027-03-31' }] };
    const changed = { ...closed, closingMonth: 12 };
    const ys = fiscalYears(changed, '2028-06-01');
    expect(ys.map((y) => [y.start, y.end, y.closed, y.short])).toEqual([
      ['2026-04-01', '2027-03-31', true, false],
      ['2027-04-01', '2027-12-31', false, true],
      ['2028-01-01', '2028-12-31', false, false],
    ]);
    expect(isClosedDate(changed, '2027-03-31')).toBe(true);
    expect(isClosedDate(changed, '2027-04-01')).toBe(false);
  });

  it('日付の形を確かめる', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026/10/01')).toBe(false);
  });
});
