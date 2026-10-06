import { SEGMENTS, type Segment } from './accounts';
import type { Books } from './books';
import { trialBalance } from './reports';

// ホームに出す数字：お金の残高、年度の収入・支出（区分ごと）、要確認の科目を使った伝票

export function homeSummary(books: Books) {
  const y = books.currentYear;
  const all = trialBalance(books.journal, books.accounts, { from: y.start, to: y.end });
  const cash = all.rows.filter((r) => ['101', '102', '103'].includes(r.code)).map((r) => ({ code: r.code, name: r.name, balance: r.closing }));
  const bySegment = Object.fromEntries(SEGMENTS.map((s) => {
    const tb = trialBalance(books.journal, books.accounts, { from: y.start, to: y.end, segment: s });
    const revenue = tb.rows.filter((r) => r.type === 'revenue').reduce((t, r) => t + r.closing, 0);
    const expense = tb.rows.filter((r) => r.type === 'expense').reduce((t, r) => t + r.closing, 0);
    return [s, { revenue, expense }];
  })) as Record<Segment, { revenue: number; expense: number }>;
  const needsCheck = books.accounts.filter((a) => a.needsCheck && books.journal.some((v) => v.lines.some((l) => l.creditAccount === a.code || l.debitAccount === a.code)))
    .map((a) => a.name);
  return {
    entityName: books.settings.entityName,
    year: y,
    count: books.journal.filter((v) => v.date >= y.start && v.date <= y.end).length,
    cash,
    bySegment,
    needsCheck,
    started: books.journal.length > 0,
  };
}
