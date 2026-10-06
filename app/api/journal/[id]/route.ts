import { NextResponse, type NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { loadBooks } from '@/lib/books';
import { depsForUser, storeForUser } from '@/lib/entity-store';
import { isClosedDate } from '@/lib/fiscal';
import { NotFoundError } from '@/lib/journal';
import { deleteVoucher, updateVoucher } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle('get voucher', async (userId) => {
    const { id } = await params;
    const { store } = await storeForUser(userId);
    const books = await loadBooks(store);
    const voucher = books.journal.find((v) => v.id === id);
    if (!voucher) throw new NotFoundError('伝票が見つかりません。');
    const history = (await store.loadAudit()).filter((e) => e.targetId === id);
    return NextResponse.json({ voucher, accounts: books.accounts, closed: isClosedDate(books.settings, voucher.date), history });
  });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  return handle('update voucher', async (userId) => {
    const { id } = await params;
    return NextResponse.json({ voucher: await updateVoucher(await depsForUser(userId), id, await readJson(req)) });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle('delete voucher', async (userId) => {
    const { id } = await params;
    const body = (await readJson(req)) as { reason?: unknown };
    await deleteVoucher(await depsForUser(userId), id, String(body?.reason ?? ''));
    return NextResponse.json({ ok: true });
  });
}
