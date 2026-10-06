import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { depsForUser } from '@/lib/entity-store';
import { saveAccount } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

/** 科目を足す（code なし）・直す */
export async function POST(req: Request) {
  return handle('save account', async (userId) => NextResponse.json({ account: await saveAccount(await depsForUser(userId), await readJson(req)) }));
}
