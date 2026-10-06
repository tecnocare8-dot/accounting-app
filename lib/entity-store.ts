import path from 'path';
import { DriveAuthError, fileBackend, googleBackend } from './drive/backend';
import { accessTokenFor, forgetAccessToken } from './drive/token';
import { ValidationError } from './journal';
import type { LedgerDeps } from './ledger';
import { prisma } from './prisma';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { createStore, FolderMissingError, setupFolder, type LedgerStore } from './store';
import { isDate } from './fiscal';
import { decryptSecret, encryptSecret } from './crypto';
import { stripeClient } from './stripe-api';

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** 利用者のドライブ。手元の確認では DRIVE_FAKE_DIR の擬似ドライブを使う（Vercel では使わない） */
async function backendForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const useFake = Boolean(process.env.DRIVE_FAKE_DIR) && !process.env.VERCEL;
  const backend = useFake
    ? fileBackend(path.resolve(process.env.DRIVE_FAKE_DIR!, userId))
    : googleBackend(() => accessTokenFor(userId, user.googleRefreshToken), () => forgetAccessToken(userId));
  return { user, backend, connected: Boolean(user.googleRefreshToken) };
}

/** 台帳の「読む → 書く」を法人ごとに1つずつ順番に行う（PostgreSQL のトランザクション内のロック） */
function withEntityLock<T>(entityId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger:${entityId}`}))`;
    return fn();
  }, { timeout: 60_000, maxWait: 60_000 });
}

/** 画面を開いたときの確認：ドライブ連携・法人の一覧・選んでいる法人とそのフォルダ */
export async function bootstrap(userId: string) {
  const { user, backend, connected } = await backendForUser(userId);
  const entities = await prisma.entity.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } });
  const current = entities.find((e) => e.id === user.currentEntityId) ?? entities[0] ?? null;
  let folderOk = false;
  if (connected && current?.driveFolderId) {
    const f = await backend.get(current.driveFolderId);
    folderOk = Boolean(f && !f.trashed);
  }
  return {
    connected,
    email: user.email,
    entities: entities.map((e) => ({ id: e.id, name: e.name })),
    current: current && { id: current.id, name: current.name, folder: current.driveFolderId ? folderUrl(current.driveFolderId) : null, folderOk },
  };
}

/** 法人を作り、ドライブにその法人のフォルダ（空の帳簿・初期の科目・設定）を作る */
export async function createEntity(userId: string, raw: unknown) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 100) : '';
  const errors: string[] = [];
  if (!name) errors.push('法人の名前を入れてください。');
  if (!isDate(r.firstYearStart)) errors.push('帳簿を付け始める日（年度の始まり）を入れてください。');
  const month = Number(r.closingMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.push('決算月を選んでください。');
  if (errors.length) throw new ValidationError(errors);
  const { backend, connected } = await backendForUser(userId);
  if (!connected) throw new DriveAuthError('Googleドライブと連携されていません。');
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, entityName: name, entityKind: r.entityKind, closingMonth: month, firstYearStart: r.firstYearStart });
  const folderName = `会計_${name}`.slice(0, 100);
  const folderId = await setupFolder(backend, folderName, settings);
  const entity = await prisma.entity.create({ data: { ownerId: userId, name, driveFolderId: folderId, driveFolderName: folderName } });
  await prisma.user.update({ where: { id: userId }, data: { currentEntityId: entity.id } });
  return { id: entity.id, name };
}

export async function selectEntity(userId: string, entityId: string) {
  const e = await prisma.entity.findFirst({ where: { id: entityId, ownerId: userId } });
  if (!e) throw new ValidationError(['法人が見つかりません。']);
  await prisma.user.update({ where: { id: userId }, data: { currentEntityId: e.id } });
}

/** いま選んでいる法人の帳簿 */
export async function storeForUser(userId: string): Promise<{ store: LedgerStore; entityId: string }> {
  const { user, backend, connected } = await backendForUser(userId);
  if (!connected) throw new DriveAuthError('Googleドライブと連携されていません。');
  const entity = (user.currentEntityId && await prisma.entity.findFirst({ where: { id: user.currentEntityId, ownerId: userId } }))
    || await prisma.entity.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } });
  if (!entity?.driveFolderId) throw new FolderMissingError('法人がまだありません。');
  const folder = await backend.get(entity.driveFolderId);
  if (!folder || folder.trashed) throw new FolderMissingError('法人のフォルダがドライブで削除されています。');
  return { store: createStore({ backend, folderId: entity.driveFolderId, lock: (fn) => withEntityLock(entity.id, fn) }), entityId: entity.id };
}

export async function depsForUser(userId: string): Promise<LedgerDeps> {
  const [{ store }, user] = await Promise.all([storeForUser(userId), prisma.user.findUnique({ where: { id: userId }, select: { email: true } })]);
  return { store, now: () => new Date(), actor: user?.email ?? '' };
}

/** 法人の名前を設定で変えたら、一覧の名前も合わせる */
export async function renameEntity(userId: string, name: string) {
  const { entityId } = await storeForUser(userId);
  await prisma.entity.update({ where: { id: entityId }, data: { name } });
}

// ---------------------------------------------------------------- Stripe のキー（法人ごと、暗号化して保存）

async function currentEntity(userId: string) {
  const { entityId } = await storeForUser(userId);
  return prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
}

/** 画面に出す接続の状態（キーそのものは返さない） */
export async function stripeStatus(userId: string) {
  const e = await currentEntity(userId);
  const key = e.stripeKey ? decryptSecret(e.stripeKey) : null;
  return { connected: Boolean(key), hint: key ? `${key.slice(0, 8)}…${key.slice(-4)}` : '' };
}

/** 制限付きキーを確かめてから保存する。書き込みもできるキー（sk_）は受け付けない */
export async function saveStripeKey(userId: string, raw: unknown) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!/^rk_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) {
    throw new ValidationError(['Stripe の「制限付きキー」（rk_live_ で始まるもの）を入れてください。sk_ で始まる秘密キーは、書き込みもできてしまうので使いません。']);
  }
  // 本番では、テスト用（サンドボックス）のキーは受け付けない（テストの決済が帳簿に入らないように）
  if (process.env.VERCEL_ENV === 'production' && key.startsWith('rk_test_')) {
    throw new ValidationError(['これはテスト用（サンドボックス）のキーです。Stripe のダッシュボードを本番の環境に切り替えてから、rk_live_ で始まるキーを作ってください。']);
  }
  await stripeClient(key).check();
  const e = await currentEntity(userId);
  await prisma.entity.update({ where: { id: e.id }, data: { stripeKey: encryptSecret(key) } });
  return stripeStatus(userId);
}

export async function removeStripeKey(userId: string) {
  const e = await currentEntity(userId);
  await prisma.entity.update({ where: { id: e.id }, data: { stripeKey: null } });
}

/** 取り込み用の Stripe の読み取り口。未接続なら案内付きのエラー */
export async function stripeForUser(userId: string) {
  const e = await currentEntity(userId);
  const key = e.stripeKey ? decryptSecret(e.stripeKey) : null;
  if (!key) throw new ValidationError(['Stripe とまだつながっていません。設定の「Stripe との連携」で制限付きキーを入れてください。']);
  return stripeClient(key);
}
