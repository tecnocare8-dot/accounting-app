'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AccountSelect, Button, Card, ErrorBox, Field, inputClass, Notice } from '@/components/ui';
import { SEGMENT_LABEL, SEGMENTS, type Account, type Segment } from '@/lib/accounts';
import { api, num } from '@/lib/client-api';
import { CANDIDATE_STATUS_LABEL, IMPORT_KIND_LABEL, IMPORT_KINDS, type BankOptions, type Candidate, type ImportKind } from '@/lib/importers';
import type { ImportLog } from '@/lib/records';

interface Preview {
  candidates: Candidate[];
  bank?: BankOptions & { headers?: string[] };
  preview?: { headers: string[]; rows: string[][] };
  needColumns?: boolean;
}

const HINT: Record<ImportKind, string> = {
  receipts: '領収書アプリの「帳簿」のCSV（領収書一覧.csv）。分類→科目、支払い方法→貸方の科目は、設定の対応表で決めます。',
  'document-payouts': '書類アプリのドライブのフォルダにある 支払記録.csv。講師謝金／預り金（源泉徴収税）・普通預金 で入れます。',
  'document-incomes': '書類アプリの その他の入金.csv。普通預金・支払手数料／設定の科目（初期値：研修収入）で入れます。',
  'document-payments': '書類アプリの 入金記録.csv（請求書の入金）。普通預金・支払手数料／設定の科目（初期値：研修収入）で入れます。',
  bank: '銀行のサイトから書き出した入出金明細の CSV。列は読み込んだあとに選べます。相手の科目は、設定の「銀行の摘要の規則」で決まります。',
};

/** 科目が決まっていない行がないか */
const ready = (c: Candidate) => c.input.lines.every((l) => (!l.debitAmount || l.debitAccount) && (!l.creditAmount || l.creditAccount));
const lockedStatus = (c: Candidate) => c.status === 'duplicate' || c.status === 'error';

