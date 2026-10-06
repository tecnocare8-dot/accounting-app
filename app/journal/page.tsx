'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ErrorBox, inputClass, Notice, SegmentBadge } from '@/components/ui';
import { accountMap, SEGMENT_LABEL, SEGMENTS, type Account } from '@/lib/accounts';
import { api, num } from '@/lib/client-api';
import { yearLabel, type FiscalYear } from '@/lib/fiscal';
import { sumDebit, type Voucher } from '@/lib/journal';

interface Data { vouchers: Voucher[]; accounts: Account[]; years: FiscalYear[]; year: FiscalYear }

function JournalList() {
  const q = useSearchParams();
  const [year, setYear] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [account, setAccount] = useState('');
  const [segment, setSegment] = useState('');
  const [month, setMonth] = useState('');

  const load = useCallback(() => {
    api<Data>(`/api/journal${year ? `?year=${year}` : ''}`).then(setData).catch((e: Error) => setError(e.message));
  }, [year]);
  useEffect(load, [load]);

  if (!data) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  const map = accountMap(data.accounts);
  const name = (c: string) => map.get(c)?.name ?? c;
  const t = text.trim();
  const shown = data.vouchers.filter((v) =>
    (!t || [v.description, v.counterparty, ...v.lines.map((l) => l.memo), String(v.number)].some((s) => s.includes(t)) || v.lines.some((l) => String(l.debitAmount) === t || String(l.creditAmount) === t))
    && (!account || v.lines.some((l) => l.debitAccount === account || l.creditAccount === account))
    && (!segment || v.segment === segment)
    && (!month || v.date.slice(0, 7) === month));
  const months = [...new Set(data.vouchers.map((v) => v.date.slice(0, 7)))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">仕訳</h1>
        <div className="flex gap-2">
          <Link className="rounded-lg bg-[#285e4b] px-4 py-2 text-sm font-bold text-white" href="/journal/new">入力する</Link>
          <a className="rounded-lg border border-gray-500 px-3 py-2 text-sm font-bold" href={`/api/export?type=journal&year=${data.year.start}`}>仕訳帳のCSV</a>
        </div>
      </div>
      {q.get('deleted') ? <Notice message="伝票を消しました。中身は変更履歴に残っています。" /> : null}
      <div className="grid gap-2 md:grid-cols-5">
        <select aria-label="年度" className={inputClass} value={data.year.start} onChange={(e) => setYear(e.target.value)}>
          {data.years.map((y) => <option key={y.start} value={y.start}>{yearLabel(y)}{y.closed ? '・締め済み' : ''}</option>)}
        </select>
        <select aria-label="月" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">すべての月</option>
          {months.map((m) => <option key={m} value={m}>{m.replace('-', '年')}月</option>)}
        </select>
        <select aria-label="科目" className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">すべての科目</option>
          {data.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
        </select>
        <select aria-label="区分" className={inputClass} value={segment} onChange={(e) => setSegment(e.target.value)}>
          <option value="">すべての区分</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
        </select>
        <input aria-label="検索" className={inputClass} placeholder="摘要・取引先・金額で探す" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className="text-sm">{shown.length}件</p>
      <ul className="divide-y divide-gray-200 rounded-xl border border-gray-300 bg-white">
        {shown.map((v) => (
          <li key={v.id}>
            <Link href={`/journal/${v.id}`} className="block p-3 hover:bg-gray-50">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{v.date}</span><span>No.{v.number}</span><SegmentBadge segment={v.segment} />
                <span className="font-bold">{v.description || '（摘要なし）'}</span>
                {v.counterparty ? <span>／{v.counterparty}</span> : null}
                <span className="ml-auto font-bold">{num(sumDebit(v.lines))}円</span>
              </div>
              <div className="mt-1 text-xs">
                {v.lines.map((l, i) => (
                  <span key={i} className="mr-3 inline-block">
                    {l.debitAccount ? `${name(l.debitAccount)} ${num(l.debitAmount)}` : ''}
                    {l.debitAccount && l.creditAccount ? ' ／ ' : ''}
                    {l.creditAccount ? `${l.debitAccount ? '' : '／ '}${name(l.creditAccount)} ${num(l.creditAmount)}` : ''}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        ))}
        {!shown.length ? <li className="p-3 text-sm">伝票はありません。</li> : null}
      </ul>
    </div>
  );
}

export default function JournalPage() {
  return <Suspense fallback={<p>読み込み中…</p>}><JournalList /></Suspense>;
}
