'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { draftFrom, newDraft, toPayload, VoucherForm, type VoucherDraft } from '@/components/VoucherForm';
import type { Account } from '@/lib/accounts';
import { api } from '@/lib/client-api';
import type { Voucher } from '@/lib/journal';

function NewVoucher() {
  const router = useRouter();
  const q = useSearchParams();
  const [init, setInit] = useState<{ accounts: Account[]; draft: VoucherDraft; touched: boolean } | null>(null);
  // 二度押し・通信の再送でも1件になるよう、画面を開いたときに伝票のIDを決めておく
  const [id] = useState(() => `v-${crypto.randomUUID()}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await api<{ accounts: Account[]; today: string; year: { start: string } }>('/api/journal');
      const copy = q.get('copy');
      if (copy) {
        const { voucher } = await api<{ voucher: Voucher }>(`/api/journal/${encodeURIComponent(copy)}`);
        return setInit({ accounts: list.accounts, draft: { ...draftFrom(voucher), date: list.today }, touched: true });
      }
      if (q.get('opening')) {
        return setInit({
          accounts: list.accounts, touched: true,
          draft: {
            ...newDraft(list.year.start), segment: 'nonprofit', description: '期首残高',
            lines: [
              { debitAccount: '102', debitAmount: '', creditAccount: '', creditAmount: '', memo: '' },
              { debitAccount: '', debitAmount: '', creditAccount: '301', creditAmount: '', memo: '' },
            ],
          },
        });
      }
      setInit({ accounts: list.accounts, draft: newDraft(list.today), touched: false });
    })().catch((e: Error) => setError(e.message));
  }, [q]);

  async function submit(d: VoucherDraft) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ voucher: Voucher }>('/api/journal', { method: 'POST', body: JSON.stringify({ id, ...toPayload(d) }) });
      router.push(`/journal/${r.voucher.id}?saved=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!init) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{q.get('opening') ? '期首残高を入れる' : '仕訳を入力する'}</h1>
      {q.get('opening') ? (
        <p className="text-sm leading-relaxed">
          帳簿を付け始めた日の、預金・現金・未払金などの残高を入れます。借方に資産（普通預金など）、貸方に負債（未払金など）と、差額を「繰越利益」に入れてください。
        </p>
      ) : null}
      <VoucherForm accounts={init.accounts} initial={init.draft} segmentTouched={init.touched} busy={busy} error={error} submitLabel="保存する" onSubmit={submit} />
    </div>
  );
}

export default function NewVoucherPage() {
  return <Suspense fallback={<p>読み込み中…</p>}><NewVoucher /></Suspense>;
}