export default function ImportPage() {
  const [kind, setKind] = useState<ImportKind>('receipts');
  const [file, setFile] = useState<File | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [data, setData] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [bank, setBank] = useState<BankOptions | null>(null);
  const [log, setLog] = useState<ImportLog[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadLog = useCallback(() => {
    api<{ log: ImportLog[] }>('/api/import/log').then((r) => setLog(r.log)).catch(() => undefined);
  }, []);
  useEffect(() => {
    api<{ accounts: Account[] }>('/api/settings').then((r) => setAccounts(r.accounts)).catch((e: Error) => setError(e.message));
    loadLog();
  }, [loadLog]);

  async function read(opts: BankOptions | null = bank) {
    if (!file) return setError('CSV ファイルを選んでください。');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', file);
      if (kind === 'bank' && opts) form.set('bank', JSON.stringify(opts));
      const r = await api<Preview>('/api/import/preview', { method: 'POST', body: form });
      setData(r);
      setRows(r.candidates);
      if (r.bank) setBank(r.bank);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const chosen = rows.filter((c) => c.include && ready(c) && !lockedStatus(c));
    if (!chosen.length) return setError('取り込む行を選んでください。');
    setBusy(true);
    setError('');
    try {
      const r = await api<{ added: number; skipped: { index: number; reason: string }[] }>('/api/import/commit', {
        method: 'POST', body: JSON.stringify({ kind, fileName: file?.name ?? '', inputs: chosen.map((c) => c.input) }),
      });
      setNotice(`${r.added}件を帳簿に入れました。${r.skipped.length ? `入れなかったもの ${r.skipped.length}件：${r.skipped.slice(0, 5).map((s) => s.reason).join('／')}` : ''}`);
      setData(null);
      setRows([]);
      loadLog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, fn: (c: Candidate) => Candidate) => setRows(rows.map((c, j) => {
    if (j !== i) return c;
    const next = fn(c);
    // 科目がそろったら、取り込むの印を付ける
    if (!c.include && next.include === c.include && !ready(c) && ready(next) && !lockedStatus(next)) return { ...next, include: true };
    return next;
  }));
  const setLineAccount = (i: number, li: number, side: 'debitAccount' | 'creditAccount', code: string) =>
    update(i, (c) => ({ ...c, input: { ...c.input, lines: c.input.lines.map((l, k) => (k === li ? { ...l, [side]: code } : l)) } }));

  const chosenCount = rows.filter((c) => c.include && ready(c) && !lockedStatus(c)).length;
  const colSelect = (label: string, key: 'dateCol' | 'descCol' | 'inCol' | 'outCol' | 'amountCol') => bank ? (
    <Field label={label}>
      <select className={inputClass} value={bank[key]} onChange={(e) => setBank({ ...bank, [key]: Number(e.target.value) })}>
        <option value={-1}>（使わない）</option>
        {(data?.preview?.headers ?? []).map((h, i) => <option key={i} value={i}>{i + 1}列目：{h}</option>)}
      </select>
    </Field>
  ) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">取り込み</h1>
      <Card>
        <div className="space-y-3">
          <Field label="取り込み元">
            <select className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setData(null); setRows([]); setBank(null); }}>
              {IMPORT_KINDS.map((k) => <option key={k} value={k}>{IMPORT_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <p className="text-sm">{HINT[kind]}</p>
          <Field label="CSV ファイル">
            <input type="file" accept=".csv,text/csv" className="block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setData(null); setRows([]); setBank(null); }} />
          </Field>
          <Button disabled={busy || !file} onClick={() => read(null)}>{busy ? '読み込み中…' : '読み込む（まだ帳簿には入れません）'}</Button>
        </div>
      </Card>
      <ErrorBox message={error} />
      <Notice message={notice} />

      {kind === 'bank' && bank && data ? (
        <Card title="銀行の明細の列">
          <div className="grid gap-2 md:grid-cols-3">
            <Field label="この明細の口座の科目">
              <AccountSelect accounts={accounts.filter((a) => a.type === 'asset')} value={bank.bankAccount} onChange={(c) => setBank({ ...bank, bankAccount: c })} />
            </Field>
            <Field label="見出しの行" hint="空の行は数えません">
              <input type="number" min={1} className={inputClass} value={bank.headerRow + 1} onChange={(e) => setBank({ ...bank, headerRow: Math.max(0, Number(e.target.value) - 1) })} />
            </Field>
            {colSelect('日付の列', 'dateCol')}
            {colSelect('摘要の列', 'descCol')}
            {colSelect('入金の列', 'inCol')}
            {colSelect('出金の列', 'outCol')}
            {colSelect('入出金が1つの列（＋−）のとき', 'amountCol')}
          </div>
          {data.preview ? (
            <div className="mt-3 overflow-x-auto text-xs">
              <table className="min-w-full">
                <tbody>{data.preview.rows.map((r, i) => <tr key={i} className={i === bank.headerRow ? 'bg-amber-50 font-bold' : ''}>{r.map((c, j) => <td key={j} className="border px-1">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
          <Button className="mt-3" disabled={busy} onClick={() => read(bank)}>この列で読み直す</Button>
        </Card>
      ) : null}

      {rows.length ? (
        <Card title={`読み込んだ行（${rows.length}件）`} actions={<Button disabled={busy || !chosenCount} onClick={commit}>選んだ {chosenCount}件 を帳簿に入れる</Button>}>
          <p className="mb-2 text-sm">
            「科目を選んでください」の行は、科目を選ぶと取り込めます。毎回同じ科目になるものは、<Link className="underline" href="/settings#rules">設定の対応表</Link>に入れておくと次から自動で入ります。
          </p>
          <ul className="divide-y divide-gray-200">
            {rows.map((c, i) => (
              <li key={i} className={`space-y-1 py-2 text-sm ${lockedStatus(c) ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`${c.row}行目を取り込む`} checked={c.include && ready(c)} disabled={lockedStatus(c) || !ready(c)}
                    onChange={(e) => update(i, (x) => ({ ...x, include: e.target.checked }))} />
                  <span className="font-bold">{c.input.date || '日付なし'}</span>
                  <span>{c.input.description}</span>
                  <span className="rounded-full border border-gray-500 px-2 text-xs font-bold">{ready(c) && c.status === 'needsAccount' ? '科目を選びました' : CANDIDATE_STATUS_LABEL[c.status]}</span>
                  {c.note ? <span className="text-xs">{c.note}</span> : null}
                </div>
                {!lockedStatus(c) ? (
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <select aria-label={`${c.row}行目の区分`} className="rounded border border-gray-500 px-1 py-1 text-sm" value={c.input.segment}
                      onChange={(e) => update(i, (x) => ({ ...x, input: { ...x.input, segment: e.target.value as Segment } }))}>
                      {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
                    </select>
                    {c.input.lines.map((l, li) => (
                      <span key={li} className="flex items-center gap-1">
                        {l.debitAmount ? (<>借 <AccountSelect label={`${c.row}行目の借方`} className="rounded border border-gray-500 px-1 py-1 text-sm" accounts={accounts} value={l.debitAccount} onChange={(code) => setLineAccount(i, li, 'debitAccount', code)} /> {num(l.debitAmount)}</>) : null}
                        {l.creditAmount ? (<>貸 <AccountSelect label={`${c.row}行目の貸方`} className="rounded border border-gray-500 px-1 py-1 text-sm" accounts={accounts} value={l.creditAccount} onChange={(code) => setLineAccount(i, li, 'creditAccount', code)} /> {num(l.creditAmount)}</>) : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : data && !data.needColumns ? <p className="text-sm">取り込める行がありませんでした。</p> : null}

      <Card title="これまでの取り込み">
        <ul className="space-y-1 text-sm">
          {log.map((l, i) => (
            <li key={i}>{new Date(l.at).toLocaleString('ja-JP')}　{l.kind}　{l.fileName}　入れた {l.added}件・入れなかった {l.skipped}件</li>
          ))}
          {!log.length ? <li>まだありません。</li> : null}
        </ul>
      </Card>
    </div>
  );
}
