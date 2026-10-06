// 金額は1円単位の整数だけを扱う（小数・負の数は入れない。向きは借方・貸方で表す）

export const isYen = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

/** 「3,300」「¥3,300」「3300円」「-1,000」を整数にする。読めなければ null */
export function parseYen(s: string): number | null {
  const t = s.replace(/[,¥￥円\s]/g, '').replace(/^△/, '-');
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
