import { accountMap, ACCOUNT_TYPE_LABEL, SEGMENT_LABEL, type Account } from './accounts';
import { guardText, toCsv } from './csv';
import type { GeneralLedger, TrialBalance } from './reports';

// 書き出し用の CSV（Excel で開く前提）

export function trialCsv(tb: TrialBalance): string {
  return toCsv(['コード', '科目', '種類', '期首残高', '借方', '貸方', '期末残高'],
    tb.rows.map((r) => [r.code, guardText(r.name), ACCOUNT_TYPE_LABEL[r.type], r.opening, r.debit, r.credit, r.closing]));
}

export function ledgerCsv(gl: GeneralLedger, accounts: Account[]): string {
  const map = accountMap(accounts);
  const name = (c: string) => (c === '諸口' ? c : map.get(c)?.name ?? c);
  return toCsv(['日付', '伝票番号', '区分', '摘要', '相手科目', '借方', '貸方', '残高'], [
    ['', '', '', '前期より繰越', '', '', '', gl.opening],
    ...gl.entries.map((e) => [e.date, e.number, SEGMENT_LABEL[e.segment], guardText(e.description), name(e.counter), e.debit || '', e.credit || '', e.balance]),
  ]);
}
