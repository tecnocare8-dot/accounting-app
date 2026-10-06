import type { Account } from './accounts';
import type { Candidate } from './importers';
import { finishCandidate } from './importers';
import type { JournalLine, Voucher, VoucherInput } from './journal';
import type { Settings } from './settings';

// Stripe の残高の動き（balance transaction）から伝票の候補を作る。
// 金額は Stripe を正とし、何の売上かはサイトが checkout に付けた目印（metadata.type）と品名で決める

export const STRIPE_TYPE_LABEL: Record<string, string> = {
  course_fee: '受講料', renewal_fee: '更新コース', certification_fee: '認定料', package_purchase: '企業パッケージ',
  premium_membership: 'プレミアム会員', company_membership: '企業会員',
};

/** 残高の動き1件と、それが何の決済か（サイトの checkout から分かった分） */
export interface StripeItem {
  id: string; // txn_...
  /** Stripe の分類：charge / refund / payout / payout_reversal / fee / dispute など（reporting_category） */
  category: string;
  /** 円。入ってくるお金は＋、出ていくお金は− */
  amount: number;
  fee: number; // Stripe 手数料（＋）
  net: number;
  created: number; // UNIX 秒
  description: string;
  /** サイトの決済の種類と品名（分からなければ空） */
  siteType: string;
  productName: string;
  memberId: string;
}

const STRIPE_BALANCE = '103';
const FEE = '502';

/** UNIX 秒 → 日本時間の日付 */
export const jstDate = (sec: number) => new Date(sec * 1000 + 9 * 3600_000).toISOString().slice(0, 10);

const dr = (code: string, amount: number, memo = ''): JournalLine => ({ debitAccount: code, debitAmount: amount, creditAccount: '', creditAmount: 0, memo });
const cr = (code: string, amount: number, memo = ''): JournalLine => ({ debitAccount: '', debitAmount: 0, creditAccount: code, creditAmount: amount, memo });

interface Context { settings: Settings; accounts: Account[]; journal: Voucher[] }

export function fromStripe(items: StripeItem[], ctx: Context): Candidate[] {
  const map = ctx.settings.stripeTypeMap;
  return items.map((it, i) => {
    const label = STRIPE_TYPE_LABEL[it.siteType] ?? '';
    const revenue = it.siteType ? map[it.siteType] ?? '' : '';
    const what = [label, it.productName].filter(Boolean).join('：') || it.description || 'Stripe';
    const base = {
      date: jstDate(it.created), segment: '' as VoucherInput['segment'], description: what,
      counterparty: it.memberId, source: 'stripe', sourceId: it.id,
    };
    const unknownSite = it.siteType ? '' : 'サイトの決済の目印がありません（ほかのサービスの決済かもしれません）。科目を選ぶか、取り込まないでください';
    switch (it.category) {
      case 'charge': {
        // 売上：Stripe残高（手取り）・支払手数料 ／ 収入（受け取った額）
        const lines = [dr(STRIPE_BALANCE, it.net), dr(FEE, it.fee, 'Stripe 手数料'), cr(revenue, it.amount)];
        return finishCandidate(ctx, i + 1, { ...base, lines }, revenue ? {} : { note: unknownSite || `種類「${it.siteType}」の科目が決まっていません` });
      }
      case 'refund': {
        // 返金：収入を取り消す（Stripe は返金で手数料を戻さないことが多い。戻った分は手数料の取り消し）
        const amt = -it.amount;
        const lines = [dr(revenue, amt, '返金'), cr(STRIPE_BALANCE, -it.net), cr(FEE, -it.fee, '手数料の返金')];
        return finishCandidate(ctx, i + 1, { ...base, description: `返金：${what}`, lines }, revenue ? {} : { note: unknownSite || '元の決済の種類が分かりません' });
      }
      case 'payout':
      case 'payout_reversal': {
        // 振込：預金 ／ Stripe残高（振込の取り消しは逆）
        const bank = ctx.settings.stripePayoutAccount;
        const amt = Math.abs(it.amount);
        const lines = it.amount < 0
          ? [dr(bank, amt), dr(FEE, it.fee, '振込手数料'), cr(STRIPE_BALANCE, amt + it.fee)]
          : [dr(STRIPE_BALANCE, amt), cr(bank, amt)];
        return finishCandidate(ctx, i + 1, { ...base, description: it.amount < 0 ? 'Stripe から振込' : 'Stripe の振込の取り消し', counterparty: '', lines });
      }
      case 'fee': {
        const amt = -it.net;
        const lines = amt >= 0 ? [dr(FEE, amt), cr(STRIPE_BALANCE, amt)] : [dr(STRIPE_BALANCE, -amt), cr(FEE, -amt)];
        return finishCandidate(ctx, i + 1, { ...base, description: it.description || 'Stripe の手数料', counterparty: '', lines });
      }
      default: {
        // チャージバックなど：相手の科目は画面で選んでもらう
        const amt = Math.abs(it.net);
        const lines = it.net >= 0 ? [dr(STRIPE_BALANCE, amt), cr('', amt)] : [dr('', amt), cr(STRIPE_BALANCE, amt)];
        return finishCandidate(ctx, i + 1, { ...base, description: `${it.category}：${it.description}`, lines }, { note: `Stripe の「${it.category}」です。科目を選んでください` });
      }
    }
  });
}
