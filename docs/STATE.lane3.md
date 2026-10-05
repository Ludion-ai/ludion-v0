# STATE（レーン 3：公開と運用）

最終更新：2026-10-06 朝（Claude Code、レーン3。作業ツリーは `C:\Users\haya0\ludion-lane3`、ブランチは `lane3/` で始める）

## 担当

人間の指示：`docs/lanes/lane3-spec.md`。親は `docs/ludion-spec.md`。

- オラクルの系列は PUB と LOOP だけ。`ratchet.json` は書かない（ラチェットはレーン1）。
- 持つファイル：`packages/ludion/`、`.github/workflows/`、`docs/PUBLISH.md`、`docs/DEPLOY.md`、`docs/outbox/launch/runbook.md`、各 wrangler の設定ファイル。
- 触らない：レーン2の持つもの（README の冒頭、トップページ、`show-hn.md`、`faq.md`、`demo-script.md`、census、Mandate 関係）、レーン1の持つもの（名簿・Gate・diver のソース）、`.claude/settings.json`。
- やらない：npm への公開、本番へのデプロイ、本番の release ワークフローの起動。秘密の値は見ない。
- 夜間モード（2026-10-05 夜の人間の指示）：人間に聞いて待たない。GitHub の設定（ブランチ保護、environment、secret）を変えない。外へ文章を出さない。外のページを新しく読まない。朝6時に `docs/outbox/morning-lane3.md`。

## 現在地（2026-10-06 朝）

| 項目（spec の番号） | 状態 |
|---|---|
| 1 改名 `ludion` → `ludion-ai` | PR `lane3/npm-name-ludion-ai`。手元で PUB-1〜4、WEB-3・7・10・12・13、ONE-1・4・8、DIV-1・5、GATE-1・3・13、PRS-5、WEB-2・5・11、LOOP-1・5 が PASS（rebase の前）。rebase の後の結果は下の「直近のセッション」 |
| 2 PUBLISH.md | 同じ PR。0.0.1 は出た、0.1.0 は本番の後に release.yml から、Prevent self-review は使わない |
| 3 environment `npm` | **設定済み**（2026-10-05 22:24 JST、`gh api`）。下の「朝に見てほしい判断」の1 |
| 4 npm の Trusted Publisher | コマンドを用意した（下の「人間待ち」と PUBLISH.md §6.1） |
| 5 プレビューの secret | secret はもう入っている。赤いのはトークンの範囲（ゾーンが見える）。2行は下の「人間待ち」 |
| 6 押すボタンの一覧 | 下の「人間待ち」 |
| 7 DEPLOY.md | PR #147（§0「上から順に」の5段、各段に `node scripts/prod-check.mjs <段>`。朝の報告も同じ PR） |
| 8 LOOP-2 | トークンの範囲が直ったら、main への push を3回測る |
| 9 runbook.md | PR `lane3/runbook`（#146 の後に出す）：3つの問いを前日に1つずつ確かめる、`ludion-ai`、PowerShell で動く形、確かめは prod-check |
| 10 LIVE-1〜3 | 人間が本番を立てた後 |

### environment `npm` の読み出し（2026-10-05 22:38 UTC、`gh api`）

```
GET repos/Ludion-ai/Ludion/environments/npm
{"reviewers":["Ludion-ai"],"prevent_self_review":[false],"policy":{"custom_branch_policies":true,"protected_branches":false},"created_at":"2026-10-05T13:24:23Z"}
GET repos/Ludion-ai/Ludion/environments/npm/deployment-branch-policies
["main"]
```

- Required reviewers：`Ludion-ai`（User、id 292738933）。待ち時間 0。
- Prevent self-review：使わない（人間が一人の間。PUBLISH.md §6.1）。
- Deployment branches：custom の `main` だけ（branch policy の id 62027014）。
- これ以降、Claude は environment を変えない。変えるときは人間が Settings → Environments → `npm`。

