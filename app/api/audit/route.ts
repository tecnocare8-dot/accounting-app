import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { storeForUser } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

/** 変更履歴（新しい順に500件） */
export async function GET() {
  return handle('audit', async (userId) => {
    const entries = await (await storeForUser(userId)).store.loadAudit();
    return NextResponse.json({ entries: entries.reverse().slice(0, 500) });
  });
}
