import { NextResponse, type NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { loadBooks, reportRange } from '@/lib/books';
import { storeForUser } from '@/lib/entity-store';
import { NotFoundError } from '@/lib/journal';
import { generalLedger } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle('general ledger', async (userId) => {
    const books = await loadBooks((await storeForUser(userId)).store);
    const { year, range } = reportRange(books, req.nextUrl.searchParams);
    const gl = generalLedger(books.journal, books.accounts, req.nextUrl.searchParams.get('code') ?? '', range);
    if (!gl) throw new NotFoundError('科目が見つかりません。');
    return NextResponse.json({ ...gl, year, range, years: books.years, accounts: books.accounts });
  });
}
