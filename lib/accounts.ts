// 勘定科目。コードで見分け（名前は変えられる）、種類で貸借対照表・損益計算書のどこに出るかが決まる

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: '資産', liability: '負債', equity: '純資産', revenue: '収入', expense: '支出',
};

/** 収益事業の区分。伝票ごとに1つ持つ */
export const SEGMENTS = ['profit', 'nonprofit', 'common'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABEL: Record<Segment, string> = { profit: '収益事業', nonprofit: '非収益事業', common: '共通' };

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  /** この科目を使う伝票の区分の初期値（収入・支出の科目で使う） */
  segment: Segment;
  /** 消費税の課税売上に数える（区分に関係なく数える。会費・寄付・利息のように対価でないものは数えない） */
  taxableSales: boolean;
  /** 税務署に確認するまで画面に「要確認」と出す */
  needsCheck: boolean;
  /** 使わなくなった科目は消さずに隠す（過去の仕訳が読めなくならないように） */
  active: boolean;
}

/** 借方が増える向きの科目（資産・支出）。それ以外は貸方が増える向き */
export const isDebitNormal = (t: AccountType) => t === 'asset' || t === 'expense';
export const isProfitAndLoss = (t: AccountType) => t === 'revenue' || t === 'expense';

/** 前年度までの収入−支出を足し込む科目 */
export const RETAINED_EARNINGS = '301';

const a = (code: string, name: string, type: AccountType, segment: Segment, opt: { taxableSales?: boolean; needsCheck?: boolean } = {}): Account =>
  ({ code, name, type, segment, taxableSales: opt.taxableSales ?? false, needsCheck: opt.needsCheck ?? false, active: true });

// 初期値（設計書 3. 帳簿）。税務署に確認した結果に合わせて、設定画面で変えられる
export const DEFAULT_ACCOUNTS: Account[] = [
  a('101', '現金', 'asset', 'nonprofit'),
  a('102', '普通預金', 'asset', 'nonprofit'),
  a('103', 'Stripe残高', 'asset', 'nonprofit'),
  a('111', '売掛金', 'asset', 'nonprofit'),
  a('121', '前払費用', 'asset', 'nonprofit'),
  a('201', '未払金', 'liability', 'nonprofit'),
  a('202', '預り金', 'liability', 'nonprofit'),
  a('203', '前受金', 'liability', 'nonprofit'),
  a('204', '未払法人税等', 'liability', 'nonprofit'),
  a('301', '繰越利益', 'equity', 'nonprofit'),
  // 区分のあいだでお金を動かすときの相手（法人全体では打ち消し合って0になる）
  a('391', '区分間振替', 'equity', 'nonprofit'),
  // 受講料：医療・介護の知識・技術は「技芸教授業」の技芸に入らないため非収益（個人が申し込む公開講座の形が前提）
  a('401', '受講料収入', 'revenue', 'nonprofit', { taxableSales: true }),
  // 認定料・更新料：受講料に含まれる形・会費として扱う形なら非収益。独立したサービスとして売ると収益事業になりやすい
  a('402', '認定料収入', 'revenue', 'nonprofit', { taxableSales: true, needsCheck: true }),
  a('403', '更新料収入', 'revenue', 'nonprofit', { taxableSales: true, needsCheck: true }),
  // 企業パッケージ：法人が公開講座の受講枠を買うだけ（中身・値段は個人向けと同じ）なので非収益。税務署に確かめるまで要確認
  a('404', '研修収入', 'revenue', 'nonprofit', { taxableSales: true, needsCheck: true }),
  // 法人の求めに合わせて作るカスタマイズ研修は、法人から受託する「請負業」＝収益事業
  a('406', '受託研修収入', 'revenue', 'profit', { taxableSales: true }),
  // テキスト・グッズの別売りは物品販売業・出版業
  a('405', '物品販売収入', 'revenue', 'profit', { taxableSales: true }),
  a('411', '会費収入', 'revenue', 'nonprofit'),
  a('412', '寄付金収入', 'revenue', 'nonprofit'),
  a('421', '受取利息', 'revenue', 'nonprofit'),
  a('501', '講師謝金', 'expense', 'common'),
  a('502', '支払手数料', 'expense', 'common'),
  a('503', '通信費', 'expense', 'common'),
  a('504', '広告宣伝費', 'expense', 'common'),
  a('505', '消耗品費', 'expense', 'common'),
  a('506', '旅費交通費', 'expense', 'common'),
  a('507', '会議費', 'expense', 'common'),
  a('508', '接待交際費', 'expense', 'common'),
  a('509', '新聞図書費', 'expense', 'common'),
  a('510', '研修費', 'expense', 'common'),
  a('511', '水道光熱費', 'expense', 'common'),
  a('512', '福利厚生費', 'expense', 'common'),
  a('513', '車両費', 'expense', 'common'),
  a('514', '仕入高', 'expense', 'profit'),
  a('521', '租税公課', 'expense', 'common'),
  a('531', '法人税等', 'expense', 'common'),
  a('599', '雑費', 'expense', 'common'),
];

/** 新しい科目のコード：同じ種類の番号帯（例：支出は501〜599）で空いている最初の番号。空きがなければ null */
export function nextAccountCode(accounts: Account[], type: AccountType): string | null {
  const base = { asset: 100, liability: 200, equity: 300, revenue: 400, expense: 500 }[type];
  const used = new Set(accounts.map((x) => x.code));
  for (let n = base + 1; n < base + 100; n++) if (!used.has(String(n))) return String(n);
  return null;
}

export function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((x) => [x.code, x]));
}

const TYPE_ORDER: Record<AccountType, number> = { asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4 };
export const sortAccounts = (list: Account[]) =>
  [...list].sort((x, y) => TYPE_ORDER[x.type] - TYPE_ORDER[y.type] || x.code.localeCompare(y.code));
