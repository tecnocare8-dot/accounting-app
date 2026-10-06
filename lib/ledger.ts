import { randomUUID } from 'crypto';
import { ACCOUNT_TYPES, SEGMENT_LABEL, SEGMENTS, nextAccountCode, type Account, type AccountType, type Segment } from './accounts';
import type { AuditEntry } from './audit';
import { isClosedDate, isDate, yearOf, type FiscalConfig } from './fiscal';
import { cleanInput, NotFoundError, ValidationError, validateVoucher, type Voucher, type VoucherInput } from './journal';
import { normalizeSettings, type Settings } from './settings';
import type { LedgerStore } from './store';

// 帳簿を変える操作。どれも法人ごとのロックの中で「読む → 確かめる → 書く → 変更履歴に足す」を行う

export interface LedgerDeps {
  store: LedgerStore;
  now: () => Date;
  /** 変更履歴に残す「操作した人」（Googleアカウントのメール） */
  actor: string;
}

/** 変更履歴に残す伝票の中身（1行） */
export function summarize(v: Pick<Voucher, 'date' | 'segment' | 'description' | 'lines'>): string {
  const lines = v.lines.map((l) => [
    l.debitAccount ? `借 ${l.debitAccount} ${l.debitAmount}` : '', l.creditAccount ? `貸 ${l.creditAccount} ${l.creditAmount}` : '',
  ].filter(Boolean).join(' ')).join(' / ');
  return `${v.date} ${SEGMENT_LABEL[v.segment] ?? ''} ${v.description}：${lines}`;
}

const voucherLabel = (v: Voucher) => `${v.date.slice(0, 4)} No.${v.number}`;

function nextNumber(journal: Voucher[], fiscal: FiscalConfig, date: string): number {
  const y = yearOf(fiscal, date);
  const same = journal.filter((v) => y && v.date >= y.start && v.date <= y.end);
  return same.reduce((m, v) => Math.max(m, v.number), 0) + 1;
}

const sourceKey = (v: Pick<Voucher, 'source' | 'sourceId'>) => (v.source && v.sourceId ? `${v.source}\u0000${v.sourceId}` : '');

function entry(deps: LedgerDeps, action: string, v: Voucher, detail: string): AuditEntry {
  return { at: deps.now().toISOString(), actor: deps.actor, action, target: voucherLabel(v), targetId: v.id, detail };
}

function checkInput(input: VoucherInput, accounts: Account[], settings: Settings) {
  const errors = validateVoucher(input, accounts, settings);
  if (errors.length) throw new ValidationError(errors);
}

