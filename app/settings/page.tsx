'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { EntityForm, useEntity } from '@/components/AppShell';
import { AccountSelect, Button, Card, ErrorBox, Field, inputClass, Notice } from '@/components/ui';
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, SEGMENT_LABEL, SEGMENTS, sortAccounts, type Account, type AccountType, type Segment } from '@/lib/accounts';
import { api } from '@/lib/client-api';
import { yearLabel, type FiscalYear } from '@/lib/fiscal';
import type { BankRule, Settings } from '@/lib/settings';
import { STRIPE_TYPE_LABEL } from '@/lib/stripe-import';

interface Data { settings: Settings; accounts: Account[]; years: FiscalYear[]; links: Record<string, string>; usedAccounts: string[] }

const FILE_LABEL: Record<string, string> = { journal: '仕訳帳.csv', accounts: '勘定科目.csv', settings: '設定.json', audit: '変更履歴.csv', imports: '取り込み記録.csv' };

export default function SettingsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Data>('/api/settings').then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  if (!data) return error ? <ErrorBox message={error} /> : <p>読み込み中…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">設定</h1>
      <nav aria-label="設定の目次" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {[['#stripe', 'Stripe との連携'], ['#rules', '取り込みの対応表'], ['#accounts', '勘定科目'], ['#files', 'ドライブのファイル'], ['#entity', '法人の切り替え']].map(([href, label]) => (
          <a key={href} href={href} className="underline">{label}</a>
        ))}
      </nav>
      <EntitySection data={data} onSaved={load} />
      <StripeSection />
      <RulesSection data={data} onSaved={load} />
      <AccountsSection data={data} onSaved={load} />
      <Card title="Googleドライブのファイル">
        <ul id="files" className="space-y-1 text-sm">
          {Object.entries(data.links).map(([k, url]) => <li key={k}><a className="underline" href={url} target="_blank" rel="noreferrer">{FILE_LABEL[k] ?? k}</a></li>)}
        </ul>
        <p className="mt-2 text-sm"><Link className="underline" href="/audit">変更履歴を見る</Link></p>
      </Card>
      <SwitchSection />
    </div>
  );
}

function useSave(onSaved: () => void) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, done = '保存しました。') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, notice, busy, run };
}

function EntitySection({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const { reload } = useEntity();
  const s = data.settings;
  const [f, setF] = useState({ entityName: s.entityName, entityKind: s.entityKind, closingMonth: String(s.closingMonth), firstYearStart: s.firstYearStart });
  const { error, notice, busy, run } = useSave(() => { onSaved(); reload(); });
  const changedMonth = Number(f.closingMonth) !== s.closingMonth;
  return (
    <Card title="法人と事業年度">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="法人の名前"><input className={inputClass} value={f.entityName} onChange={(e) => setF({ ...f, entityName: e.target.value })} /></Field>
        <Field label="法人の種類"><input className={inputClass} value={f.entityKind} onChange={(e) => setF({ ...f, entityKind: e.target.value })} /></Field>
        <Field label="決算月">
          <select className={inputClass} value={f.closingMonth} onChange={(e) => setF({ ...f, closingMonth: e.target.value })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
          </select>
        </Field>
        <Field label="帳簿を付け始めた日" hint={s.closedYears.length ? '締めた年度があるので変えられません' : ''}>
          <input type="date" className={inputClass} value={f.firstYearStart} disabled={s.closedYears.length > 0} onChange={(e) => setF({ ...f, firstYearStart: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 text-sm">
        <p className="font-bold">事業年度</p>
        <ul className="list-disc pl-5">
          {data.years.map((y) => <li key={y.start}>{yearLabel(y)}{y.closed ? '・締め済み' : ''}{y.short ? '・1年未満' : ''}</li>)}
        </ul>
        {changedMonth ? (
          <p className="mt-2 rounded-lg border border-amber-600 bg-amber-50 p-2">
            決算月を変えると、締めていない年度の範囲が変わります。変えた直後の年度は1年未満になることがあります。保存したあと、上の一覧で範囲を確かめてください（決算月の変更は、税務署・県・市への届け出も必要です）。
          </p>
        ) : null}
      </div>
      <ErrorBox message={error} />
      <Notice message={notice} />
      <Button className="mt-3" disabled={busy} onClick={() => run(() => api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...f, closingMonth: Number(f.closingMonth) }) }))}>保存する</Button>
    </Card>
  );
}

function AccountRow({ a, used, onSaved }: { a: Account; used: boolean; onSaved: () => void }) {
  const [f, setF] = useState(a);
  const { error, busy, run } = useSave(onSaved);
  const dirty = JSON.stringify(f) !== JSON.stringify(a);
  return (
    <tr className="border-b border-gray-200 align-top">
      <td className="py-1">{a.code}</td>
      <td><input aria-label={`${a.code}の名前`} className="w-full rounded border border-gray-500 px-1 py-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></td>
      <td>
        <select aria-label={`${a.code}の種類`} className="rounded border border-gray-500 px-1 py-1" value={f.type} disabled={used} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
        </select>
      </td>
      <td>
        <select aria-label={`${a.code}の区分`} className="rounded border border-gray-500 px-1 py-1" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value as Segment })}>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
        </select>
      </td>
      <td className="text-center"><input type="checkbox" aria-label={`${a.code}を課税売上に数える`} checked={f.taxableSales} onChange={(e) => setF({ ...f, taxableSales: e.target.checked })} /></td>
      <td className="text-center"><input type="checkbox" aria-label={`${a.code}は要確認`} checked={f.needsCheck} onChange={(e) => setF({ ...f, needsCheck: e.target.checked })} /></td>
      <td className="text-center"><input type="checkbox" aria-label={`${a.code}を使う`} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></td>
      <td>
        {dirty ? <Button className="px-2 py-1" disabled={busy} onClick={() => run(() => api('/api/accounts', { method: 'POST', body: JSON.stringify(f) }))}>保存</Button> : null}
        {error ? <span className="block text-xs text-red-800">{error}</span> : null}
      </td>
    </tr>
  );
}

