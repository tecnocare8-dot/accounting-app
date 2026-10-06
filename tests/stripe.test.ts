import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS } from '@/lib/accounts';
import { addVouchers } from '@/lib/ledger';
import { jstRange, stripeClient, StripeKeyError } from '@/lib/stripe-api';
import { fromStripe, jstDate, type StripeItem } from '@/lib/stripe-import';
import { TEST_SETTINGS, line, testDeps } from './helpers';

const ctx = (journal = [] as Parameters<typeof fromStripe>[1]['journal']) => ({ settings: TEST_SETTINGS, accounts: DEFAULT_ACCOUNTS, journal });
// 2026-07-01 10:00 JST
const T = Date.parse('2026-07-01T10:00:00+09:00') / 1000;
const item = (p: Partial<StripeItem>): StripeItem => ({
  id: 'txn_1', category: 'charge', amount: 3000, fee: 108, net: 2892, created: T, description: '', siteType: 'course_fee',
  productName: 'コーチング導入講座', memberId: 'TC12345', ...p,
});

describe('Stripe の明細 → 伝票の候補', () => {
  it('受講料：Stripe残高（手取り）・支払手数料 ／ 受講料収入（非収益事業）', () => {
    const [c] = fromStripe([item({})], ctx());
    expect(c.status).toBe('ok');
    expect(c.input).toMatchObject({ date: '2026-07-01', segment: 'nonprofit', counterparty: 'TC12345', source: 'stripe', sourceId: 'txn_1' });
    expect(c.input.description).toBe('受講料：コーチング導入講座');
    expect(c.input.lines).toEqual([line('103', 2892, '', 0), line('502', 108, '', 0, 'Stripe 手数料'), line('', 0, '401', 3000)]);
  });

  it('種類ごとの科目：更新コース＝受講料、企業パッケージ＝研修収入、会員＝会費収入', () => {
    const cs = fromStripe([
      item({ id: 'a', siteType: 'renewal_fee' }), item({ id: 'b', siteType: 'package_purchase' }), item({ id: 'c', siteType: 'premium_membership' }),
    ], ctx());
    expect(cs.map((c) => c.input.lines.at(-1)!.creditAccount)).toEqual(['401', '404', '411']);
  });

  it('サイトの目印がない決済は、科目を選ぶまで取り込まない', () => {
    const [c] = fromStripe([item({ siteType: '', productName: '', description: '領収書アプリ 年額' })], ctx());
    expect(c.status).toBe('needsAccount');
    expect(c.note).toContain('目印がありません');
    expect(c.include).toBe(false);
  });

  it('返金：収入を取り消す（手数料が戻った分は手数料の取り消し）', () => {
    const [c] = fromStripe([item({ id: 'txn_r', category: 'refund', amount: -3000, fee: -108, net: -2892 })], ctx());
    expect(c.input.description).toContain('返金');
    expect(c.input.lines).toEqual([line('401', 3000, '', 0, '返金'), line('', 0, '103', 2892), line('', 0, '502', 108, '手数料の返金')]);
    const [d] = fromStripe([item({ id: 'txn_r2', category: 'refund', amount: -3000, fee: 0, net: -3000 })], ctx());
    expect(d.input.lines).toEqual([line('401', 3000, '', 0, '返金'), line('', 0, '103', 3000)]);
  });

  it('振込：普通預金 ／ Stripe残高。振込の取り消しは逆', () => {
    const [p, r] = fromStripe([
      item({ id: 'po', category: 'payout', amount: -50000, fee: 0, net: -50000, siteType: '' }),
      item({ id: 'pr', category: 'payout_reversal', amount: 50000, fee: 0, net: 50000, siteType: '' }),
    ], ctx());
    expect(p.status).toBe('ok');
    expect(p.input.lines).toEqual([line('102', 50000, '', 0), line('', 0, '103', 50000)]);
    expect(r.input.lines).toEqual([line('103', 50000, '', 0), line('', 0, '102', 50000)]);
  });

  it('チャージバックなどは科目を選んでもらう。取り込み済みは「取り込み済み」', async () => {
    const [x] = fromStripe([item({ id: 'dp', category: 'dispute', amount: -3000, fee: 1500, net: -4500 })], ctx());
    expect(x.status).toBe('needsAccount');
    const deps = await testDeps();
    await addVouchers(deps, fromStripe([item({})], ctx()).map((c) => c.input));
    expect(fromStripe([item({})], ctx(await deps.store.loadJournal()))[0].status).toBe('duplicate');
  });

  it('日本時間で日付を決める', () => {
    expect(jstDate(Date.parse('2026-06-30T15:30:00Z') / 1000)).toBe('2026-07-01');
    expect(jstRange('2026-07-01', '2026-07-31')).toEqual([Date.parse('2026-06-30T15:00:00Z') / 1000, Date.parse('2026-07-31T14:59:59Z') / 1000]);
  });
});

describe('Stripe の API を読む', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  it('決済から checkout を探して、種類と品名を付ける。返金は元の決済から。ページを送る', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/balance_transactions')) {
        if (!u.searchParams.get('starting_after')) {
          return ok({ has_more: true, data: [
            { id: 'txn_1', amount: 3000, fee: 108, net: 2892, created: T, currency: 'jpy', reporting_category: 'charge', description: null, source: { object: 'charge', payment_intent: 'pi_1' } },
          ] });
        }
        return ok({ has_more: false, data: [
          { id: 'txn_2', amount: -3000, fee: 0, net: -3000, created: T + 10, currency: 'jpy', reporting_category: 'refund', description: null, source: { object: 'refund', charge: 'ch_1' } },
          { id: 'txn_usd', amount: 100, fee: 0, net: 100, created: T, currency: 'usd', reporting_category: 'charge', description: null, source: null },
        ] });
      }
      if (u.pathname.endsWith('/charges/ch_1')) return ok({ object: 'charge', payment_intent: 'pi_1' });
      if (u.pathname.endsWith('/checkout/sessions')) {
        return ok({ data: [{ metadata: { type: 'course_fee', memberId: 'TC1' }, line_items: { data: [{ description: 'NLP入門' }] } }] });
      }
      return new Response('{}', { status: 404 });
    };
    const items = await stripeClient('rk_test', fetcher).items(T - 100, T + 100);
    expect(items.map((i) => [i.id, i.category, i.siteType, i.productName, i.memberId])).toEqual([
      ['txn_1', 'charge', 'course_fee', 'NLP入門', 'TC1'],
      ['txn_2', 'refund', 'course_fee', 'NLP入門', 'TC1'],
    ]);
    // 同じ決済の checkout は1回だけ探す
    expect(calls.filter((c) => c.includes('/checkout/sessions')).length).toBe(1);
  });

  it('キーが違う・権限が足りないときは、直し方が分かる言葉で伝える', async () => {
    const bad = (status: number) => async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status });
    await expect(stripeClient('rk', bad(401)).check()).rejects.toThrow(StripeKeyError);
    await expect(stripeClient('rk', bad(403)).check()).rejects.toThrow('権限が足りません');
  });
});
