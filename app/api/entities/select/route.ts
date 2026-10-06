import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { selectEntity } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

/** 画面で使う法人を切り替える */
export async function POST(req: Request) {
  return handle('select entity', async (userId) => {
    const body = (await readJson(req)) as { id?: unknown };
    await selectEntity(userId, String(body?.id ?? ''));
    return NextResponse.json({ ok: true });
  });
}
