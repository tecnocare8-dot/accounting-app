import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { bootstrap } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

/** 画面を開いたときの確認：ドライブ連携・法人の一覧・選んでいる法人 */
export async function GET() {
  return handle('bootstrap', async (userId) => NextResponse.json(await bootstrap(userId)));
}
