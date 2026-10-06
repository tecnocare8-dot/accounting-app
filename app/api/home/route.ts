import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { loadBooks } from '@/lib/books';
import { storeForUser } from '@/lib/entity-store';
import { homeSummary } from '@/lib/home';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle('home', async (userId) => NextResponse.json(homeSummary(await loadBooks((await storeForUser(userId)).store))));
}
