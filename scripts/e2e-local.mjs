// 手元で起動したアプリに実際のHTTPリクエストを送り、APIの通しの動きを確かめる。
// ドライブは DRIVE_FAKE_DIR の擬似ドライブを使う。作った確認用の利用者は最後に消す。
//   npm run build && npx next start -p 3200 &
//   E2E_BASE=http://localhost:3200 node --env-file=.env scripts/e2e-local.mjs
import { createRequire } from 'module';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const { encode } = require('next-auth/jwt');
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.E2E_BASE || 'http://localhost:3200';
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') || !process.env.DRIVE_FAKE_DIR) {
  console.error('手元のデータベースと DRIVE_FAKE_DIR のときだけ使えます。');
  process.exit(1);
}

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

function encryptSecret(plain) {
  const key = createHash('sha256').update(`google-refresh-token:${process.env.NEXTAUTH_SECRET}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

async function login() {
  const email = `e2e-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email, name: 'E2E', googleRefreshToken: encryptSecret('dummy') } });
  const cookie = `next-auth.session-token=${await encode({ token: { userId: user.id, email }, secret: process.env.NEXTAUTH_SECRET })}`;
  return {
    user,
    async api(p, init = {}) {
      const headers = { cookie, ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) };
      const res = await fetch(BASE + p, { ...init, headers });
      const type = res.headers.get('content-type') ?? '';
      const body = type.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body, headers: res.headers };
    },
  };
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });
const L = (d, da, c, ca) => ({ debitAccount: d, debitAmount: da, creditAccount: c, creditAmount: ca, memo: '' });
const vid = () => `v-${randomUUID()}`;

