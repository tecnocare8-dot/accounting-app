import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { loadBooks } from '@/lib/books';
import { depsForUser, renameEntity, storeForUser } from '@/lib/entity-store';
import { updateSettings } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle('get settings', async (userId) => {
    const { store } = await storeForUser(userId);
    const books = await loadBooks(store);
    return NextResponse.json({
      settings: books.settings, accounts: books.accounts, years: books.years, links: await store.fileLinks(),
      usedAccounts: [...new Set(books.journal.flatMap((v) => v.lines.flatMap((l) => [l.debitAccount, l.creditAccount])).values())].filter(Boolean),
    });
  });
}

export async function PUT(req: Request) {
  return handle('update settings', async (userId) => {
    const settings = await updateSettings(await depsForUser(userId), await readJson(req));
    await renameEntity(userId, settings.entityName);
    return NextResponse.json({ settings });
  });
}
