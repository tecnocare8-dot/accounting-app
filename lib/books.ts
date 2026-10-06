import { SEGMENTS, type Account, type Segment } from './accounts';
import type { ReportRange } from './reports';
import { fiscalYears, todayJst, yearOf, type FiscalYear } from './fiscal';
import type { Voucher } from './journal';
import type { Settings } from './settings';
import type { LedgerStore } from './store';

// 画面に出すための読み込みをまとめる

export interface Books {
  settings: Settings;
  accounts: Account[];
  journal: Voucher[];
  years: FiscalYear[];
  today: string;
  /** 今日が入る年度（帳簿を付け始める前なら最初の年度） */
  currentYear: FiscalYear;
}

export async function loadBooks(store: LedgerStore): Promise<Books> {
  const [settings, accounts, journal] = await Promise.all([store.loadSettings(), store.loadAccounts(), store.loadJournal()]);
  const today = todayJst();
  const latest = journal.reduce((m, v) => (v.date > m ? v.date : m), today);
  const years = fiscalYears(settings, latest);
  const currentYear = yearOf(settings, today) ?? years[0];
  return { settings, accounts, journal, years, today, currentYear };
}

/** ?year=開始日 の年度（なければ今の年度） */
export function pickYear(books: Books, start: string | null): FiscalYear {
  return books.years.find((y) => y.start === start) ?? books.currentYear;
}

/** 帳簿の画面・書き出しの条件：?year=開始日&to=期間の終わり&segment=区分 */
export function reportRange(books: Books, q: URLSearchParams) {
  const year = pickYear(books, q.get('year'));
  const toRaw = q.get('to') ?? '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) && toRaw >= year.start && toRaw <= year.end ? toRaw : year.end;
  const seg = q.get('segment') as Segment;
  const range: ReportRange = { from: year.start, to, segment: SEGMENTS.includes(seg) ? seg : undefined };
  return { year, range };
}
