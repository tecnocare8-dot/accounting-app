// 事業年度。締めた年度の範囲は固定（設定に保存）、締めていない年度は決算月から計算する。
// 年度の終わり＝年度の始まり以降で最初に来る「決算月の末日」。決算月を変えると、変えた直後の年度は1年未満になることがある

export interface FiscalYear {
  start: string; // YYYY-MM-DD
  end: string;
  closed: boolean;
  /** 12か月より短い（決算月を変えた直後・設立した年度） */
  short: boolean;
}

export interface FiscalConfig {
  closingMonth: number; // 1〜12
  /** 帳簿を付け始めた年度の開始日 */
  firstYearStart: string;
  /** 締めた年度（古い順。範囲は締めたときのまま変わらない） */
  closedYears: { start: string; end: string }[];
}

export const isDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** start 以降で最初に来る、決算月の末日 */
export function yearEndFrom(start: string, closingMonth: number): string {
  let y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  if (m > closingMonth) y += 1;
  return `${y}-${pad(closingMonth)}-${pad(lastDay(y, closingMonth))}`;
}

function monthsBetween(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${addDays(end, 1)}T00:00:00Z`);
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + (e.getUTCDate() - s.getUTCDate()) / 31;
}

/** 締めていない最初の年度の開始日 */
export function firstOpenStart(cfg: FiscalConfig): string {
  const last = cfg.closedYears[cfg.closedYears.length - 1];
  return last ? addDays(last.end, 1) : cfg.firstYearStart;
}

/** 締めた年度＋締めていない年度を、until（その日を含む年度）まで並べる */
export function fiscalYears(cfg: FiscalConfig, until: string): FiscalYear[] {
  const out: FiscalYear[] = cfg.closedYears.map((y) => ({ ...y, closed: true, short: monthsBetween(y.start, y.end) < 11.9 }));
  let start = firstOpenStart(cfg);
  do {
    const end = yearEndFrom(start, cfg.closingMonth);
    out.push({ start, end, closed: false, short: monthsBetween(start, end) < 11.9 });
    start = addDays(end, 1);
  } while (start <= until);
  return out;
}

/** date が入る年度。帳簿を付け始める前の日付なら null */
export function yearOf(cfg: FiscalConfig, date: string): FiscalYear | null {
  if (date < cfg.firstYearStart) return null;
  return fiscalYears(cfg, date).find((y) => y.start <= date && date <= y.end) ?? null;
}

export function isClosedDate(cfg: FiscalConfig, date: string): boolean {
  return cfg.closedYears.some((y) => y.start <= date && date <= y.end);
}

export function yearLabel(y: Pick<FiscalYear, 'start' | 'end'>): string {
  return `${y.start.slice(0, 4)}年度（${y.start.replaceAll('-', '/')}〜${y.end.replaceAll('-', '/')}）`;
}

/** 日本時間の今日 */
export function todayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
