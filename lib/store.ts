import { auditFromCsv, auditToCsv, type AuditEntry } from './audit';
import { DEFAULT_ACCOUNTS, type Account } from './accounts';
import { decodeText } from './csv';
import type { Backend } from './drive/backend';
import type { Voucher } from './journal';
import { accountsFromCsv, accountsToCsv, importLogFromCsv, importLogToCsv, journalFromCsv, journalToCsv, type ImportLog } from './records';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';

// 法人ごとのフォルダの構成：
//   会計_一般社団法人テクノケア/
//     仕訳帳.csv  勘定科目.csv  設定.json  変更履歴.csv  取り込み記録.csv
// required のファイルが無いときは作り直さない（空で作ると帳簿が消えたように見え、取り込みが二重になるため）
export const FILES = {
  journal: { name: '仕訳帳.csv', mime: 'text/csv', required: true },
  accounts: { name: '勘定科目.csv', mime: 'text/csv', required: true },
  settings: { name: '設定.json', mime: 'application/json', required: true },
  audit: { name: '変更履歴.csv', mime: 'text/csv', required: false },
  imports: { name: '取り込み記録.csv', mime: 'text/csv', required: false },
} as const;
export type FileKind = keyof typeof FILES;

/** 台帳のファイルがドライブに無い（ゴミ箱から戻してもらう） */
export class LedgerMissingError extends Error {
  constructor(public fileName: string) {
    super(`${fileName} がドライブに見つかりません。`);
  }
}
/** 法人のフォルダが未作成、またはドライブで削除された */
export class FolderMissingError extends Error {}

/** 新しい法人のフォルダを作り、空の仕訳帳・初期の勘定科目・設定を入れる */
export async function setupFolder(backend: Backend, name: string, settings: Settings): Promise<string> {
  const folderId = await backend.createFolder(null, name, { kind: 'root' });
  const content: Record<FileKind, string> = {
    journal: journalToCsv([], DEFAULT_ACCOUNTS, settings),
    accounts: accountsToCsv(DEFAULT_ACCOUNTS),
    settings: JSON.stringify(settings, null, 1),
    audit: auditToCsv([]),
    imports: importLogToCsv([]),
  };
  for (const kind of Object.keys(FILES) as FileKind[]) {
    const f = FILES[kind];
    await backend.create(folderId, f.name, f.mime, { kind }, Buffer.from(content[kind], 'utf8'));
  }
  return folderId;
}

export interface StoreDeps {
  backend: Backend;
  folderId: string;
  /** 台帳の「読む → 書く」を法人ごとに1つずつ順番に行う */
  lock: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createStore({ backend, folderId, lock }: StoreDeps) {
  async function fileOf(kind: FileKind) {
    const [f] = await backend.find(folderId, { kind });
    return f ?? null;
  }

  async function read(kind: FileKind): Promise<string | null> {
    const f = await fileOf(kind);
    const data = f ? await backend.download(f.id) : null;
    if (!data) {
      if (FILES[kind].required) throw new LedgerMissingError(FILES[kind].name);
      return null;
    }
    return decodeText(data);
  }

  async function write(kind: FileKind, content: string) {
    const f = await fileOf(kind);
    const data = Buffer.from(content, 'utf8');
    if (f) return backend.updateMedia(f.id, FILES[kind].mime, data);
    if (FILES[kind].required) throw new LedgerMissingError(FILES[kind].name);
    await backend.create(folderId, FILES[kind].name, FILES[kind].mime, { kind }, data);
  }

  async function loadSettings(): Promise<Settings> {
    const text = await read('settings');
    try {
      return normalizeSettings(JSON.parse(text ?? ''));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async function loadAccounts(): Promise<Account[]> {
    const list = accountsFromCsv((await read('accounts')) ?? '');
    // あとから増えた初期の科目（画面からは科目を消せないので、無いもの＝新しく足した科目）を足しておく
    const codes = new Set(list.map((a) => a.code));
    return [...list, ...DEFAULT_ACCOUNTS.filter((a) => !codes.has(a.code))];
  }

  return {
    folderId,
    lock,
    loadSettings,
    async saveSettings(s: Settings) { await write('settings', JSON.stringify(s, null, 1)); },
    loadAccounts,
    async saveAccounts(list: Account[]) { await write('accounts', accountsToCsv(list)); },
    async loadJournal(): Promise<Voucher[]> { return journalFromCsv((await read('journal')) ?? ''); },
    /** 仕訳帳の CSV には科目名と年度も書くので、科目と設定も一緒に渡す */
    async saveJournal(list: Voucher[], accounts: Account[], settings: Settings) {
      await write('journal', journalToCsv(list, accounts, settings));
    },
    async loadAudit(): Promise<AuditEntry[]> { return auditFromCsv((await read('audit')) ?? ''); },
    /** 変更履歴に足す（ロックの中で呼ぶ） */
    async appendAudit(entries: AuditEntry[]) {
      if (!entries.length) return;
      await write('audit', auditToCsv([...auditFromCsv((await read('audit')) ?? ''), ...entries]));
    },
    async loadImportLog(): Promise<ImportLog[]> { return importLogFromCsv((await read('imports')) ?? ''); },
    async appendImportLog(entry: ImportLog) {
      await write('imports', importLogToCsv([...importLogFromCsv((await read('imports')) ?? ''), entry]));
    },
    /** 設定画面に出す、台帳ファイルへのリンク */
    async fileLinks(): Promise<Partial<Record<FileKind, string>>> {
      const out: Partial<Record<FileKind, string>> = {};
      for (const kind of Object.keys(FILES) as FileKind[]) {
        const f = await fileOf(kind);
        if (f) out[kind] = `https://drive.google.com/file/d/${f.id}/view`;
      }
      return out;
    },
  };
}

export type LedgerStore = ReturnType<typeof createStore>;
