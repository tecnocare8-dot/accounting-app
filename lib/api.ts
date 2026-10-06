import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from './auth';
import { DriveAuthError } from './drive/backend';
import { ImportFormatError } from './importers';
import { NotFoundError, ValidationError } from './journal';
import { FolderMissingError, LedgerMissingError } from './store';

/** APIの共通のエラー応答。画面は code を見て「ログインし直す」「法人を作る」へ案内する */
export function errorResponse(error: unknown, context: string): Response {
  const json = (status: number, error: string, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });
  if (error instanceof UnauthorizedError) return json(401, 'ログインが必要です。', { code: 'UNAUTHORIZED' });
  if (error instanceof DriveAuthError) {
    return json(409, 'Googleドライブとの連携が必要です。いったんログアウトして、もう一度ログインしてください。', { code: 'DRIVE_AUTH' });
  }
  if (error instanceof FolderMissingError) return json(409, error.message, { code: 'FOLDER_MISSING' });
  if (error instanceof LedgerMissingError) {
    return json(409, `${error.fileName} がGoogleドライブに見つかりません。ドライブのゴミ箱にあれば、元に戻してください。`, { code: 'LEDGER_MISSING' });
  }
  if (error instanceof ValidationError) return json(400, error.messages.join('\n'), { messages: error.messages });
  if (error instanceof ImportFormatError) return json(400, error.message);
  if (error instanceof NotFoundError) return json(404, error.message);
  console.error(`${context}:`, error);
  return json(500, 'エラーが起きました。時間をおいて、もう一度お試しください。');
}

/** ログインを確かめてから処理し、エラーは共通の形で返す */
export async function handle(context: string, fn: (userId: string) => Promise<Response>): Promise<Response> {
  try {
    const userId = await requireUserId();
    return await fn(userId);
  } catch (e) {
    return errorResponse(e, context);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError(['送信された内容を読み取れませんでした。']);
  }
}

export function csvResponse(content: string, fileName: string): Response {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
