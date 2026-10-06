// 画面からAPIを呼ぶ共通の処理。エラーのときは、APIが返した日本語のメッセージを ApiError にして投げる

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers = init.body && !isForm
    ? { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
    : init.headers;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let data: { error?: string; code?: string } = {};
    try {
      data = await res.json();
    } catch {
      // JSONでない応答（通信の途中で切れた など）
    }
    throw new ApiError(data.error ?? `エラーが起きました（${res.status}）。通信状態を確かめて、もう一度お試しください。`, res.status, data.code);
  }
  return res;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init)).json() as Promise<T>;
}

export async function apiBlob(url: string, init?: RequestInit): Promise<Blob> {
  return (await request(url, init)).blob();
}

export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

// 区切りだけ（表の中で使う。マイナスは△）
export const num = (n: number) => (n < 0 ? `△${(-n).toLocaleString('ja-JP')}` : n.toLocaleString('ja-JP'));
