import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { createEntity } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

/** 法人を作る（ドライブにその法人のフォルダを作る） */
export async function POST(req: Request) {
  return handle('create entity', async (userId) => NextResponse.json({ entity: await createEntity(userId, await readJson(req)) }));
}
