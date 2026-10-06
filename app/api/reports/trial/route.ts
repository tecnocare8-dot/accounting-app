import { NextResponse, type NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { loadBooks, reportRange } from '@/lib/books';
import { storeForUser } from '@/lib/entity-store';
import { balanceCheck, trialBalance } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle('trial balance', async (userId) => {
    const books = await loadBooks((await storeForUser(userId)).store);
    const { year, range } = reportRange(books, req.nextUrl.searchParams);
    const tb = trialBalance(books.journal, books.accounts, range);
    return NextResponse.json({ ...tb, check: balanceCheck(tb), year, range, years: books.years, accounts: books.accounts });
  });
}
