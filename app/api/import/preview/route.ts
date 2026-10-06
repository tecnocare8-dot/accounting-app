import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { loadBooks } from '@/lib/books';
import { decodeText, parseCsv } from '@/lib/csv';
import { storeForUser } from '@/lib/entity-store';
import { buildCandidates, guessBank, IMPORT_KINDS, type BankOptions, type ImportKind } from '@/lib/importers';
import { ValidationError } from '@/lib/journal';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

/** CSV を読んで、伝票の候補を返す（まだ帳簿には入れない） */
export async function POST(req: Request) {
  return handle('import preview', async (userId) => {
    const form = await req.formData().catch(() => null);
    const kind = String(form?.get('kind') ?? '') as ImportKind;
    const file = form?.get('file');
    if (!IMPORT_KINDS.includes(kind)) throw new ValidationError(['取り込み元を選んでください。']);
    if (!(file instanceof File) || !file.size) throw new ValidationError(['CSV ファイルを選んでください。']);
    if (file.size > MAX_BYTES) throw new ValidationError(['ファイルが大きすぎます（5MB まで）。期間を分けて取り込んでください。']);
    const text = decodeText(Buffer.from(await file.arrayBuffer()));
    const books = await loadBooks((await storeForUser(userId)).store);
    const ctx = { settings: books.settings, accounts: books.accounts, journal: books.journal };
    if (kind !== 'bank') return NextResponse.json({ candidates: buildCandidates(kind, text, ctx) });
    const guess = guessBank(text);
    let opts: BankOptions;
    try {
      const raw = JSON.parse(String(form?.get('bank') ?? 'null'));
      opts = raw ? { ...guess, ...raw } : { ...guess, bankAccount: '102' };
    } catch {
      opts = { ...guess, bankAccount: '102' };
    }
    const preview = parsePreview(text, opts.headerRow);
    if (opts.dateCol < 0 || (opts.amountCol < 0 && opts.inCol < 0 && opts.outCol < 0)) {
      return NextResponse.json({ candidates: [], bank: opts, preview, needColumns: true });
    }
    return NextResponse.json({ candidates: buildCandidates('bank', text, ctx, opts), bank: opts, preview });
  });
}

/** 列を選ぶ画面に出す、見出しと最初の数行 */
function parsePreview(text: string, headerRow: number) {
  const rows = parseCsv(text);
  return { headers: (rows[headerRow] ?? []).map((h) => h.trim()), rows: rows.slice(0, 8) };
}