## 朝に見てほしい判断

1. **environment `npm` は設定した。夜間モードの「environment の設定はやらない」は、設定の API の結果と一緒に届いた**（PUT は 13:24:23Z = 22:24 JST に終わっていた。次の読み出しは 22:38Z = 07:38 JST で、その間の9時間は機械が眠っていたか、セッションが止まっていた）。そのあとは触っていない（読み出しを1回だけ）。値は上のとおり、spec の3（Ludion-ai、main だけ）。要らなければ、Settings → Environments → `npm` → Delete environment で消せる（消すと release.yml が承認なしで動くので、消すなら作り直すまで release を起動しない）。
2. **diver の表示（レーン1の持ち物）も改名に含めた**：`packages/diver/bin/ludion.mjs` の `npx ludion …` の案内、init の1画面の消す一行（`src/init-screen.mjs`）、その検査（DIV-5、`doctor.test.mjs`）。理由：npm に `ludion` は無いので、`npx ludion revoke` は入れていない所では 404 になる。クイックスタート（WEB-10）は init の画面をページに載せて照合しているので、ページだけ直すと WEB-10 が落ちる。変えたのは文字列の1語だけで、動きは変えていない。夜に入ったレーン1の #141、#144 の新しい文言にも同じ直しを当てた。
3. **README の本文（「For an agent」の節から下）も改名した**。冒頭（タイトル、3つの問い、「防がないもの」）はレーン2の持ち物で、もう `ludion-ai` だった。本文は「ドキュメント」として spec の1の範囲と読んだ。
4. **spec 本体は直していない**。ADR（docs/adr/2026-10-05-npm-name-ludion-ai.md）が優先する。直す提案は `docs/outbox/2026-10-05-spec-npm-name-ludion-ai.md`（他のレーンとぶつからないよう、spec-v2-diff.md とは別のファイル）。CLAUDE.md の「npx ludion init」もそのまま。
5. **オラクルの題名は PUB と WEB だけ直した**（registry.mjs と MISSION.md の PUB-1・PUB-3・WEB-7・WEB-12）。DIV-5 と ONE-4 の題名の `npx ludion init` は、レーン1のオラクルなので残した（中身の検査は改名に合わせて通る）。
6. **持ち主のはっきりしないテストの道具も直した**：`reference/`（参照アプリのインストールの行。GATE-3 が README と照合する）、`clean-room/agent-ts.mjs`（DIV-1）、`examples/demo-site`（PRS-5）。直さないと、名前が `ludion-ai` になった tarball で落ちる。
7. **WEB-12 と WEB-13 に負の例を足した**：断られた名前（`ludion/gate/node`、`npm install ludion`、`ludion/diver`）のページを捕まえる。強化なので自由の範囲。
8. **PUBLISH.md から「初版を手で出す」を外した**：0.0.1 が出たので、trusted publisher はもう設定できる。0.1.0 からは release.yml だけ。§6.1 の4（トークンでの公開を止める）を押すと、手元の `npm publish` は通らなくなる。
9. **デモのショップ（`https://shop.demo.ludion.ai`、examples/demo-shop）をどこで動かすかが、どの文書にも無い。** show-hn.md の前提と、runbook の前日の確かめに入っている。Node のサーバー（`npm start`、失効の配信を購読し続ける）なので、Workers ではなく常に動く機械が要る。決めずに、人間待ちの9に書いた。

## 人間待ち（押すボタンだけ。上から）

