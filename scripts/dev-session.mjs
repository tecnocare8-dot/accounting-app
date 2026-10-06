// 手元の確認用：Googleログインの代わりに、確認用の利用者でログインした状態の値を作る。
// 表示された値をブラウザの開発者ツールで cookie に入れる（擬似ドライブを使うので、Googleには触れない）
//   node --env-file=.env scripts/dev-session.mjs
import { createRequire } from 'module';
import { createCipheriv, createHash, randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const { encode } = require('next-auth/jwt');
const { PrismaClient } = require('@prisma/client');

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') || !process.env.DRIVE_FAKE_DIR) {
  console.error('手元のデータベースと DRIVE_FAKE_DIR のときだけ使えます。');
  process.exit(1);
}

function encryptSecret(plain) {
  const key = createHash('sha256').update(`google-refresh-token:${process.env.NEXTAUTH_SECRET}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

const prisma = new PrismaClient();
const email = 'dev@example.com';
const user = await prisma.user.upsert({
  where: { email },
  update: {},
  create: { email, name: '確認用', googleRefreshToken: encryptSecret('dummy') },
});
const token = await encode({ token: { userId: user.id, email, name: '確認用' }, secret: process.env.NEXTAUTH_SECRET });
console.log(`document.cookie = "next-auth.session-token=${token}; path=/";`);
await prisma.$disconnect();
