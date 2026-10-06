import { type NextRequest } from 'next/server';
import { csvResponse, handle } from '@/lib/api';
import { loadBooks, reportRange } from '@/lib/books';
import { storeForUser } from '@/lib/entity-store';
import { ledgerCsv, trialCsv } from '@/lib/exports';
import { NotFoundError } from '@/lib/journal';
import { journalToCsv } from '@/lib/records';
import { generalLedger, trialBalance } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** CSV の書き出し：type=journal（仕訳帳）| trial（試算表）| ledger（総勘定元帳、code が要る） */
export async function GET(req: NextRequest) {
  return handle('export', async (userId) => {
    const q = req.nextUrl.searchParams;
    const books = await loadBooks((await storeForUser(userId)).store);
    const { year, range } = reportRange(books, q);
    const tag = `${year.start.slice(0, 4)}年度_${range.to}${range.segment ? `_${range.segment}` : ''}`;
    switch (q.get('type')) {
      case 'journal': {
        const list = books.journal.filter((v) => v.date >= range.from && v.date <= range.to && (!range.segment || v.segment === range.segment));
        return csvResponse(journalToCsv(list, books.accounts, books.settings), `仕訳帳_${tag}.csv`);
      }
      case 'trial':
        return csvResponse(trialCsv(trialBalance(books.journal, books.accounts, range)), `試算表_${tag}.csv`);
      case 'ledger': {
        const gl = generalLedger(books.journal, books.accounts, q.get('code') ?? '', range);
        if (!gl) throw new NotFoundError('科目が見つかりません。');
        return csvResponse(ledgerCsv(gl, books.accounts), `総勘定元帳_${gl.account.name}_${tag}.csv`);
      }
      default:
        throw new NotFoundError('書き出しの種類が正しくありません。');
    }
  });
}