function AccountsSection({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', type: 'expense' as AccountType, segment: 'common' as Segment, taxableSales: false, needsCheck: false });
  const { error, notice, busy, run } = useSave(onSaved);
  const used = new Set(data.usedAccounts);
  return (
    <Card title="勘定科目">
      <p id="accounts" className="mb-2 scroll-mt-4 text-sm leading-relaxed">
        区分は、その科目を使う伝票の区分の初期値です。税務署に確かめた結果に合わせて直してください。「課税売上」は消費税の課税売上（1,000万円の判定）に数える科目で、収益事業かどうかに関係なく数えます。
        使わない科目は「使う」の印を外すと、選ぶ欄に出なくなります（過去の仕訳はそのまま）。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-gray-400 text-left">
              <th className="py-1">コード</th><th>科目</th><th>種類</th><th>区分の初期値</th><th className="text-center">課税売上</th><th className="text-center">要確認</th><th className="text-center">使う</th><th />
            </tr>
          </thead>
          <tbody>
            {sortAccounts(data.accounts).map((a) => <AccountRow key={`${a.code}-${JSON.stringify(a)}`} a={a} used={used.has(a.code)} onSaved={onSaved} />)}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-2 rounded-lg border border-gray-300 p-3 md:grid-cols-5">
        <Field label="新しい科目"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="種類">
          <select className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="区分の初期値">
          <select className={inputClass} value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value as Segment })}>
            {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.taxableSales} onChange={(e) => setF({ ...f, taxableSales: e.target.checked })} />課税売上に数える</label>
        <Button disabled={busy || !f.name.trim()} onClick={() => run(async () => { await api('/api/accounts', { method: 'POST', body: JSON.stringify(f) }); setF({ ...f, name: '' }); }, '科目を足しました。')}>科目を足す</Button>
      </div>
      <ErrorBox message={error} />
      <Notice message={notice} />
    </Card>
  );
}