try {
  const a = await login();
  let r;

  console.log('■ ログインと法人');
  check('未ログインは401', (await fetch(`${BASE}/api/journal`)).status === 401);
  r = await a.api('/api/bootstrap');
  check('連携済み・法人なし', r.body.connected === true && r.body.current === null, JSON.stringify(r.body));
  r = await a.api('/api/journal');
  check('法人がないと409', r.status === 409 && r.body.code === 'FOLDER_MISSING', JSON.stringify(r.body));
  r = await a.api('/api/entities', json('POST', { name: '', closingMonth: 3, firstYearStart: '2026-04-01' }));
  check('名前がないと作れない', r.status === 400);
  r = await a.api('/api/entities', json('POST', { name: '一般社団法人E2E', entityKind: '一般社団法人（非営利型）', closingMonth: 3, firstYearStart: '2026-04-01' }));
  check('法人を作れる', r.status === 200, JSON.stringify(r.body));
  r = await a.api('/api/bootstrap');
  check('作った法人が選ばれていて、フォルダがある', r.body.current?.name === '一般社団法人E2E' && r.body.current.folderOk === true, JSON.stringify(r.body));

  console.log('■ 設定と科目');
  r = await a.api('/api/settings');
  check('初期の科目と年度', r.body.accounts.some((x) => x.code === '401' && x.segment === 'nonprofit') && r.body.years[0].start === '2026-04-01', JSON.stringify(r.body.years));
  check('台帳のファイルが5つ', Object.keys(r.body.links).length === 5, JSON.stringify(r.body.links));
  r = await a.api('/api/accounts', json('POST', { name: 'セミナー会場費', type: 'expense', segment: 'common' }));
  check('科目を足せる', r.status === 200 && r.body.account.code === '515', JSON.stringify(r.body));
  r = await a.api('/api/settings', json('PUT', { bankRules: [{ keyword: 'ﾃﾞﾝﾜ', accountCode: '503' }, { keyword: 'ｽﾄﾗｲﾌﾟ', accountCode: '' }] }));
  check('銀行の規則を保存できる', r.status === 200 && r.body.settings.bankRules.length === 2, JSON.stringify(r.body));

  console.log('■ 仕訳');
  const opening = vid();
  r = await a.api('/api/journal', json('POST', { id: opening, date: '2026-04-01', segment: 'nonprofit', description: '期首残高', counterparty: '', lines: [L('102', 300000, '301', 300000)] }));
  check('期首残高を入れられる', r.status === 200 && r.body.voucher.number === 1, JSON.stringify(r.body));
  const again = await a.api('/api/journal', json('POST', { id: opening, date: '2026-04-01', segment: 'nonprofit', description: '期首残高', counterparty: '', lines: [L('102', 300000, '301', 300000)] }));
  check('同じIDの二度押しは1件', again.body.voucher.id === opening);
  r = await a.api('/api/journal', json('POST', { id: vid(), date: '2026-05-01', segment: 'common', description: 'ずれ', counterparty: '', lines: [L('505', 100, '102', 90)] }));
  check('貸借が合わないと400', r.status === 400 && r.body.error.includes('合いません'), JSON.stringify(r.body));
  const fee = vid();
  r = await a.api('/api/journal', json('POST', { id: fee, date: '2026-05-10', segment: 'nonprofit', description: '受講料', counterparty: '', lines: [L('103', 5000, '401', 5000)] }));
  check('受講料を入れられる', r.status === 200);
  r = await a.api(`/api/journal/${fee}`, json('PUT', { date: '2026-05-10', segment: 'nonprofit', description: '受講料（直し）', counterparty: '', lines: [L('103', 5500, '401', 5500)] }));
  check('直せる', r.status === 200 && r.body.voucher.lines[0].debitAmount === 5500);
  const tmp = vid();
  await a.api('/api/journal', json('POST', { id: tmp, date: '2026-05-11', segment: 'common', description: '消す', counterparty: '', lines: [L('505', 100, '102', 100)] }));
  r = await a.api(`/api/journal/${tmp}`, json('DELETE', { reason: '' }));
  check('理由なしでは消せない', r.status === 400);
  r = await a.api(`/api/journal/${tmp}`, json('DELETE', { reason: '試し' }));
  check('理由を付けて消せる', r.status === 200);
  r = await a.api(`/api/journal/${fee}`);
  check('伝票の変更履歴（追加・修正）', r.body.history.map((h) => h.action).join() === '追加,修正', JSON.stringify(r.body.history));

  console.log('■ 取り込み');
  const receipts = '﻿ID,日付,会社名,登録番号,金額,支払い方法,分類,画像ファイル名,画像リンク,登録日時,登録者,登録者ID\r\n'
    + 'r1,2026-06-01,文具店,,1100,現金,消耗品費,,,,代表者,\r\nr2,2026-06-02,謎,,800,クレジットカード,なぞ,,,,代表者,\r\n';
  const form = (kind, text, name, bank) => {
    const f = new FormData();
    f.set('kind', kind);
    f.set('file', new Blob([text], { type: 'text/csv' }), name);
    if (bank) f.set('bank', JSON.stringify(bank));
    return { method: 'POST', body: f };
  };
  r = await a.api('/api/import/preview', form('receipts', receipts, '領収書一覧.csv'));
  check('領収書の候補', r.status === 200 && r.body.candidates.map((c) => c.status).join() === 'ok,needsAccount', JSON.stringify(r.body));
  const cands = r.body.candidates;
  cands[1].input.lines[0].debitAccount = '599';
  cands[1].input.segment = 'common';
  r = await a.api('/api/import/commit', json('POST', { kind: 'receipts', fileName: '領収書一覧.csv', inputs: cands.map((c) => c.input) }));
  check('科目を選んで取り込める', r.status === 200 && r.body.added === 2, JSON.stringify(r.body));
  r = await a.api('/api/import/commit', json('POST', { kind: 'receipts', fileName: '領収書一覧.csv', inputs: cands.map((c) => c.input) }));
  check('同じものをもう一度送っても入らない', r.body.added === 0 && r.body.skipped.length === 2, JSON.stringify(r.body));
  r = await a.api('/api/import/commit', json('POST', { kind: 'receipts', fileName: 'x', inputs: [{ ...cands[0].input, source: 'bank:102' }] }));
  check('取り込み元を名乗り替えできない', r.status === 400);
  r = await a.api('/api/import/preview', form('receipts', receipts, '領収書一覧.csv'));
  check('読み直すと取り込み済み', r.body.candidates.every((c) => c.status === 'duplicate'));

  const bank = '取引日,摘要,お支払金額,お預り金額,残高\r\n2026/06/05,ﾃﾞﾝﾜﾘﾖｳ,3300,,1\r\n2026/06/06,ｽﾄﾗｲﾌﾟ,,9800,2\r\n2026/06/07,ﾅｿﾞ,500,,3\r\n';
  r = await a.api('/api/import/preview', form('bank', bank, 'bank.csv'));
  check('銀行：列の当たりと候補', r.status === 200 && r.body.bank.dateCol === 0 && r.body.candidates.map((c) => c.status).join() === 'ok,excluded,needsAccount', JSON.stringify(r.body).slice(0, 400));
  r = await a.api('/api/import/commit', json('POST', { kind: 'bank', fileName: 'bank.csv', inputs: [r.body.candidates[0].input] }));
  check('銀行の明細を取り込める', r.body.added === 1, JSON.stringify(r.body));
  r = await a.api('/api/import/log');
  check('取り込み記録', r.body.log.length === 3, JSON.stringify(r.body));

  console.log('■ 帳簿');
  r = await a.api('/api/reports/trial?year=2026-04-01');
  const row = (c) => r.body.rows.find((x) => x.code === c)?.closing;
  // 現金払い1100は現金、カード800は未払金、電話3300は普通預金から
  check('試算表：普通預金', row('102') === 300000 - 3300, String(row('102')));
  check('試算表：Stripe残高・受講料', row('103') === 5500 && row('401') === 5500);
  check('試算表：借方合計＝貸方合計', r.body.totalDebit === r.body.totalCredit && r.body.check.debit === r.body.check.credit, JSON.stringify(r.body.check));
  check('収入−支出', r.body.netIncome === 5500 - 1100 - 800 - 3300, String(r.body.netIncome));
  r = await a.api('/api/reports/trial?year=2026-04-01&segment=nonprofit');
  check('区分で絞り込める', r.body.netIncome === 5500, String(r.body.netIncome));
  r = await a.api('/api/reports/ledger?year=2026-04-01&code=102');
  check('総勘定元帳', r.body.entries.length === 2 && r.body.closing === 296700, JSON.stringify(r.body.entries));
  r = await a.api('/api/export?type=trial&year=2026-04-01');
  check('試算表のCSV', r.status === 200 && r.body.includes('普通預金') && /filename\*=UTF-8''/.test(r.headers.get('content-disposition')), r.headers.get('content-disposition'));
  r = await a.api('/api/export?type=journal&year=2026-04-01');
  check('仕訳帳のCSV', r.status === 200 && r.body.split('\r\n').length >= 7);
  r = await a.api('/api/home');
  check('ホーム', r.body.cash.length >= 2 && r.body.count === 5 && r.body.bySegment.nonprofit.revenue === 5500, JSON.stringify(r.body));
  r = await a.api('/api/audit');
  check('変更履歴に操作した人', r.body.entries.length > 5 && r.body.entries.every((e) => e.actor.startsWith('e2e-')));

  console.log('■ 2つ目の法人と、ほかの人');
  r = await a.api('/api/entities', json('POST', { name: '株式会社E2E', entityKind: '株式会社', closingMonth: 12, firstYearStart: '2026-01-01' }));
  r = await a.api('/api/journal');
  check('2つ目の法人に切り替わり、帳簿は別', r.status === 200 && r.body.vouchers.length === 0 && r.body.year.end === '2026-12-31', JSON.stringify(r.body.year));
  const first = (await a.api('/api/bootstrap')).body.entities[0];
  await a.api('/api/entities/select', json('POST', { id: first.id }));
  r = await a.api('/api/journal');
  check('元の法人に戻せる', r.body.vouchers.length === 5);
  const b = await login();
  r = await b.api('/api/entities/select', json('POST', { id: first.id }));
  check('ほかの人の法人は選べない', r.status === 400);
  r = await b.api(`/api/journal/${fee}`);
  check('ほかの人の伝票は見えない', r.status === 409 || r.status === 404, String(r.status));
} catch (e) {
  fail++;
  console.error(e);
} finally {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
  await prisma.$disconnect();
  console.log(`\n${pass} OK / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
