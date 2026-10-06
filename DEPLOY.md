# 会計アプリ 公開の手順

書類アプリ（document-app）と同じ形で公開します。上から順に行ってください。

## 1. GitHub
1. GitHub で新しいリポジトリ `tecnocare8-dot/accounting-app`（非公開）を作る
2. 手元から送る：`git remote add origin https://github.com/tecnocare8-dot/accounting-app.git` → `git push -u origin main`

## 2. Neon（データベース）
1. 新しいプロジェクト（例：accounting-db）を作る。書類アプリ・領収書アプリとは分ける
2. 接続文字列を2つ控える：プーリングあり（DATABASE_URL）と、なし（DATABASE_URL_UNPOOLED）
3. Preview 用にブランチを分けておくと、本番のデータに影響しない（書類アプリは共用になっているので注意）

## 3. Google Cloud（ログインとドライブ）
1. 書類アプリと同じプロジェクトで「OAuth クライアント ID」（ウェブアプリケーション）を新しく作る（名前：accounting-app）
2. 承認済みのリダイレクト URI：`https://<公開先>.vercel.app/api/auth/callback/google` と `http://localhost:3200/api/auth/callback/google`
3. スコープは書類アプリと同じ（openid・email・profile・drive.file）。同意画面のプライバシーポリシーは `https://<公開先>.vercel.app/privacy`

## 4. Vercel
1. GitHub のリポジトリを読み込んで新しいプロジェクト（accounting-app）を作る
2. 環境変数（.env.example を参照）
   - DATABASE_URL・DATABASE_URL_UNPOOLED（Neon）
   - GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET（3で作ったもの）
   - NEXTAUTH_SECRET（`openssl rand -base64 32`）・NEXTAUTH_URL（公開先のURL）
   - **ALLOWED_EMAILS**：使う人の Google アカウント（カンマ区切り）。会計の帳簿なので必ず入れる
3. 公開する（build のときに DB の表が作られる）

## 5. 確かめる
1. 公開先を開いて Google でログイン → 法人を作る（一般社団法人テクノケア・決算月・帳簿を付け始める日）
2. Google ドライブに「会計_一般社団法人テクノケア」のフォルダと5つのファイルができていること
3. 期首残高 → 仕訳を1つ → 帳簿の試算表で借方と貸方が合うこと

## 手元での確認
- `npm run dev`（ポート3200）。`.env` に `DRIVE_FAKE_DIR=./fake-drive` を入れると、Google ドライブの代わりに手元のフォルダを使う
- ログインの代わり：`node --env-file=.env scripts/dev-session.mjs` で出た値をブラウザの開発者ツールで実行
- 自動テスト：`npm test`。API の通し確認：`npm run build && npx next start -p 3200 &` → `E2E_BASE=http://localhost:3200 node --env-file=.env scripts/e2e-local.mjs`

## Stripe との連携（段階2）
1. Stripe のダッシュボード →「開発者」→「API キー」→「制限付きのキーを作成」
2. 権限は次の6つを「読み取り」に（ほかは「なし」）：Balance、Balance Transaction Sources、Charges、Checkout Sessions、Invoices、Payouts
3. 会計アプリの設定 →「Stripe との連携」に rk_live_ で始まるキーを貼る（暗号化して Neon に保存。sk_ は受け付けない）
4. 取り込み →「Stripe」→ 期間を選んで読み込む。銀行の明細では、Stripe からの振込の摘要の規則を「取り込まない」にしておく
