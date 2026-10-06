import { readTable, toCsv } from './csv';

/**
 * 変更履歴。伝票の追加・修正・削除、取り込み、設定・科目の変更を、
 * 「いつ・誰が・何を・どうした」の形で、追記だけで残す（電子帳簿保存法の「訂正・削除の記録」に備える）
 */
export interface AuditEntry {
  at: string; // ISO 日時
  actor: string; // 操作した人（Googleアカウントのメール）
  action: string; // 追加・修正・削除・取り込み・設定の変更 など
  target: string; // 伝票の番号など
  targetId: string;
  detail: string;
}

const COLUMNS = ['日時', '操作した人', '操作', '対象', '対象ID', '内容'] as const;

export function auditToCsv(list: AuditEntry[]): string {
  return toCsv(COLUMNS, list.map((e) => [e.at, e.actor, e.action, e.target, e.targetId, e.detail]));
}

export function auditFromCsv(text: string): AuditEntry[] {
  const t = readTable(text);
  return t.rows.map((r) => ({
    at: t.get(r, '日時'), actor: t.get(r, '操作した人'), action: t.get(r, '操作'),
    target: t.get(r, '対象'), targetId: t.get(r, '対象ID'), detail: t.get(r, '内容'),
  })).filter((e) => e.at);
}
