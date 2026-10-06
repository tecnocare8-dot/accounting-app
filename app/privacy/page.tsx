import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'プライバシーポリシー | 会計アプリ' };

// 運営者名と問い合わせ先は環境変数で差し替える（Google の OAuth 同意画面の公開に必要なページ）
const OPERATOR = process.env.OPERATOR_NAME || '一般社団法人テクノケア';
const CONTACT = process.env.CONTACT_EMAIL;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-12 text-sm leading-relaxed">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>
      <p>
        {OPERATOR}（以下「運営者」）は、会計アプリ（以下「本アプリ」）での利用者の情報の扱いを、次のとおり定めます。
      </p>

      <Section title="1. 本アプリが受け取る情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>Googleアカウントのメールアドレスと名前（ログインのため）</li>
          <li>Googleドライブに帳簿を保存するための連携情報（暗号化して保管します）</li>
          <li>法人の名前と、Googleドライブに作った法人ごとのフォルダの場所</li>
        </ul>
        <p>運営者のサーバーに保管するのは、上の情報だけです。</p>
      </Section>

      <Section title="2. 帳簿の保存先">
        <p>
          仕訳帳・勘定科目・設定・変更履歴などの帳簿の中身は、利用者ご本人のGoogleドライブに保存します。
          運営者のサーバーには保存しません。
        </p>
        <p>
          Googleドライブへの権限は、本アプリが作ったファイルだけを扱える範囲（drive.file）に限っています。
          利用者がドライブに置いているほかのファイルは、見ることも変えることもできません。
        </p>
      </Section>

      <Section title="3. 利用の目的">
        <p>受け取った情報は、ログインと、帳簿をご本人のGoogleドライブに保存・表示するためだけに使います。広告や販売には使いません。</p>
      </Section>

      <Section title="4. 外部のサービスへの送信">
        <ul className="list-disc space-y-1 pl-5">
          <li>Google（ログイン、Googleドライブへの保存）</li>
          <li>Vercel（本アプリの公開）、Neon（上の1の情報の保管）</li>
        </ul>
        <p>これら以外の第三者に情報を渡すことはありません（法令にもとづく場合を除きます）。</p>
      </Section>

      <Section title="5. Googleのユーザーデータの扱い">
        <p>
          本アプリがGoogle APIから受け取った情報の利用と他のアプリへの転送は、
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API サービスのユーザーデータに関するポリシー
          </a>
          （限定使用の要件を含む）に従います。
        </p>
      </Section>

      <Section title="6. 連携の解除と削除">
        <p>
          Googleアカウントの「サードパーティ製のアプリとサービス」から、本アプリの連携をいつでも解除できます。
          運営者のサーバーにある情報（上の1）の削除を希望される場合は、下の問い合わせ先までご連絡ください。
          Googleドライブに保存した帳簿は、利用者ご自身のものとしてドライブに残ります。
        </p>
      </Section>

      <Section title="7. 問い合わせ先">
        <p>
          {OPERATOR}
          {CONTACT ? (
            <>
              <br />
              メール：<a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
            </>
          ) : null}
        </p>
      </Section>

      <p>制定日：2026年10月2日</p>
      <p><Link className="underline" href="/">会計アプリに戻る</Link></p>
    </main>
  );
}
