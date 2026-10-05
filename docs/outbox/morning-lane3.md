# 朝の報告（レーン3、2026-10-06）

夜間モード（2026-10-05 夜〜10-06 朝）。人間に聞かずに、spec に一番合う方を選んで進めた。選んだものは下の3と `docs/STATE.lane3.md` の「朝に見てほしい判断」にある。

**遅れの説明**：6時に書けなかった。22:24 JST の操作（下の3の1）から次の操作まで9時間あき（`gh api` の Date で確かめた。機械が眠っていたか、セッションが止まっていた）、作業に戻ったのが 07:38 JST だった。

## 1. 終わったもの

- **改名 `ludion` → `ludion-ai`**（PR #146、auto-merge）：
  - パッケージの名前、文書、サイトのページ、参照アプリのインストールの行、PUB と WEB のオラクルの対象、diver の案内の文字列、README の本文。コマンド名は `ludion` のまま。
  - ADR：docs/adr/2026-10-05-npm-name-ludion-ai.md。spec 本体は直さず、提案を docs/outbox/2026-10-05-spec-npm-name-ludion-ai.md に書いた。
  - 夜の間に入った main（#136〜#145）の上に rebase した。レーン2は自分の持ち物（トップページ、/mandate、demo-shop、README の冒頭）をもう `ludion-ai` にしていた。
  - WEB-12 と WEB-13 に、断られた名前（`ludion/…`）のページを捕まえる負の例を足した。
- **PUBLISH.md**（#146）：0.0.1 は出た。0.1.0 は本番の後に release.yml から出す。手で出す版はもう無い。Prevent self-review は使わない。
- **npm の Trusted Publisher のコマンド**（PUBLISH.md §6.1 と下の4）。
- **DEPLOY.md の §0「本番を立てる：上から順に」**（この PR）：ACM → 証明書 → DNS → 名簿と Card Host → ludion.ai を main から、の5段。各段に確かめるコマンドが1つずつある（`node scripts/prod-check.mjs <段>`。GET だけで資格情報を使わず、PowerShell でそのまま動く。`OK` か、直す場所つきの `NG` を出す）。速いテスト（`scripts/prod-check.test.mjs`、6件）で、各段の OK と、やり残しの形ごとの NG を確かめた。

## 2. PASS の数

- **PUB**：4 / 4 PASS（PUB-1〜4。手元、改名の後）。
- **LOOP**：4 / 5 PASS（LOOP-1、LOOP-3、LOOP-4、LOOP-5。手元）。LOOP-2 は FAIL：main の最新の push の実行（5dd4de4）は 5:13 で上限 10:00 の内だが、`preview-deploy` と `preview` が赤い（CI の preview のトークンにゾーン `ludion.ai` が見えるので、デプロイの前の境界の検査が止めている。検査は正しい）。
- 改名で触れたオラクル30件は全部 PASS（手元、rebase の後）：PUB-1〜4、WEB-2・3・5・7・10・12・13、ONE-1・4・8、DIV-1・5・7、GATE-1・3・13、PRS-5、MND-1〜5、DEMO-1、MSG-1、LOOP-1・5。`npm test` は 437 PASS / 0 FAIL（この PR を含む）。

## 3. 朝に見てほしい判断

1. **environment `npm` は設定してしまった。** 夜間モードの指示（「environment の設定はやらない」）は、設定の API の結果と一緒に届いた。PUT はその前、22:24 JST に終わっていた。そのあとは触っていない（確かめるための読み出しを1回だけ）。値は spec の3のとおり：Required reviewers `Ludion-ai`、Deployment branches は `main` だけ、Prevent self-review なし。要らなければ Settings → Environments → `npm` → Delete environment で消せる。ただし消すと release.yml が承認なしで動くので、消すなら作り直すまで release を起動しない。
2. **diver の案内の文字列（レーン1の持ち物）も改名に含めた。** `npx ludion revoke` などは、入れていない所では npm に無い `ludion` を探して失敗する。クイックスタート（WEB-10）は init の画面をページと照合しているので、ページだけ直すと WEB-10 が落ちる。変えたのは1語だけ。
3. **README の本文**（冒頭の後、「For an agent」の節から下）も改名した。冒頭はレーン2の持ち物で、もう `ludion-ai` だった。
4. **spec と CLAUDE.md は直していない**（ADR が優先）。spec を直す提案は outbox に置いた。
5. **DIV-5 と ONE-4 の題名の `npx ludion init` は残した**（レーン1のオラクル。検査の中身は新しい名前で通る）。
6. **DEPLOY.md の段1（ACM）だけは、確かめるコマンドが無い。** 契約は外から見えない。画面で「Order an advanced certificate」が押せることを見て、段2のコマンドが `OK` なら ACM も有効、と書いた。
7. **段2（証明書）の確かめは crt.sh（公開の Certificate Transparency の記録）を読む。** 画面より数分遅れることがある。crt.sh が答えないときは、画面の Active を見るように `NG` が言う。
8. **段5の出し直しは、今までの §1.5 のコマンド**（`site/edge` で `npx wrangler deploy --name ludion-site`）のまま。切り替え（§3）は 10-04 に済んでいたので、§3 の見出しに「済み」と書いた。

## 4. 人間待ち（押すボタンだけ。上から）

1. **Cloudflare：CI の preview のトークンからゾーンの権限を外す。** API Tokens → そのトークン → Edit → Permissions の Zone の行を全部消す（残すのは Account → Workers Scripts → Edit、Account Resources は `Ludion Agents` だけ）→ Update token。GitHub の secret はそのまま。これで LOOP-2 と CI の WEB-1 が動く。
   - トークンを作り直したときだけ、PowerShell で次の2行（値は聞かれたら貼る。画面にも履歴にも残らない）：
     ```powershell
     gh secret set CLOUDFLARE_PREVIEW_API_TOKEN --repo Ludion-ai/Ludion
     gh secret set CLOUDFLARE_PREVIEW_ACCOUNT_ID --repo Ludion-ai/Ludion
     ```
2. **npm：Trusted Publisher**（PowerShell、2段階認証。npm は 11.15.0 以上。この機械は 12.2.0）：
   ```powershell
   npm login
   npm trust github ludion-ai --repo Ludion-ai/Ludion --file release.yml --env npm --allow-publish
   npm trust list ludion-ai
   ```
3. **npmjs.com：** `ludion-ai` → Settings → Publishing access → 「Require two-factor authentication and disallow tokens」→ Update Package Settings。
4. **GitHub：** Settings → Environments → `npm` を見る（判断の1）。よければそのまま。
5. **GitHub：** Claude の権限を絞る（予定どおり）。
6. **本番を立てる：** docs/DEPLOY.md §0 を上から（ACM → 証明書 → DNS → 名簿と Card Host → ludion.ai）。各段の最後に `node scripts/prod-check.mjs <段>` が `OK` を出す。済んだら Claude に一言。LIVE-1〜3 を回して報告する。
7. **npm の 0.1.0：** 本番の後。版を上げる PR は Claude が作る。Actions → release → Run workflow（dry run → 承認 → 本番 → 承認）。PUBLISH.md §6.2。
8. （お金）Workers Paid にするか（DEPLOY.md §7.3）。

## 5. 次にやること（レーン3）

1. runbook.md を3つの問いと改名に合わせる（spec の9）。
2. preview のトークンが直ったら、LOOP-2 を main への push で3回測る（spec の8）。
3. 本番が立ったら LIVE-1〜3（spec の10）。
