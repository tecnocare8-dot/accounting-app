'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, ErrorBox } from '@/components/ui';
import { SEGMENT_LABEL, SEGMENTS, type Segment } from '@/lib/accounts';
import { api, yen } from '@/lib/client-api';
import { yearLabel, type FiscalYear } from '@/lib/fiscal';

interface Home {
  entityName: string;
  year: FiscalYear;
  count: number;
  cash: { code: string; name: string; balance: number }[];
  bySegment: Record<Segment, { revenue: number; expense: number }>;
  needsCheck: string[];
  started: boolean;
}

export default function HomePage() {
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Home>('/api/home').then(setData).catch((e: Error) => setError(e.message));
  }, []);
  if (!data) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  const total = SEGMENTS.reduce((t, s) => t + data.bySegment[s].revenue - data.bySegment[s].expense, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{data.entityName}</h1>
      <p className="text-sm">{yearLabel(data.year)}{data.year.short ? '（1年未満の年度）' : ''}・伝票 {data.count}件</p>

      {!data.started ? (
        <Card title="はじめに">
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            <li><Link className="underline" href="/settings">設定</Link>で、決算月・帳簿を付け始めた日・勘定科目の区分（収益事業かどうか）を確かめます。</li>
            <li><Link className="underline" href="/journal/new?opening=1">期首残高</Link>を入れます（付け始めた日の預金の残高など。相手は繰越利益）。</li>
            <li>日々の取引を<Link className="underline" href="/journal/new">入力</Link>するか、領収書アプリ・書類アプリ・銀行の CSV を<Link className="underline" href="/import">取り込み</Link>ます。</li>
          </ol>
        </Card>
      ) : null}

      {data.needsCheck.length ? (
        <p role="alert" className="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950">
          「{data.needsCheck.join('」「')}」は、収益事業にあたるかを税務署に確かめるまで「要確認」です。確かめたら、設定の勘定科目で区分を直し、要確認の印を外してください。
        </p>
      ) : null}

      <Card title="お金の残高">
        <ul className="space-y-1 text-sm">
          {data.cash.length ? data.cash.map((c) => (
            <li key={c.code} className="flex justify-between"><span>{c.name}</span><span className="font-bold">{yen(c.balance)}</span></li>
          )) : <li>まだありません</li>}
        </ul>
      </Card>

      <Card title="今年度の収入と支出（区分ごと）">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left"><th className="py-1">区分</th><th className="text-right">収入</th><th className="text-right">支出</th><th className="text-right">差額</th></tr>
          </thead>
          <tbody>
            {SEGMENTS.map((s) => {
              const r = data.bySegment[s];
              return (
                <tr key={s} className="border-b border-gray-200">
                  <td className="py-1">{SEGMENT_LABEL[s]}</td><td className="text-right">{yen(r.revenue)}</td><td className="text-right">{yen(r.expense)}</td>
                  <td className="text-right">{yen(r.revenue - r.expense)}</td>
                </tr>
              );
            })}
            <tr className="font-bold"><td className="py-1">合計</td><td /><td /><td className="text-right">{yen(total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-800">「共通」は、期末に割合で収益事業と非収益事業に分けます（段階3で作ります）。</p>
      </Card>
    </div>
  );
}
