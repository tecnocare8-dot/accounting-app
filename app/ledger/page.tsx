'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, inputClass, SegmentBadge } from '@/components/ui';
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, accountMap, SEGMENT_LABEL, SEGMENTS, type Account } from '@/lib/accounts';
import { api, num } from '@/lib/client-api';
import { yearLabel, type FiscalYear } from '@/lib/fiscal';
import type { GeneralLedger, TrialBalance } from '@/lib/reports';

interface Base { year: FiscalYear; years: FiscalYear[]; accounts: Account[]; range: { from: string; to: string } }
type Trial = TrialBalance & Base & { check: { debit: number; credit: number } };
type Ledger = GeneralLedger & Base;

export default function LedgerPage() {
  const [tab, setTab] = useState<'trial' | 'ledger'>('trial');
  const [year, setYear] = useState('');
  const [to, setTo] = useState('');
  const [segment, setSegment] = useState('');
  const [code, setCode] = useState('102');
  const [trial, setTrial] = useState<Trial | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');

  const query = new URLSearchParams({ ...(year ? { year } : {}), ...(to ? { to } : {}), ...(segment ? { segment } : {}) }).toString();
  const load = useCallback(() => {
    const ok = <T,>(set: (v: T) => void) => (v: T) => { setError(''); set(v); };
    if (tab === 'trial') api<Trial>(`/api/reports/trial?${query}`).then(ok(setTrial)).catch((e: Error) => setError(e.message));
    else api<Ledger>(`/api/reports/ledger?${query}&code=${code}`).then(ok(setLedger)).catch((e: Error) => setError(e.message));
  }, [tab, query, code]);
  useEffect(load, [load]);

  const base: Base | null = tab === 'trial' ? trial : ledger;
  const openLedger = (c: string) => { setCode(c); setTab('ledger'); };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">帳簿</h1>
      <div className="flex gap-2" role="tablist">
        {(['trial', 'ledger'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === t ? 'bg-[#285e4b] text-white' : 'border border-gray-500 bg-white'}`}>
            {t === 'trial' ? '試算表' : '総勘定元帳'}
          </button>
        ))}
      </div>
      {base ? (
        <div className="grid gap-2 md:grid-cols-4">
          <select aria-label="年度" className={inputClass} value={base.year.start} onChange={(e) => { setYear(e.target.value); setTo(''); }}>
            {base.years.map((y) => <option key={y.start} value={y.start}>{yearLabel(y)}{y.closed ? '・締め済み' : ''}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0">いつまで</span>
            <input type="date" className={inputClass} min={base.year.start} max={base.year.end} value={to || base.range.to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select aria-label="区分" className={inputClass} value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="">法人全体</option>
            {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}だけ</option>)}
          </select>
          {tab === 'ledger' ? (
            <select aria-label="科目" className={inputClass} value={code} onChange={(e) => setCode(e.target.value)}>
              {base.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
            </select>
          ) : null}
        </div>
      ) : null}
      <ErrorBox message={error} />
      {tab === 'trial' && trial ? <TrialView tb={trial} query={query} onOpen={openLedger} /> : null}
      {tab === 'ledger' && ledger ? <LedgerView gl={ledger} query={`${query}&code=${code}`} /> : null}
    </div>
  );
}

function TrialView({ tb, query, onOpen }: { tb: Trial; query: string; onOpen: (code: string) => void }) {
  const ok = tb.check.debit === tb.check.credit && tb.totalDebit === tb.totalCredit;
  return (
    <Card actions={<a className="rounded-lg border border-gray-500 px-3 py-2 text-sm font-bold" href={`/api/export?type=trial&${query}`}>CSV</a>}>
      <p className={`mb-3 rounded-lg border p-2 text-sm ${ok ? 'border-green-600 bg-green-50' : 'border-red-500 bg-red-50'}`}>
        {ok ? '借方と貸方の合計が合っています。' : '借方と貸方の合計が合っていません。仕訳帳のファイルを手で直していないか確かめてください。'}
        　期間の収入−支出：<b>{num(tb.netIncome)}円</b>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-gray-400 text-left">
              <th className="py-1">科目</th><th className="text-right">期首残高</th><th className="text-right">借方</th><th className="text-right">貸方</th><th className="text-right">残高</th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_TYPES.map((t) => {
              const rows = tb.rows.filter((r) => r.type === t);
              if (!rows.length) return null;
              return [
                <tr key={t} className="bg-gray-100"><td colSpan={5} className="py-1 font-bold">{ACCOUNT_TYPE_LABEL[t]}</td></tr>,
                ...rows.map((r) => (
                  <tr key={r.code} className="border-b border-gray-200">
                    <td className="py-1"><button type="button" className="text-left underline" onClick={() => onOpen(r.code)}>{r.code} {r.name}</button></td>
                    <td className="text-right">{num(r.opening)}</td><td className="text-right">{num(r.debit)}</td>
                    <td className="text-right">{num(r.credit)}</td><td className="text-right font-bold">{num(r.closing)}</td>
                  </tr>
                )),
                <tr key={`${t}-sum`} className="border-b border-gray-400">
                  <td className="py-1 text-right">{ACCOUNT_TYPE_LABEL[t]}の計</td>
                  <td className="text-right">{num(rows.reduce((s, r) => s + r.opening, 0))}</td><td /><td />
                  <td className="text-right font-bold">{num(rows.reduce((s, r) => s + r.closing, 0))}</td>
                </tr>,
              ];
            })}
            <tr className="font-bold"><td className="py-1">合計</td><td /><td className="text-right">{num(tb.totalDebit)}</td><td className="text-right">{num(tb.totalCredit)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-800">
        資産・負債・純資産は期間の終わりまでの累計、収入・支出は年度の始まりからの合計です。前年度までの収入−支出は、繰越利益の期首残高に含めています。
      </p>
    </Card>
  );
}

function LedgerView({ gl, query }: { gl: Ledger; query: string }) {
  const map = accountMap(gl.accounts);
  const name = (c: string) => (c === '諸口' ? c : map.get(c)?.name ?? c);
  return (
    <Card title={`${gl.account.code} ${gl.account.name}`} actions={<a className="rounded-lg border border-gray-500 px-3 py-2 text-sm font-bold" href={`/api/export?type=ledger&${query}`}>CSV</a>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-gray-400 text-left">
              <th className="py-1">日付</th><th>No.</th><th>区分</th><th>摘要</th><th>相手科目</th><th className="text-right">借方</th><th className="text-right">貸方</th><th className="text-right">残高</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200"><td className="py-1" colSpan={7}>前期より繰越</td><td className="text-right">{num(gl.opening)}</td></tr>
            {gl.entries.map((e, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-1 whitespace-nowrap">{e.date}</td>
                <td><Link className="underline" href={`/journal/${e.voucherId}`}>{e.number}</Link></td>
                <td><SegmentBadge segment={e.segment} /></td>
                <td>{e.description}</td><td>{name(e.counter)}</td>
                <td className="text-right">{e.debit ? num(e.debit) : ''}</td><td className="text-right">{e.credit ? num(e.credit) : ''}</td>
                <td className="text-right font-bold">{num(e.balance)}</td>
              </tr>
            ))}
            <tr className="font-bold"><td className="py-1" colSpan={7}>残高</td><td className="text-right">{num(gl.closing)}</td></tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
