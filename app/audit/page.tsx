'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBox, inputClass } from '@/components/ui';
import type { AuditEntry } from '@/lib/audit';
import { api } from '@/lib/client-api';

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ entries: AuditEntry[] }>('/api/audit').then((r) => setEntries(r.entries)).catch((e: Error) => setError(e.message));
  }, []);
  if (!entries) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  const shown = entries.filter((e) => !q.trim() || [e.action, e.target, e.detail, e.actor].some((s) => s.includes(q.trim())));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">変更履歴</h1>
      <p className="text-sm">伝票の追加・修正・削除、取り込み、科目・設定の変更を、追記だけで残しています（新しい順に500件。すべては設定のドライブのファイルから）。</p>
      <input aria-label="検索" className={inputClass} placeholder="操作・対象・内容で探す" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y divide-gray-200 rounded-xl border border-gray-300 bg-white text-sm">
        {shown.map((e, i) => (
          <li key={i} className="p-3">
            <div className="flex flex-wrap gap-2">
              <b>{e.action}</b><span>{new Date(e.at).toLocaleString('ja-JP')}</span><span>{e.actor}</span>
              {e.targetId.startsWith('v-') && e.action !== '削除' ? <Link className="underline" href={`/journal/${e.targetId}`}>{e.target}</Link> : <span>{e.target}</span>}
            </div>
            <div className="mt-1 break-all text-xs">{e.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
