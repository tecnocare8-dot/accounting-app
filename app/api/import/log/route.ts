import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { storeForUser } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle('import log', async (userId) => {
    const log = await (await storeForUser(userId)).store.loadImportLog();
    return NextResponse.json({ log: log.reverse().slice(0, 50) });
  });
}
