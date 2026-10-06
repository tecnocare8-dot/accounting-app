'use client';

import { useMemo, useState } from 'react';
import { AccountSelect, Button, ErrorBox, Field, inputClass } from '@/components/ui';
import { SEGMENT_LABEL, SEGMENTS, type Account, type Segment } from '@/lib/accounts';
import { num } from '@/lib/client-api';
import { defaultSegment, type JournalLine, type Voucher } from '@/lib/journal';

export interface VoucherDraft {
  date: string;
  segment: Segment;
  description: string;
  counterparty: string;
  lines: { debitAccount: string; debitAmount: string; creditAccount: string; creditAmount: string; memo: string }[];
}

const emptyLine = () => ({ debitAccount: '', debitAmount: '', creditAccount: '', creditAmount: '', memo: '' });

export function draftFrom(v: Pick<Voucher, 'date' | 'segment' | 'description' | 'counterparty' | 'lines'>): VoucherDraft {
  return {
    ...v,
    lines: v.lines.map((l) => ({
      debitAccount: l.debitAccount, debitAmount: l.debitAccount ? String(l.debitAmount) : '',
      creditAccount: l.creditAccount, creditAmount: l.creditAccount ? String(l.creditAmount) : '', memo: l.memo,
    })),
  };
}

export const newDraft = (date: string): VoucherDraft => ({ date, segment: 'nonprofit', description: '', counterparty: '', lines: [emptyLine(), emptyLine()] });

const digits = (s: string) => s.replace(/[^0-9]/g, '');
const amount = (s: string) => Number(digits(s)) || 0;

/** 送る形に直す（金額は数に、空の行は除く） */
export function toPayload(d: VoucherDraft) {
  const lines: JournalLine[] = d.lines
    .map((l) => ({ debitAccount: l.debitAccount, debitAmount: l.debitAccount ? amount(l.debitAmount) : 0, creditAccount: l.creditAccount, creditAmount: l.creditAccount ? amount(l.creditAmount) : 0, memo: l.memo.trim() }))
    .filter((l) => l.debitAccount || l.creditAccount);
  return { ...d, lines };
}

/** 伝票の入力欄。区分は、利用者が自分で選ぶまでは科目の初期値に合わせて変わる */
export function VoucherForm({ accounts, initial, segmentTouched: touchedInit = false, busy, error, submitLabel, onSubmit, children }: {
  accounts: Account[];
  initial: VoucherDraft;
  segmentTouched?: boolean;
  busy: boolean;
  error: string;
  submitLabel: string;
  onSubmit: (d: VoucherDraft) => void;
  children?: React.ReactNode;
}) {
  const [d, setD] = useState(initial);
  const [touched, setTouched] = useState(touchedInit);
  const payload = useMemo(() => toPayload(d), [d]);
  const debit = payload.lines.reduce((t, l) => t + l.debitAmount, 0);
  const credit = payload.lines.reduce((t, l) => t + l.creditAmount, 0);
  const needsCheck = accounts.filter((a) => a.needsCheck && payload.lines.some((l) => l.debitAccount === a.code || l.creditAccount === a.code));

  const setLines = (lines: VoucherDraft['lines']) => {
    const next = { ...d, lines };
    if (!touched) next.segment = defaultSegment(toPayload(next).lines, accounts);
    setD(next);
  };
  const setLine = (i: number, patch: Partial<VoucherDraft['lines'][number]>) => setLines(d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** 科目があって金額が空いている欄に、差額を入れる（足りない側の最初の空欄） */
  const diffSide = debit > credit ? 'credit' : 'debit';
  const diffTarget = debit === credit ? -1 : d.lines.findIndex((l) => (diffSide === 'debit' ? l.debitAccount && !l.debitAmount : l.creditAccount && !l.creditAmount));
  const fillDiff = () => {
    const amount = String(Math.abs(debit - credit));
    setLine(diffTarget, diffSide === 'debit' ? { debitAmount: amount } : { creditAmount: amount });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="日付"><input type="date" className={inputClass} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="区分" hint={touched ? '' : '科目に合わせて自動で選びます'}>
          <select className={inputClass} value={d.segment} onChange={(e) => { setTouched(true); setD({ ...d, segment: e.target.value as Segment }); }}>
            {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="摘要"><input className={inputClass} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="例：9月分 セミナー講師謝金" /></Field>
        <Field label="取引先"><input className={inputClass} value={d.counterparty} onChange={(e) => setD({ ...d, counterparty: e.target.value })} /></Field>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[1fr_8rem_1fr_8rem_1fr_2.5rem] gap-2 text-xs font-bold lg:grid">
          <span>借方の科目</span><span>借方の金額</span><span>貸方の科目</span><span>貸方の金額</span><span>行の摘要</span><span />
        </div>
        {d.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-300 p-2 lg:grid-cols-[1fr_8rem_1fr_8rem_1fr_2.5rem] lg:border-0 lg:p-0">
            <AccountSelect label={`${i + 1}行目の借方の科目`} accounts={accounts} value={l.debitAccount} empty="（借方なし）" onChange={(c) => setLine(i, { debitAccount: c })} />
            <input aria-label={`${i + 1}行目の借方の金額`} inputMode="numeric" className={`${inputClass} text-right`} value={l.debitAmount} disabled={!l.debitAccount}
              onChange={(e) => setLine(i, { debitAmount: digits(e.target.value) })} />
            <AccountSelect label={`${i + 1}行目の貸方の科目`} accounts={accounts} value={l.creditAccount} empty="（貸方なし）" onChange={(c) => setLine(i, { creditAccount: c })} />
            <input aria-label={`${i + 1}行目の貸方の金額`} inputMode="numeric" className={`${inputClass} text-right`} value={l.creditAmount} disabled={!l.creditAccount}
              onChange={(e) => setLine(i, { creditAmount: digits(e.target.value) })} />
            <input aria-label={`${i + 1}行目の摘要`} className={`${inputClass} col-span-2 lg:col-span-1`} value={l.memo} placeholder="行の摘要（任意）" onChange={(e) => setLine(i, { memo: e.target.value })} />
            <button type="button" aria-label={`${i + 1}行目を消す`} className="col-span-2 rounded-lg border border-gray-500 text-sm lg:col-span-1" disabled={d.lines.length <= 1}
              onClick={() => setLines(d.lines.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setLines([...d.lines, emptyLine()])}>行を足す</Button>
      </div>

      <div className={`rounded-lg border p-3 text-sm ${debit === credit && debit > 0 ? 'border-green-600 bg-green-50' : 'border-amber-600 bg-amber-50'}`}>
        借方の合計 <b>{num(debit)}</b> 円 ／ 貸方の合計 <b>{num(credit)}</b> 円
        {debit !== credit ? <span className="ml-2 font-bold">差 {num(Math.abs(debit - credit))} 円</span> : null}
        {diffTarget >= 0 ? (
          <button type="button" className="ml-2 rounded border border-gray-600 bg-white px-2 py-0.5 text-xs font-bold" onClick={fillDiff}>
            差額を{diffTarget + 1}行目の{diffSide === 'debit' ? '借方' : '貸方'}に入れる
          </button>
        ) : null}
      </div>
      {needsCheck.length ? (
        <p className="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950">
          「{needsCheck.map((a) => a.name).join('」「')}」は区分が要確認の科目です。税務署に確かめた区分を選んでください。
        </p>
      ) : null}
      <ErrorBox message={error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => onSubmit(d)}>{busy ? '保存中…' : submitLabel}</Button>
        {children}
      </div>
    </div>
  );
}
