import { NextResponse, type NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { loadBooks, pickYear } from '@/lib/books';
import { depsForUser, storeForUser } from '@/lib/entity-store';
import { addVoucher } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

/** 年度の伝票の一覧（新しい順） */
export async function GET(req: NextRequest) {
  return handle('list journal', async (userId) => {
    const books = await loadBooks((await storeForUser(userId)).store);
    const year = pickYear(books, req.nextUrl.searchParams.get('year'));
    const vouchers = books.journal
      .filter((v) => v.date >= year.start && v.date <= year.end)
      .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
    return NextResponse.json({ vouchers, accounts: books.accounts, years: books.years, year, today: books.today });
  });
}

export async function POST(req: Request) {
  return handle('add voucher', async (userId) => {
    const body = (await readJson(req)) as { id?: unknown };
    const voucher = await addVoucher(await depsForUser(userId), String(body?.id ?? ''), body);
    return NextResponse.json({ voucher });
  });
}
