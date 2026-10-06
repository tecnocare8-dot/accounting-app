import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { removeStripeKey, saveStripeKey, stripeStatus } from '@/lib/entity-store';

export const dynamic = 'force-dynamic';

/** Stripe との連携の状態（キーそのものは返さない） */
export async function GET() {
  return handle('stripe status', async (userId) => NextResponse.json(await stripeStatus(userId)));
}

/** 制限付きキーを確かめて、暗号化して保存する */
export async function PUT(req: Request) {
  return handle('stripe key', async (userId) => {
    const body = (await readJson(req)) as { key?: unknown };
    return NextResponse.json(await saveStripeKey(userId, body?.key));
  });
}

export async function DELETE() {
  return handle('stripe key remove', async (userId) => {
    await removeStripeKey(userId);
    return NextResponse.json({ connected: false, hint: '' });
  });
}
