import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { SEGMENT_LABEL, type Account, type AccountType, type Segment } from '@/lib/accounts';

// 画面の部品。文字は黒・濃い色だけを使い、薄い灰色の文字は使わない
export const inputClass = 'w-full rounded-lg border border-gray-500 bg-white px-3 py-2 text-base text-gray-900';

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm">
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-base font-bold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** wideHidden：パソコンの広い画面で表の見出しがあるときは、欄ごとの名前を隠す（読み上げには残す） */
export function Field({ label, hint, wideHidden, children }: { label: string; hint?: string; wideHidden?: boolean; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className={`mb-1 block font-bold text-gray-900 ${wideHidden ? 'lg:sr-only' : ''}`}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-800">{hint}</span> : null}
    </label>
  );
}

const VARIANT = {
  primary: 'bg-[#285e4b] text-white hover:bg-[#1d4637]',
  secondary: 'border border-gray-500 bg-white text-gray-900 hover:bg-gray-100',
  danger: 'border border-red-500 bg-white text-red-800 hover:bg-red-50',
} as const;

export function Button({ variant = 'primary', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT }) {
  return <button type={type} {...props} className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50 ${VARIANT[variant]} ${className}`} />;
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="whitespace-pre-line rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-900">{message}</p>;
}

export function Notice({ message }: { message: string }) {
  if (!message) return null;
  return <p role="status" className="rounded-lg border border-green-500 bg-green-50 p-3 text-sm text-green-900">{message}</p>;
}

const SEGMENT_COLOR: Record<Segment, string> = {
  profit: 'border-amber-700 bg-amber-50 text-amber-950',
  nonprofit: 'border-green-700 bg-green-50 text-green-900',
  common: 'border-gray-600 bg-gray-100 text-gray-900',
};

export function SegmentBadge({ segment }: { segment: Segment }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${SEGMENT_COLOR[segment]}`}>{SEGMENT_LABEL[segment]}</span>;
}

const GROUPS: { type: AccountType; label: string }[] = [
  { type: 'asset', label: '資産' }, { type: 'liability', label: '負債' }, { type: 'equity', label: '純資産' },
  { type: 'revenue', label: '収入' }, { type: 'expense', label: '支出' },
];

/** 科目を選ぶ。使わない科目は、いま選ばれているときだけ出す */
export function AccountSelect({ accounts, value, onChange, empty = '（科目を選ぶ）', className = inputClass, label }: {
  accounts: Account[]; value: string; onChange: (code: string) => void; empty?: string; className?: string; label?: string;
}) {
  return (
    <select aria-label={label} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {GROUPS.map((g) => (
        <optgroup key={g.type} label={g.label}>
          {accounts.filter((a) => a.type === g.type && (a.active || a.code === value)).map((a) => (
            <option key={a.code} value={a.code}>{a.code} {a.name}{a.needsCheck ? '（要確認）' : ''}</option>
          ))}
        </optgroup>
      ))}
      {value && !accounts.some((a) => a.code === value) ? <option value={value}>{value}（不明な科目）</option> : null}
    </select>
  );
}
