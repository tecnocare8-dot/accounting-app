'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/client-api';
import { Button, Card, ErrorBox, Field, inputClass } from './ui';

interface Bootstrap {
  connected: boolean;
  email: string;
  entities: { id: string; name: string }[];
  current: { id: string; name: string; folder: string | null; folderOk: boolean } | null;
}

const EntityContext = createContext<{ data: Bootstrap; reload: () => void } | null>(null);
export const useEntity = () => useContext(EntityContext)!;

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

/** ログインしていない人にはログイン画面だけを出す */
function LoginGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <Centered><p className="text-center">読み込み中…</p></Centered>;
  if (status === 'unauthenticated') {
    return (
      <Centered>
        <Card>
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-bold">会計アプリ</h1>
            <p className="text-sm leading-relaxed">法人の帳簿を付け、決算書と申告に写す数字を作ります。帳簿はご自身のGoogleドライブに保存します。</p>
            <Button className="w-full py-3" onClick={() => signIn('google')}>Googleアカウントでログイン</Button>
            <Link href="/privacy" className="block text-sm underline">プライバシーポリシー</Link>
          </div>
        </Card>
      </Centered>
    );
  }
  return <>{children}</>;
}

/** 法人を作る（最初の1つ、または追加） */
export function EntityForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [f, setF] = useState({ name: '', entityKind: '一般社団法人（非営利型）', closingMonth: '3', firstYearStart: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api('/api/entities', { method: 'POST', body: JSON.stringify({ ...f, closingMonth: Number(f.closingMonth) }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <Field label="法人の名前"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="一般社団法人テクノケア" /></Field>
      <Field label="法人の種類">
        <select className={inputClass} value={f.entityKind} onChange={(e) => setF({ ...f, entityKind: e.target.value })}>
          {['一般社団法人（非営利型）', '一般社団法人', '株式会社', '合同会社', 'その他'].map((k) => <option key={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="決算月" hint="あとで設定から変えられます（仮の月でかまいません）">
        <select className={inputClass} value={f.closingMonth} onChange={(e) => setF({ ...f, closingMonth: e.target.value })}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
        </select>
      </Field>
      <Field label="帳簿を付け始める日" hint="ふつうは今の事業年度の初日。その日の残高を「期首残高」の伝票で入れます">
        <input type="date" className={inputClass} value={f.firstYearStart} onChange={(e) => setF({ ...f, firstYearStart: e.target.value })} />
      </Field>
      <p>Googleドライブに「会計_法人の名前」のフォルダを作り、仕訳帳・勘定科目・設定を入れます。</p>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={submit}>{busy ? '作成中…' : '法人を作る'}</Button>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>やめる</Button> : null}
      </div>
    </div>
  );
}

/** ドライブの連携と法人のフォルダがそろってから、アプリを使えるようにする */
function EntityGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Bootstrap>('/api/bootstrap').then(setState).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (!state) return <Centered>{error ? <ErrorBox message={error} /> : <p className="text-center">読み込み中…</p>}</Centered>;
  if (!state.connected) {
    return (
      <Centered>
        <Card title="Googleドライブへの保存の許可">
          <div className="space-y-3 text-sm">
            <p>帳簿はご自身のGoogleドライブに保存します。ログインのときに、ドライブへの保存を許可してください（このアプリが作ったファイルだけを扱います）。</p>
            <Button className="w-full" onClick={() => signIn('google')}>もう一度ログインして許可する</Button>
            <button type="button" className="w-full text-sm underline" onClick={() => signOut()}>ログアウト</button>
          </div>
        </Card>
      </Centered>
    );
  }
  if (!state.current) {
    return (
      <Centered>
        <Card title="最初に、帳簿を付ける法人を作ります">
          <EntityForm onDone={load} />
        </Card>
      </Centered>
    );
  }
  if (!state.current.folderOk) {
    return (
      <Centered>
        <Card title="法人のフォルダ">
          <div className="space-y-3 text-sm">
            <p>「{state.current.name}」のフォルダがGoogleドライブで見つかりません。ドライブのゴミ箱に入っていれば、元に戻してからこの画面を開き直してください。</p>
            <Button className="w-full" onClick={load}>開き直す</Button>
          </div>
        </Card>
      </Centered>
    );
  }
  return <EntityContext.Provider value={{ data: state, reload: load }}>{children}</EntityContext.Provider>;
}

const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/journal', label: '仕訳' },
  { href: '/journal/new', label: '入力' },
  { href: '/ledger', label: '帳簿' },
  { href: '/import', label: '取り込み' },
  { href: '/settings', label: '設定' },
];

function Nav() {
  const path = usePathname();
  const { data } = useEntity();
  const active = (href: string) => {
    if (href === '/') return path === '/';
    if (href === '/journal') return path.startsWith('/journal') && path !== '/journal/new';
    return path.startsWith(href);
  };
  return (
    <>
      <div className="border-b border-gray-300 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 text-sm">
          <span className="font-bold">{data.current?.name}</span>
          <Link href="/settings#entity" className="underline">法人の切り替え</Link>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-300 bg-white md:static md:border-b md:border-t-0">
        <ul className="mx-auto flex max-w-6xl justify-around overflow-x-auto md:justify-start md:gap-2 md:px-4">
          {NAV.map((n) => (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                className={`block whitespace-nowrap px-2 py-3 text-xs font-bold md:px-3 md:text-sm ${active(n.href) ? 'text-[#285e4b] underline underline-offset-4' : 'text-gray-900'}`}
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

// ログインしなくても見られるページ（Google の同意画面の公開に、プライバシーポリシーのURLが要る）
const PUBLIC_PATHS = ['/privacy'];

export default function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (PUBLIC_PATHS.includes(path)) return <>{children}</>;
  return (
    <SessionProvider>
      <LoginGate>
        <EntityGate>
          <Nav />
          <main className="mx-auto max-w-6xl p-4 pb-24 md:pb-8">{children}</main>
        </EntityGate>
      </LoginGate>
    </SessionProvider>
  );
}