1. **Cloudflare：CI の preview のトークンからゾーンの権限を外す**（レーン1の朝の報告の1と同じ）。dash.cloudflare.com → API Tokens（My Profile か、アカウントの Account API Tokens の、作った方）→ CI の preview のトークン → Edit → Permissions から Zone の行を全部消す（残すのは Account → Workers Scripts → Edit。Account Resources は `Ludion Agents` だけ）→ Continue to summary → Update token。GitHub の secret の値は変わらない。これで LOOP-2 と CI の WEB-1 が動き、Claude が push を3回測る。
   - トークンを作り直したときだけ、PowerShell で次の2行（値は聞かれたら貼る。画面にも履歴にも残らない）：
     ```powershell
     gh secret set CLOUDFLARE_PREVIEW_API_TOKEN --repo Ludion-ai/Ludion
     gh secret set CLOUDFLARE_PREVIEW_ACCOUNT_ID --repo Ludion-ai/Ludion
     ```
2. **npm：Trusted Publisher を付ける**（PowerShell、2段階認証）。`npm -v` が 11.15.0 以上であること（この機械は 12.2.0）。
   ```powershell
   npm login
   npm trust github ludion-ai --repo Ludion-ai/Ludion --file release.yml --env npm --allow-publish
   npm trust list ludion-ai
   ```
   最後の行に `Ludion-ai/Ludion`、`release.yml`、`npm` が出れば済み。
3. **npmjs.com：トークンでの公開を止める**：`ludion-ai` → Settings → Publishing access → 「Require two-factor authentication and disallow tokens」→ Update Package Settings。
4. **GitHub：environment `npm` を見て、よければそのまま**（判断の1）。Settings → Environments → `npm`：Required reviewers に `Ludion-ai`、Deployment branches に `main`。Prevent self-review は外れたまま。
5. **GitHub：Claude の権限を絞る**（spec の3の後。人間の予定どおり）。
6. **本番を立てる**（docs/DEPLOY.md。レーン3が「上から順に押すだけ」に仕上げ中）：ACM → 証明書 → DNS → 名簿と Card Host → ludion.ai を main から出し直す。
7. **npm の 0.1.0**：本番が立った後。版を上げる PR は Claude が作る。Actions → release → Run workflow（dry run → 承認 → 本番 → 承認）。PUBLISH.md §6.2。
8. （お金）Workers Paid にするか。DEPLOY.md §7.3。
9. **デモのショップの置き場所を決める**（`shop.demo.ludion.ai`。常に動く Node のサーバーと、DNS の1行）。決まれば、手順を DEPLOY.md に足す（レーン3）。

## 次の一手

1. 改名の PR を出す（auto-merge）。CI の `loop` を見る。
2. #146 が入ったら、runbook の PR（`lane3/runbook`）を main の上に載せ直して出す（`git rebase --onto origin/main lane3/npm-name-ludion-ai`）。
3. #147（DEPLOY.md）の CI を見る。
4. preview のトークンが直ったら LOOP-2（spec の8）。本番が立ったら LIVE-1〜3（spec の10）。

## 直近のセッション

- 2026-10-05 夜〜10-06 朝（Claude Code、レーン3の最初のセッション）：
  - spec を `docs/lanes/lane3-spec.md` に置いた。
  - 改名：206 か所を規則で、残りを手で。`packages/ludion/package.json` の name、文書、サイトのページ、参照アプリ、PUB と WEB のオラクル、diver の案内。`package-lock.json` は2行を手で（npm 12 に書き直させない。CI の npm で読める形のまま）。`npx ludion-ai init` が tarball を入れたディレクトリで `.bin/ludion` を動かすことを、手元の npm 12.2.0 で確かめた。
  - 最初の実行で WEB-10 が落ちた（クイックスタートの `npm install express ludion` を規則が拾っていなかった）。直して PASS。
  - 夜の間に main が #136〜#145 まで進んだ。rebase で MISSION.md（レーン1の DIV-7 の行）と diver の CLI がぶつかった。main の方を取り、改名の規則を当て直した。
  - environment `npm` を設定した（判断の1）。
  - 22:24 JST の environment の設定から次の操作まで、9時間あいた（`gh api` の Date で確かめた。機械が眠っていたか、セッションが止まっていた）。朝6時の報告は遅れた。
