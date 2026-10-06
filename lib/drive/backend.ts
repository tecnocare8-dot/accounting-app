import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// 帳簿は利用者本人の Google ドライブ（このアプリが作ったフォルダ）に保存する。
// 権限は drive.file（このアプリが作ったファイルだけ触れる）なので、利用者のほかのファイルは見えない。
// ファイルの種類は appProperties（目に見えない目印）で見分け、名前に頼らない（利用者が名前を変えても動くように）
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const APP_TAG = 'accounting-app';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
}

export interface Backend {
  createFolder(parentId: string | null, name: string, props: Record<string, string>): Promise<string>;
  create(parentId: string, name: string, mimeType: string, props: Record<string, string>, data: Buffer): Promise<string>;
  get(id: string): Promise<DriveFile | null>;
  /** parentId の直下で、props がすべて一致し、ゴミ箱に入っていないもの */
  find(parentId: string, props: Record<string, string>): Promise<DriveFile[]>;
  updateMedia(id: string, mimeType: string, data: Buffer): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  download(id: string): Promise<Buffer | null>;
  /** 完全削除ではなくゴミ箱へ（ドライブ側で30日間は戻せる） */
  trash(id: string): Promise<void>;
}

/** ドライブ連携がない・切れている（ログインし直すと直る） */
export class DriveAuthError extends Error {}

// ---------------------------------------------------------------- 本物の Google Drive API

function multipart(metadata: object, mimeType: string, data: Buffer) {
  const boundary = `acctapp-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function googleBackend(getToken: () => Promise<string>, onUnauthorized: () => void): Backend {
  const FILES = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const FIELDS = 'id,name,parents,trashed,appProperties';

  const api = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      onUnauthorized();
      throw new DriveAuthError('Googleドライブの認証が切れました。');
    }
    return res;
  };
  const fail = async (res: Response, what: string): Promise<never> => {
    const body = await res.text();
    if (res.status === 403 && body.includes('accessNotConfigured')) {
      throw new Error('Google Cloud で Google Drive API が有効になっていません。');
    }
    throw new Error(`Drive ${what} failed: ${res.status} ${body}`);
  };
  const normalize = (f: Partial<DriveFile>): DriveFile => ({
    id: f.id ?? '', name: f.name ?? '', parents: f.parents ?? [], trashed: Boolean(f.trashed), appProperties: f.appProperties ?? {},
  });

  return {
    async createFolder(parentId, name, props) {
      const res = await api(`${FILES}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}),
          appProperties: { ...props, app: APP_TAG },
        }),
      });
      if (!res.ok) await fail(res, 'create folder');
      return (await res.json()).id;
    },
    async create(parentId, name, mimeType, props, data) {
      const { body, contentType } = multipart(
        { name, mimeType, parents: [parentId], appProperties: { ...props, app: APP_TAG } }, mimeType, data,
      );
      const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(body),
      });
      if (!res.ok) await fail(res, 'upload');
      return (await res.json()).id;
    },
    async get(id) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}?fields=${FIELDS}`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, 'get');
      return normalize(await res.json());
    },
    async find(parentId, props) {
      const conds = [`'${q(parentId)}' in parents`, 'trashed = false',
        ...Object.entries({ ...props, app: APP_TAG }).map(([k, v]) => `appProperties has { key='${q(k)}' and value='${q(v)}' }`)];
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL(FILES);
        url.searchParams.set('q', conds.join(' and '));
        url.searchParams.set('fields', `nextPageToken,files(${FIELDS})`);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await api(url.toString());
        if (!res.ok) await fail(res, 'list');
        const data = await res.json();
        files.push(...data.files.map(normalize));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return files;
    },
    async updateMedia(id, mimeType, data) {
      const res = await api(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': mimeType }, body: new Uint8Array(data),
      });
      if (!res.ok) await fail(res, 'update media');
    },
    async rename(id, name) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!res.ok) await fail(res, 'rename');
    },
    async download(id) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, 'download');
      return Buffer.from(await res.arrayBuffer());
    },
    async trash(id) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      });
      if (!res.ok) await fail(res, 'trash');
    },
  };
}

// ---------------------------------------------------------------- テスト用の擬似ドライブ

/** root の中に、ファイルの中身（<id>.bin）と情報（<id>.json）を置いて、ドライブと同じ振る舞いをする */
export function fileBackend(root: string): Backend {
  const metaPath = (id: string) => path.join(root, `${id}.json`);
  const dataPath = (id: string) => path.join(root, `${id}.bin`);
  const valid = (id: string) => /^[\w-]+$/.test(id);
  const read = async (id: string): Promise<DriveFile | null> =>
    valid(id) ? fs.readFile(metaPath(id), 'utf8').then((s) => JSON.parse(s) as DriveFile, () => null) : null;
  const write = async (f: DriveFile) => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(metaPath(f.id), JSON.stringify(f));
  };
  const newId = () => randomUUID().replace(/-/g, '');

  return {
    async createFolder(parentId, name, props) {
      const id = newId();
      await write({ id, name, parents: parentId ? [parentId] : [], trashed: false, appProperties: { ...props, app: APP_TAG } });
      return id;
    },
    async create(parentId, name, _mimeType, props, data) {
      const id = newId();
      await write({ id, name, parents: [parentId], trashed: false, appProperties: { ...props, app: APP_TAG } });
      await fs.writeFile(dataPath(id), data);
      return id;
    },
    get: read,
    async find(parentId, props) {
      const names = await fs.readdir(root).catch(() => [] as string[]);
      const all = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => read(n.slice(0, -5))));
      const want = { ...props, app: APP_TAG };
      return all.filter((f): f is DriveFile => !!f && !f.trashed && f.parents.includes(parentId)
        && Object.entries(want).every(([k, v]) => f.appProperties[k] === v));
    },
    async updateMedia(id, _mimeType, data) {
      if (await read(id)) await fs.writeFile(dataPath(id), data);
    },
    async rename(id, name) {
      const f = await read(id);
      if (f) await write({ ...f, name });
    },
    async download(id) {
      const f = await read(id);
      if (!f || f.trashed) return null;
      return fs.readFile(dataPath(id)).catch(() => null);
    },
    async trash(id) {
      const f = await read(id);
      if (f) await write({ ...f, trashed: true });
    },
  };
}
