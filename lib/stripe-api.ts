import type { StripeItem } from './stripe-import';

// Stripe の API を、読み取り専用の制限付きキーで読む。
// 必要な権限（すべて「読み取り」）：Balance、Charges、Checkout Sessions、Invoices、Payouts

export class StripeKeyError extends Error {}

// 手元の確認だけ、Stripe の代わりのサーバーに向けられる（Vercel では使わない）
const API = process.env.STRIPE_API_BASE && !process.env.VERCEL ? process.env.STRIPE_API_BASE : 'https://api.stripe.com/v1';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function stripeClient(key: string, fetcher: Fetcher = fetch) {
  async function get<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T> {
    const u = new URL(API + path);
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, x);
    const res = await fetcher(u.toString(), { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new StripeKeyError('Stripe のキーが正しくないか、取り消されています。設定で入れ直してください。');
    if (res.status === 403) {
      throw new StripeKeyError(`Stripe のキーに読み取りの権限が足りません（${body?.error?.message ?? path}）。制限付きキーの権限を確かめてください。`);
    }
    if (!res.ok) throw new Error(`Stripe ${path}: ${res.status} ${body?.error?.message ?? ''}`);
    return body as T;
  }

  interface Session { metadata?: Record<string, string>; line_items?: { data?: { description?: string }[] } }
  const sessionCache = new Map<string, Session | null>();
  /** 決済（payment_intent）や会費（subscription）から、サイトが作った checkout を探す */
  async function sessionFor(by: 'payment_intent' | 'subscription', id: string): Promise<Session | null> {
    const k = `${by}:${id}`;
    if (!sessionCache.has(k)) {
      const r = await get<{ data: Session[] }>('/checkout/sessions', { [by]: id, limit: '1', 'expand[]': 'data.line_items' });
      sessionCache.set(k, r.data[0] ?? null);
    }
    return sessionCache.get(k) ?? null;
  }

  interface Charge { object: 'charge'; payment_intent?: string | null; invoice?: string | { id: string; subscription?: string | null } | null; description?: string | null }
  interface Refund { object: 'refund'; charge?: string | Charge | null }
  interface Txn {
    id: string; amount: number; fee: number; net: number; created: number; currency: string;
    reporting_category: string; description: string | null; source: Charge | Refund | { object: string } | string | null;
  }

  async function chargeInfo(ch: Charge | null): Promise<Pick<StripeItem, 'siteType' | 'productName' | 'memberId'>> {
    const empty = { siteType: '', productName: '', memberId: '' };
    if (!ch) return empty;
    let s: Session | null = null;
    if (ch.payment_intent) s = await sessionFor('payment_intent', ch.payment_intent);
    if (!s && ch.invoice) {
      const inv = typeof ch.invoice === 'string' ? await get<{ subscription?: string | null }>(`/invoices/${ch.invoice}`) : ch.invoice;
      if (inv.subscription) s = await sessionFor('subscription', inv.subscription);
    }
    if (!s) return { ...empty, productName: ch.description ?? '' };
    return {
      siteType: s.metadata?.type ?? '',
      productName: s.line_items?.data?.[0]?.description ?? '',
      memberId: s.metadata?.memberId ?? '',
    };
  }

  return {
    /** キーが使えるかを確かめる（残高を読めるか） */
    async check(): Promise<void> {
      await get('/balance');
    },

    /** 期間（UNIX 秒、両端を含む）の残高の動きを、何の決済かを付けて返す。円以外は除く */
    async items(from: number, to: number): Promise<StripeItem[]> {
      const out: StripeItem[] = [];
      let after: string | undefined;
      for (let page = 0; page < 50; page++) {
        const r = await get<{ data: Txn[]; has_more: boolean }>('/balance_transactions', {
          'created[gte]': String(from), 'created[lte]': String(to), limit: '100', 'expand[]': 'data.source',
          ...(after ? { starting_after: after } : {}),
        });
        for (const t of r.data) {
          if (t.currency !== 'jpy') continue;
          const src = typeof t.source === 'object' ? t.source : null;
          let ch: Charge | null = null;
          if (src?.object === 'charge') ch = src as Charge;
          if (src?.object === 'refund') {
            const c = (src as Refund).charge;
            ch = typeof c === 'string' ? await get<Charge>(`/charges/${c}`) : c ?? null;
          }
          out.push({
            id: t.id, category: t.reporting_category, amount: t.amount, fee: t.fee, net: t.net, created: t.created,
            description: t.description ?? '', ...(await chargeInfo(ch)),
          });
        }
        if (!r.has_more || !r.data.length) break;
        after = r.data[r.data.length - 1].id;
      }
      return out.sort((a, b) => a.created - b.created);
    },
  };
}

/** 日本時間の日付の範囲 → UNIX 秒の範囲 */
export function jstRange(from: string, to: string): [number, number] {
  const start = Date.parse(`${from}T00:00:00+09:00`) / 1000;
  const end = Date.parse(`${to}T23:59:59+09:00`) / 1000;
  return [start, end];
}