function MapEditor({ title, hint, value, accounts, onChange, keyLabel, labelOf = (k) => k }: {
  title: string; hint: string; value: Record<string, string>; accounts: Account[]; onChange: (v: Record<string, string>) => void; keyLabel: string;
  labelOf?: (key: string) => string;
}) {
  const [key, setKey] = useState('');
  return (
    <div className="space-y-2">
      <p className="font-bold">{title}</p>
      <p className="text-xs">{hint}</p>
      <ul className="space-y-1">
        {Object.entries(value).map(([k, code]) => (
          <li key={k} className="flex items-center gap-2">
            <span className="w-32 shrink-0">{labelOf(k)}</span>
            <AccountSelect label={`${k}の科目`} className="rounded border border-gray-500 px-1 py-1 text-sm" accounts={accounts} value={code} onChange={(c) => onChange({ ...value, [k]: c })} />
            <button type="button" className="text-sm underline" onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}>消す</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input aria-label={keyLabel} className="rounded border border-gray-500 px-2 py-1 text-sm" placeholder={keyLabel} value={key} onChange={(e) => setKey(e.target.value)} />
        <Button variant="secondary" className="px-2 py-1" disabled={!key.trim() || key.trim() in value} onClick={() => { onChange({ ...value, [key.trim()]: '' }); setKey(''); }}>足す</Button>
      </div>
    </div>
  );
}

function RulesSection({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({
    receiptCategoryMap: s.receiptCategoryMap, paymentMethodMap: s.paymentMethodMap, payoutAccount: s.payoutAccount,
    documentIncomeAccount: s.documentIncomeAccount, bankRules: s.bankRules,
    stripeTypeMap: s.stripeTypeMap, stripePayoutAccount: s.stripePayoutAccount,
  });
  const [rule, setRule] = useState<BankRule>({ keyword: '', accountCode: '' });
  const { error, notice, busy, run } = useSave(onSaved);
  const empty = [...Object.entries(f.receiptCategoryMap), ...Object.entries(f.paymentMethodMap), ...Object.entries(f.stripeTypeMap)].filter(([, c]) => !c).map(([k]) => STRIPE_TYPE_LABEL[k] ?? k);
  return (
    <Card title="取り込みの対応表">
      <div id="rules" className="grid gap-6 text-sm md:grid-cols-2">
        <MapEditor title="Stripe（サイトの決済の種類）→ 収入の科目" hint="サイトの決済に付いている種類ごとに、売上を入れる科目を決めます。" keyLabel="種類（英字）"
          value={f.stripeTypeMap} accounts={data.accounts} labelOf={(k) => STRIPE_TYPE_LABEL[k] ? `${STRIPE_TYPE_LABEL[k]}` : k} onChange={(v) => setF({ ...f, stripeTypeMap: v })} />
        <div className="space-y-2">
          <p className="font-bold">Stripe からの振込先</p>
          <Field label="振込が入る預金の科目"><AccountSelect accounts={data.accounts.filter((a) => a.type === 'asset')} value={f.stripePayoutAccount} onChange={(c) => setF({ ...f, stripePayoutAccount: c })} /></Field>
          <p className="text-xs">銀行の明細を取り込むときは、摘要に Stripe の振込と分かる言葉（例：ｽﾄﾗｲﾌﾟ）の規則を「取り込まない」にしておくと、二重になりません。</p>
        </div>
        <MapEditor title="領収書アプリの分類 → 科目" hint="領収書アプリの「分類」を、この科目の借方に入れます。" keyLabel="分類の名前"
          value={f.receiptCategoryMap} accounts={data.accounts} onChange={(v) => setF({ ...f, receiptCategoryMap: v })} />
        <MapEditor title="領収書アプリの支払い方法 → 貸方の科目" hint="ここにない支払い方法は普通預金になります。代表者が立て替えたときは未払金などにします。" keyLabel="支払い方法の名前"
          value={f.paymentMethodMap} accounts={data.accounts} onChange={(v) => setF({ ...f, paymentMethodMap: v })} />
        <div className="space-y-2">
          <p className="font-bold">書類アプリ</p>
          <Field label="業務委託の支払い → 借方の科目"><AccountSelect accounts={data.accounts} value={f.payoutAccount} onChange={(c) => setF({ ...f, payoutAccount: c })} /></Field>
          <Field label="入金（請求書の入金・請求書のない入金）→ 貸方の科目"><AccountSelect accounts={data.accounts} value={f.documentIncomeAccount} onChange={(c) => setF({ ...f, documentIncomeAccount: c })} /></Field>
        </div>
        <div className="space-y-2">
          <p className="font-bold">銀行の摘要の規則</p>
          <p className="text-xs">摘要にその言葉が入っていたら、その科目を相手にします（上から順に見ます）。科目を「取り込まない」にすると、その明細は取り込みません（ほかの取り込みで入る Stripe からの振込など）。</p>
          <ul className="space-y-1">
            {f.bankRules.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-32 shrink-0 break-all">「{r.keyword}」</span>
                <AccountSelect label={`規則「${r.keyword}」の科目`} className="rounded border border-gray-500 px-1 py-1 text-sm" accounts={data.accounts} value={r.accountCode} empty="取り込まない"
                  onChange={(c) => setF({ ...f, bankRules: f.bankRules.map((x, j) => (j === i ? { ...x, accountCode: c } : x)) })} />
                <button type="button" className="text-sm underline" onClick={() => setF({ ...f, bankRules: f.bankRules.filter((_, j) => j !== i) })}>消す</button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input aria-label="摘要の言葉" className="rounded border border-gray-500 px-2 py-1 text-sm" placeholder="摘要の言葉" value={rule.keyword} onChange={(e) => setRule({ ...rule, keyword: e.target.value })} />
            <AccountSelect label="規則の科目" className="rounded border border-gray-500 px-1 py-1 text-sm" accounts={data.accounts} value={rule.accountCode} empty="取り込まない" onChange={(c) => setRule({ ...rule, accountCode: c })} />
            <Button variant="secondary" className="px-2 py-1" disabled={!rule.keyword.trim()} onClick={() => { setF({ ...f, bankRules: [...f.bankRules, { ...rule, keyword: rule.keyword.trim() }] }); setRule({ keyword: '', accountCode: '' }); }}>足す</Button>
          </div>
        </div>
      </div>
      {empty.length ? <p className="mt-2 text-sm text-red-800">科目が空のもの（{empty.join('、')}）があります。選ぶか消してください。</p> : null}
      <ErrorBox message={error} />
      <Notice message={notice} />
      <Button className="mt-3" disabled={busy || empty.length > 0} onClick={() => run(() => api('/api/settings', { method: 'PUT', body: JSON.stringify(f) }))}>対応表を保存する</Button>
    </Card>
  );
}

function SwitchSection() {
  const { data, reload } = useEntity();
  const router = useRouter();
  /** 法人が変わったら、ホームから開き直す */
  const toHome = () => { reload(); router.push('/'); };
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  async function select(id: string) {
    try {
      await api('/api/entities/select', { method: 'POST', body: JSON.stringify({ id }) });
      toHome();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Card title="法人の切り替え・追加">
      <div id="entity" className="space-y-3 text-sm">
        <ul className="space-y-1">
          {data.entities.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className={e.id === data.current?.id ? 'font-bold' : ''}>{e.name}</span>
              {e.id === data.current?.id ? <span>（いま使っている法人）</span> : <Button variant="secondary" className="px-2 py-1" onClick={() => select(e.id)}>この法人に切り替える</Button>}
            </li>
          ))}
        </ul>
        <ErrorBox message={error} />
        {adding ? <EntityForm onDone={() => { setAdding(false); toHome(); }} onCancel={() => setAdding(false)} /> : <Button variant="secondary" onClick={() => setAdding(true)}>法人を足す（株式会社など）</Button>}
        <p>ログイン中：{data.email}　<button type="button" className="underline" onClick={() => signOut()}>ログアウト</button></p>
      </div>
    </Card>
  );
}

function StripeSection() {
  const [state, setState] = useState<{ connected: boolean; hint: string } | null>(null);
  const [key, setKey] = useState('');
  const { error, notice, busy, run } = useSave(() => undefined);
  const load = useCallback(() => {
    api<{ connected: boolean; hint: string }>('/api/stripe').then(setState).catch(() => setState({ connected: false, hint: '' }));
  }, []);
  useEffect(load, [load]);
  return (
    <Card title="Stripe との連携">
      <div id="stripe" className="scroll-mt-4 space-y-3 text-sm">
        {state?.connected ? (
          <p>つながっています（キー：{state.hint}）。取り込みの画面で「Stripe」を選び、期間を選んで読み込みます。</p>
        ) : (
          <div className="space-y-2 leading-relaxed">
            <p>サイトの決済を取り込むために、Stripe の<b>読み取り専用の制限付きキー</b>を入れてください。作り方：</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Stripe のダッシュボード →「開発者」→「API キー」→「制限付きのキーを作成」</li>
              <li>名前を「会計アプリ（読み取り）」にし、次の権限を<b>読み取り</b>にする（ほかは「なし」のまま）：Balance、Charges、Checkout Sessions、Invoices、Payouts</li>
              <li>作ったキー（rk_live_ で始まる）をコピーして、下に貼る</li>
            </ol>
            <p>キーは暗号化して保存し、画面には末尾しか出しません。書き込みもできる秘密キー（sk_ で始まる）は受け付けません。</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input type="password" autoComplete="off" aria-label="Stripe の制限付きキー" className="min-w-0 flex-1 rounded border border-gray-500 px-2 py-1" placeholder="rk_live_..." value={key} onChange={(e) => setKey(e.target.value)} />
          <Button disabled={busy || !key.trim()} onClick={() => run(async () => { await api('/api/stripe', { method: 'PUT', body: JSON.stringify({ key }) }); setKey(''); load(); }, 'Stripe とつながりました。')}>
            {state?.connected ? 'キーを入れ替える' : 'つなぐ'}
          </Button>
          {state?.connected ? (
            <Button variant="danger" disabled={busy} onClick={() => run(async () => { await api('/api/stripe', { method: 'DELETE' }); load(); }, 'Stripe との連携を外しました。')}>連携を外す</Button>
          ) : null}
        </div>
        <ErrorBox message={error} />
        <Notice message={notice} />
      </div>
    </Card>
  );
}
