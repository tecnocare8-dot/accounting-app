'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field, inputClass, Notice } from '@/components/ui';
import { draftFrom, toPayload, VoucherForm, type VoucherDraft } from '@/components/VoucherForm';
import type { Account } from '@/lib/accounts';
import type { AuditEntry } from '@/lib/audit';
import { api } from '@/lib/client-api';
import type { Voucher } from '@/lib/journal';

interface Data { voucher: Voucher; accounts: Account[]; closed: boolean; history: AuditEntry[] }

function EditVoucher() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(q.get('saved') ? '保存しました。' : '');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    api<Data>(`/api/journal/${encodeURIComponent(id)}`).then((d) => { setData(d); setVersion((n) => n + 1); }).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function save(d: VoucherDraft) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/journal/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(toPayload(d)) });
      setNotice('直しました。変更履歴に前と後の中身を残しています。');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/journal/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      router.push('/journal?deleted=1');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!data) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  const v = data.voucher;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">伝票 {v.date.slice(0, 4)} No.{v.number}</h1>
        <div className="flex gap-2">
          <Link className="rounded-lg border border-gray-500 px-3 py-2 text-sm font-bold" href={`/journal/new?copy=${encodeURIComponent(v.id)}`}>この伝票をもとに新しく入力</Link>
          <Link className="rounded-lg border border-gray-500 px-3 py-2 text-sm font-bold" href="/journal">一覧へ</Link>
        </div>
      </div>
      <Notice message={notice} />
      {v.source ? <p className="text-sm">取り込み元：{v.source}（{v.sourceId}）</p> : null}
      {data.closed ? (
        <Card title="締めた年度の伝票">
          <p className="text-sm">締めた年度の伝票は、直したり消したりできません。</p>
          <ErrorBox message={error} />
        </Card>
      ) : (
        <Card>
          <VoucherForm key={version} accounts={data.accounts} initial={draftFrom(v)} segmentTouched busy={busy} error={error} submitLabel="直して保存する" onSubmit={save}>
            {!deleting ? <Button variant="danger" onClick={() => setDeleting(true)}>この伝票を消す</Button> : null}
          </VoucherForm>
          {deleting ? (
            <div className="mt-4 space-y-2 rounded-lg border border-red-400 p-3">
              <Field label="消す理由（変更履歴に残ります）"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：二重に入れたため" /></Field>
              <div className="flex gap-2">
                <Button variant="danger" disabled={busy || !reason.trim()} onClick={remove}>消す</Button>
                <Button variant="secondary" onClick={() => setDeleting(false)}>やめる</Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}
      <Card title="この伝票の変更履歴">
        <ul className="space-y-2 text-sm">
          {data.history.map((h, i) => (
            <li key={i} className="border-b border-gray-200 pb-2">
              <b>{h.action}</b>　{new Date(h.at).toLocaleString('ja-JP')}　{h.actor}
              <div className="break-all text-xs">{h.detail}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function EditVoucherPage() {
  return <Suspense fallback={<p>読み込み中…</p>}><EditVoucher /></Suspense>;
}
