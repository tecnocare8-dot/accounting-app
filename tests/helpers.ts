import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileBackend, type Backend } from '@/lib/drive/backend';
import type { LedgerDeps } from '@/lib/ledger';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { createStore, setupFolder } from '@/lib/store';

/** 同時に来た処理を1つずつ順番に通す（本番の法人ごとのロックと同じ役目） */
export function serialLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
}

export const TEST_SETTINGS: Settings = { ...DEFAULT_SETTINGS, entityName: '一般社団法人テスト', firstYearStart: '2026-04-01', closingMonth: 3 };

export async function memoryStore(settings: Partial<Settings> = {}, wrap: (b: Backend) => Backend = (b) => b) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'acctapp-'));
  const raw = fileBackend(root);
  const folderId = await setupFolder(raw, '会計_テスト', { ...TEST_SETTINGS, ...settings });
  const backend = wrap(raw);
  return { backend, raw, folderId, store: createStore({ backend, folderId, lock: serialLock() }) };
}

export async function testDeps(settings: Partial<Settings> = {}): Promise<LedgerDeps> {
  const { store } = await memoryStore(settings);
  let t = Date.parse('2027-01-01T00:00:00Z');
  return { store, now: () => new Date((t += 1000)), actor: 'owner@example.com' };
}

export const line = (d: string, da: number, c: string, ca: number, memo = '') => ({ debitAccount: d, debitAmount: da, creditAccount: c, creditAmount: ca, memo });
export const vid = (n: number) => `v-test-${String(n).padStart(8, '0')}`;
