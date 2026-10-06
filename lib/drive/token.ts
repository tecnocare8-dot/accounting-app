import { decryptSecret } from '../crypto';
import { prisma } from '../prisma';
import { DriveAuthError } from './backend';

const cache = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(userId: string) {
  cache.delete(userId);
}

/** 保存してあるリフレッシュトークンから、ドライブを使うためのアクセストークンを取る */
export async function accessTokenFor(userId: string, encryptedRefreshToken: string | null): Promise<string> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = encryptedRefreshToken ? decryptSecret(encryptedRefreshToken) : null;
  if (!refreshToken) throw new DriveAuthError('Googleドライブと連携されていません。');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant = 利用者が連携を解除した・トークンが失効した。保存済みのトークンを消して、ログインし直してもらう
    if (data?.error === 'invalid_grant') {
      await prisma.user.update({ where: { id: userId }, data: { googleRefreshToken: null } });
      throw new DriveAuthError('Googleドライブとの連携が切れました。');
    }
    throw new Error(`Google token refresh failed: ${res.status} ${JSON.stringify(data)}`);
  }
  cache.set(userId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
