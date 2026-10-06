import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { depsForUser } from '@/lib/entity-store';
import { IMPORT_KIND_LABEL, IMPORT_KINDS, type ImportKind } from '@/lib/importers';
import { ValidationError } from '@/lib/journal';
import { addVouchers } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

/** 画面で確かめた候補を帳簿に入れる。取り込み済み（取り込み元IDが同じ）のものは入れない */
export async function POST(req: Request) {
  return handle('import commit', async (userId) => {
    const body = (await readJson(req)) as { kind?: unknown; fileName?: unknown; inputs?: unknown };
    const kind = body?.kind as ImportKind;
    if (!IMPORT_KINDS.includes(kind)) throw new ValidationError(['取り込み元が正しくありません。']);
    if (!Array.isArray(body.inputs) || !body.inputs.length) throw new ValidationError(['取り込む行を選んでください。']);
    if (body.inputs.length > 5000) throw new ValidationError(['一度に取り込めるのは5000行までです。']);
    // 取り込み元は種類から決める（画面から別の取り込み元を名乗れないように）
    const expect = kind === 'bank' ? /^bank:\d{3}$/ : new RegExp(`^${{ receipts: 'receipts', 'document-payouts': 'document-payout', 'document-incomes': 'document-income', 'document-payments': 'document-payment' }[kind]}$`);
    const bad = body.inputs.findIndex((x) => !expect.test(String((x as { source?: unknown })?.source ?? '')) || !(x as { sourceId?: unknown })?.sourceId);
    if (bad >= 0) throw new ValidationError([`${bad + 1}件目の取り込み元が正しくありません。もう一度ファイルを読み込んでください。`]);
    const deps = await depsForUser(userId);
    const result = await addVouchers(deps, body.inputs, `取り込み（${IMPORT_KIND_LABEL[kind]}）`);
    await deps.store.lock(() => deps.store.appendImportLog({
      at: deps.now().toISOString(), actor: deps.actor, kind: IMPORT_KIND_LABEL[kind], fileName: String(body.fileName ?? '').slice(0, 200),
      added: result.added.length, skipped: result.skipped.length,
    }));
    return NextResponse.json({ added: result.added.length, skipped: result.skipped });
  });
}
