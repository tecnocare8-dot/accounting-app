import { isDate, type FiscalConfig } from './fiscal';

// 法人ごとの設定（ドライブの 設定.json）。読めない値は初期値に戻す

export interface BankRule {
  /** 摘要にこの言葉が入っていたら */
  keyword: string;
  /** 相手の科目。空なら「取り込まない」（Stripe からの振込など、別の取り込みで入るもの） */
  accountCode: string;
}

export interface Settings extends FiscalConfig {
  entityName: string;
  entityKind: string;
  /** 共通の経費を分ける割合（収益事業の％）。null＝収入の割合で分ける（段階3で使う） */
  commonProfitPercent: number | null;
  /** 領収書アプリの分類 → 科目コード */
  receiptCategoryMap: Record<string, string>;
  /** 領収書アプリの支払い方法 → 貸方の科目コード */
  paymentMethodMap: Record<string, string>;
  /** 書類アプリの業務委託の支払い → 借方の科目 */
  payoutAccount: string;
  /** 書類アプリの入金（請求書の入金・請求書のない入金）→ 貸方の科目 */
  documentIncomeAccount: string;
  /** 銀行の明細の相手科目を、摘要の言葉で決める規則 */
  bankRules: BankRule[];
}

const RECEIPT_DEFAULT: Record<string, string> = {
  旅費交通費: '506', 会議費: '507', 接待交際費: '508', 消耗品費: '505', 通信費: '503', 車両費: '513', 新聞図書費: '509',
  福利厚生費: '512', 水道光熱費: '511', 支払手数料: '502', 研修費: '510', 仕入: '514', 雑費: '599',
};

export const DEFAULT_SETTINGS: Settings = {
  entityName: '',
  entityKind: '一般社団法人（非営利型）',
  closingMonth: 3,
  firstYearStart: '2026-04-01',
  closedYears: [],
  commonProfitPercent: null,
  receiptCategoryMap: RECEIPT_DEFAULT,
  paymentMethodMap: { 現金: '101', クレジットカード: '201' },
  payoutAccount: '501',
  documentIncomeAccount: '404',
  bankRules: [],
};

const codeOk = (s: unknown): s is string => typeof s === 'string' && /^\d{3}$/.test(s);

function codeMap(v: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(v)) if (k.trim() && codeOk(c)) out[k.trim()] = c;
  return out;
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const month = Number(r.closingMonth);
  const closed = Array.isArray(r.closedYears)
    ? r.closedYears.filter((y): y is { start: string; end: string } => !!y && isDate(y.start) && isDate(y.end) && y.start <= y.end)
    : [];
  const pct = r.commonProfitPercent;
  return {
    entityName: typeof r.entityName === 'string' ? r.entityName.slice(0, 100) : d.entityName,
    entityKind: typeof r.entityKind === 'string' && r.entityKind ? r.entityKind.slice(0, 50) : d.entityKind,
    closingMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : d.closingMonth,
    firstYearStart: isDate(r.firstYearStart) ? r.firstYearStart : d.firstYearStart,
    closedYears: closed,
    commonProfitPercent: typeof pct === 'number' && pct >= 0 && pct <= 100 ? pct : null,
    receiptCategoryMap: codeMap(r.receiptCategoryMap, d.receiptCategoryMap),
    paymentMethodMap: codeMap(r.paymentMethodMap, d.paymentMethodMap),
    payoutAccount: codeOk(r.payoutAccount) ? r.payoutAccount : d.payoutAccount,
    documentIncomeAccount: codeOk(r.documentIncomeAccount) ? r.documentIncomeAccount : d.documentIncomeAccount,
    bankRules: Array.isArray(r.bankRules)
      ? r.bankRules
        .filter((x): x is BankRule => !!x && typeof x.keyword === 'string' && x.keyword.trim() !== '' && (x.accountCode === '' || codeOk(x.accountCode)))
        .map((x) => ({ keyword: x.keyword.trim().slice(0, 50), accountCode: x.accountCode }))
      : d.bankRules,
  };
}