/** 伝票を足す。同じIDがすでにあれば、それを返す（二度押し・通信の再送で2件にならないように） */
export async function addVoucher(deps: LedgerDeps, id: string, raw: unknown): Promise<Voucher> {
  if (!/^v-[\w-]{8,80}$/.test(id)) throw new ValidationError(['伝票のIDが正しくありません。画面を開き直してください。']);
  return deps.store.lock(async () => {
    const [settings, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    const existing = journal.find((v) => v.id === id);
    if (existing) return existing;
    const input = cleanInput(raw);
    checkInput(input, accounts, settings);
    const key = sourceKey({ source: input.source ?? '', sourceId: input.sourceId ?? '' });
    if (key && journal.some((v) => sourceKey(v) === key)) throw new ValidationError(['この取引は、すでに帳簿に取り込まれています。']);
    const at = deps.now().toISOString();
    const v: Voucher = {
      id, number: nextNumber(journal, settings, input.date), date: input.date, segment: input.segment,
      description: input.description, counterparty: input.counterparty, source: input.source ?? '', sourceId: input.sourceId ?? '',
      lines: input.lines, createdAt: at, updatedAt: at,
    };
    await deps.store.saveJournal([...journal, v], accounts, settings);
    await deps.store.appendAudit([entry(deps, '追加', v, summarize(v))]);
    return v;
  });
}

/** まとめて足す（取り込み）。取り込み済み・保存できないものは足さずに理由を返す */
export async function addVouchers(deps: LedgerDeps, inputs: unknown[], action = '取り込み'): Promise<{ added: Voucher[]; skipped: { index: number; reason: string }[] }> {
  return deps.store.lock(async () => {
    const [settings, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    const keys = new Set(journal.map(sourceKey).filter(Boolean));
    const added: Voucher[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const at = deps.now().toISOString();
    inputs.forEach((raw, index) => {
      const input = cleanInput(raw);
      const errors = validateVoucher(input, accounts, settings);
      if (errors.length) return skipped.push({ index, reason: errors.join(' ') });
      const key = sourceKey({ source: input.source ?? '', sourceId: input.sourceId ?? '' });
      if (key && keys.has(key)) return skipped.push({ index, reason: 'すでに取り込み済み' });
      if (key) keys.add(key);
      const all = [...journal, ...added];
      added.push({
        id: `v-${randomUUID()}`, number: nextNumber(all, settings, input.date), date: input.date, segment: input.segment,
        description: input.description, counterparty: input.counterparty, source: input.source ?? '', sourceId: input.sourceId ?? '',
        lines: input.lines, createdAt: at, updatedAt: at,
      });
    });
    if (added.length) {
      await deps.store.saveJournal([...journal, ...added], accounts, settings);
      await deps.store.appendAudit(added.map((v) => entry(deps, action, v, `${v.source} ${v.sourceId}：${summarize(v)}`)));
    }
    return { added, skipped };
  });
}

/** 伝票を直す。取り込み元・取り込み元IDは変えない。年度が変わったら、その年度の番号を振り直す */
export async function updateVoucher(deps: LedgerDeps, id: string, raw: unknown): Promise<Voucher> {
  return deps.store.lock(async () => {
    const [settings, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    const old = journal.find((v) => v.id === id);
    if (!old) throw new NotFoundError('伝票が見つかりません。');
    if (isClosedDate(settings, old.date)) throw new ValidationError(['締めた年度の伝票は直せません。']);
    const input = cleanInput(raw);
    checkInput(input, accounts, settings);
    const sameYear = yearOf(settings, old.date)?.start === yearOf(settings, input.date)?.start;
    const v: Voucher = {
      ...old, date: input.date, segment: input.segment, description: input.description, counterparty: input.counterparty,
      lines: input.lines, number: sameYear ? old.number : nextNumber(journal.filter((x) => x.id !== id), settings, input.date),
      updatedAt: deps.now().toISOString(),
    };
    await deps.store.saveJournal(journal.map((x) => (x.id === id ? v : x)), accounts, settings);
    await deps.store.appendAudit([entry(deps, '修正', v, `前：${summarize(old)} → 後：${summarize(v)}`)]);
    return v;
  });
}

/** 伝票を消す。中身はすべて変更履歴に残す */
export async function deleteVoucher(deps: LedgerDeps, id: string, reason: string): Promise<void> {
  const why = reason.trim().slice(0, 200);
  if (!why) throw new ValidationError(['消す理由を入れてください。']);
  await deps.store.lock(async () => {
    const [settings, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    const old = journal.find((v) => v.id === id);
    if (!old) throw new NotFoundError('伝票が見つかりません。');
    if (isClosedDate(settings, old.date)) throw new ValidationError(['締めた年度の伝票は消せません。']);
    await deps.store.saveJournal(journal.filter((v) => v.id !== id), accounts, settings);
    await deps.store.appendAudit([entry(deps, '削除', old, `理由：${why}／${summarize(old)}／元の伝票：${JSON.stringify(old)}`)]);
  });
}

// ---------------------------------------------------------------- 勘定科目

/** 科目を足す（code が空）か直す。使っている科目の種類は変えられない */
export async function saveAccount(deps: LedgerDeps, raw: unknown): Promise<Account> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : '';
  const type = r.type as AccountType;
  const segment = r.segment as Segment;
  const errors: string[] = [];
  if (!name) errors.push('科目の名前を入れてください。');
  if (!ACCOUNT_TYPES.includes(type)) errors.push('科目の種類を選んでください。');
  if (!SEGMENTS.includes(segment)) errors.push('区分の初期値を選んでください。');
  if (errors.length) throw new ValidationError(errors);
  return deps.store.lock(async () => {
    const [settings, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    if (accounts.some((a) => a.name === name && a.code !== r.code)) throw new ValidationError([`「${name}」という科目はすでにあります。`]);
    const code = typeof r.code === 'string' && r.code ? r.code : nextAccountCode(accounts, type);
    if (!code) throw new ValidationError(['この種類の科目はこれ以上増やせません。使っていない科目の名前を変えて使ってください。']);
    const old = accounts.find((a) => a.code === code);
    if (r.code && !old) throw new NotFoundError('科目が見つかりません。');
    const used = journal.some((v) => v.lines.some((l) => l.debitAccount === code || l.creditAccount === code));
    if (old && old.type !== type && used) throw new ValidationError(['仕訳で使っている科目の種類は変えられません。新しい科目を作ってください。']);
    const a: Account = { code, name, type, segment, taxableSales: Boolean(r.taxableSales), needsCheck: Boolean(r.needsCheck), active: r.active !== false };
    const list = old ? accounts.map((x) => (x.code === code ? a : x)) : [...accounts, a];
    await deps.store.saveAccounts(list);
    // 仕訳帳の科目名の列も新しい名前にする
    if (old && old.name !== name && used) await deps.store.saveJournal(journal, list, settings);
    await deps.store.appendAudit([{
      at: deps.now().toISOString(), actor: deps.actor, action: old ? '科目の変更' : '科目の追加', target: `${code} ${name}`, targetId: code,
      detail: old ? `前：${JSON.stringify(old)} → 後：${JSON.stringify(a)}` : JSON.stringify(a),
    }]);
    return a;
  });
}

// ---------------------------------------------------------------- 設定

/** 設定を保存する。締めた年度は変えない。帳簿を付け始めた日より前の伝票ができる変更はしない */
export async function updateSettings(deps: LedgerDeps, raw: unknown): Promise<Settings> {
  return deps.store.lock(async () => {
    const [old, accounts, journal] = await Promise.all([deps.store.loadSettings(), deps.store.loadAccounts(), deps.store.loadJournal()]);
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const errors: string[] = [];
    if (r.firstYearStart !== undefined && !isDate(r.firstYearStart)) errors.push('帳簿を付け始めた日を正しく入れてください。');
    const next = normalizeSettings({ ...old, ...r, closedYears: old.closedYears });
    if (!next.entityName.trim()) errors.push('法人の名前を入れてください。');
    if (old.closedYears.length && next.firstYearStart !== old.firstYearStart) errors.push('締めた年度があるので、帳簿を付け始めた日は変えられません。');
    const early = journal.find((v) => v.date < next.firstYearStart);
    if (early) errors.push(`${early.date} の伝票があるので、帳簿を付け始めた日をそれより後にはできません。`);
    const codes = new Set(accounts.map((a) => a.code));
    const used = [...Object.values(next.receiptCategoryMap), ...Object.values(next.paymentMethodMap), next.payoutAccount,
      ...Object.values(next.stripeTypeMap), next.stripePayoutAccount,
      next.documentIncomeAccount, ...next.bankRules.map((b) => b.accountCode).filter(Boolean)];
    const missing = [...new Set(used.filter((c) => !codes.has(c)))];
    if (missing.length) errors.push(`対応表に、ない科目（${missing.join('、')}）が入っています。`);
    if (errors.length) throw new ValidationError(errors);
    await deps.store.saveSettings(next);
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(old[k]));
    if (changed.length) {
      await deps.store.appendAudit([{
        at: deps.now().toISOString(), actor: deps.actor, action: '設定の変更', target: '設定', targetId: 'settings',
        detail: changed.map((k) => `${k}：${JSON.stringify(old[k])} → ${JSON.stringify(next[k])}`).join('／'),
      }]);
    }
    return next;
  });
}
