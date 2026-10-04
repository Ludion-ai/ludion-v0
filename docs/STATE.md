# STATE

最終更新：2026-10-04 夕方（Claude Code、1本目のレーン。実装の順の1〜7、ローンチの条件、人間の「全部許可する」を受けて MCP-1 の案 C、件名、README）

## 現在地

- **spec の正は、リポジトリの `docs/ludion-spec.md`（v2.0.1）**（ADR-035）。v1.0.1 は捨てた。人間が承認した修正だけを spec に入れ、他の食い違いは outbox に書く。芯は「AI にアカウント（鍵と名札）を持たせる」。spec と食い違う所は `docs/outbox/spec-v2-diff.md`。
  - v2.0 のオラクル16件（ONE-1〜5、MCP-1、PUR-1〜6、PRIV-4、PRIV-5、REG-5、BLK-1）は PENDING。新しい段 M9（一点）。
- 段：M4（SCAN-1〜4、RPT-1）は完了。
  - M0：LOOP-2（CI を10分以内）だけが残り。
  - M1：残りは STD-3、GATE-9（GATE-8 は案 A で PASS）。
  - M2：DIV-2/3/4 と PUB-1/2/3 まで（DIV-1 が残り）。
  - M3：REG-2/4 まで。
  - M5：PRS-1〜4、NEUT-1/2、CRY-1 まで。
- 2026-10-03 から、レーンは2本（人間の指示）。ぶつからないように担当を分けている。
  - **1本目**（このファイル、作業ツリー `C:\Users\haya0\ludion`）：GATE-8 → CI を10分以内（B1、LOOP-2）と夜間のジョブ → npm の公開の仕組み → `@ludion/gate-*` の公開。夜間のジョブ（Windows）の面倒も見る。
  - **2本目**（`docs/STATE.lane2.md`、作業ツリー `C:\Users\haya0\ludion-lane2`）：tracecheck.dev の計測、ローンチの文書（README、クイックスタート、/scan のサンプル）。
  - プレビューは1つを2本で共有する。どちらかが出し直すと、もう片方の手元の WEB-1 は「古い」で落ちる。
  - 夜勤（`C:\Users\haya0\ludion-night`、`.loop/NIGHT.md`）は 2026-10-01 08:48 に終わった。もう動かない。
- **サイト**：プレビュー https://ludion-site-preview.ludion-agents.workers.dev （エージェント用のアカウント `Ludion Agents`、WEB-1 PASS）。本番（ludion.ai）への切り替えは人間（docs/DEPLOY.md §3）。
  - **Claude はプレビュー以外にデプロイしない**（2026-10-01、人間の決定）。本番への最初のデプロイ、ludion.ai の付け替え、DNS、旧資源の削除は人間がやる。
  - エージェントのトークン（`~/.config/ludion/cloudflare.env`）は `Ludion Agents` にしか効かない。本番のアカウントは読み取りでも 403（DEPLOY.md §5.3）。
  - `npm run deploy:preview` は、デプロイの前に毎回この境界を確かめ、外れていれば止まる（DEPLOY.md §2）。
- ループの仕組みは Linux/Node 22 と Windows/Node 24 の両方で回る。Windows は夜間（03:00 JST）だけ。
- リポジトリは https://github.com/Ludion-ai/Ludion （public）。main は保護されている：PR 必須、`loop` チェック必須、enforce_admins、auto-merge 可。strict は 2026-10-03 に人間が外した（main に追従しなくてもマージされる）。
  - push と PR の CI：`loop-shard (1/4)`〜`(4/4)`（`loop` のオラクルを4つに分けて並列）、`loop`（必須。分割を統合して、ベースのラチェットで判定）、`preview`（プレビューに出してから WEB-1。人間が secret を登録するまで赤。人間待ち）。
  - 夜間（schedule と手動の workflow_dispatch）：`nightly-windows`（同じ `loop` を Windows/Node 24 で）、`nightly`（LOOP-2：main の最新の push の実行を測る）。
  - ラチェット済みのオラクルは PASS 以外すべて退行（LOOP-4）。読めないベースは止まる（LOOP-3）。
- 数字は `npm run scoreboard` が正。ここには書き写さない。

## いまやること（spec v2.0.1 §9 磨く一点、§20.2 ローンチの条件。人間の順、2026-10-03）

**一点**：1行で、AI が自分の鍵と名前を持つ。MCP でも Web でも同じ名前で通じる。1行で、世界中から消せる。Gate は、この名札を読む受け口（spec §9、ADR-029）。ローンチは 2026-10-13 22:00 JST（Show HN）。

**実装の順**（それぞれ別の PR。上から）

1. ✅（#92）**決定4と PRIV-4**（ADR-038）：Gate から外に出すのは1時間ごとの集計だけ。来訪ごとの記録はサイトの中に7日。不変条件15の違反を先に消す。
2. ✅（#93、#94）**決定2のパッケージ化**（ADR-036）と **init の1画面**：
   - `ludion` 1本に CLI と `ludion/gate/{next,node,workers}`、`ludion/diver` を束ね、PUB-1〜4 をその形に。
   - 1画面には Web と MCP の例、revoke の一行、バッジ、任意の1問。
   - オラクルも足す。「断ったら何も送らない」を含める。
3. ✅（#95）**決定6の設定と PRIV-5**（ADR-041）：本番の名簿（`registry.ludion.ai`）と Card Host（`*.agents.ludion.ai`）の Workers の設定、docs/DEPLOY.md の手順。デプロイは人間。
4. ✅（#96、案 C の PR）**MCP-1**（ADR-039）：Keycloak は CI の別ジョブ `mcp` で並列に回し、LOOP-2 の10分に入れない。
   - e2e と負の対（MCP-2）。Keycloak 26.8.0 が名札の `web_bot_auth` と `ludion` を読めずに拒む（keycloak/keycloak#51236）ので、人間の許可で MCP の client_id を `…/client`（拡張のない CIMD）に分けた。MCP-1、MCP-2 PASS。
5. ✅（#97）**ONE-1・ONE-2・ONE-3・BLK-1・ONE-5**。
   - ONE-1：自動化の最初の1件を記録した時に、サイトのコンソールに1行（`announce`）。npm install から、その1行まで：Express 1.5 秒、Next.js（`next dev`）3.8 秒（手元、3回の中央値）。
   - ONE-3・BLK-1：`decisions`（`who`／`action`：allow・wall・block／`scope`：writes・経路／`until`：日時）と、経路の `"writes": false`。通す・壁・止めるは設定の1行で効き、消せば戻る。止めると `403 blocked_by_site`。
   - ONE-2・ONE-5（サブエージェントが作った）：朝のレポートの見出しは「署名で名乗った割合」1つ、決めることは1つ。クローラーを名乗る送信は「偽物の疑い」。
6. ✅（#98）**PUR-1〜6**：`Ludion-Purpose`（read／act と一文）。署名で覆われた時だけ本人の言葉。read と言って書いたら矛盾。一文は Gate の外に出ない（サイトの記録に7日）。diver は個人の情報を含む一文を送らない。`purpose_required` には一度だけ出し直す。レポートは一文をエスケープし、リンクにならない形（`hxxps[:]//`、`[.]`、`[at]`）で出す。
7. ✅（この PR）**日本語の README**（`README.ja.md`）。spec v2.0 §9 の一点に沿って書いた。英語の README（レーン2の担当）は v1 のまま（Ballast と Mandate を前に出している）。

あいだに入れるもの：済み。GATE-13（GATE-3 の負の対。#90 の WEB-10 はレーン2の WEB-11 と重なるので落とした）、DIV-1 の setup-python と STD-3（#99）、gitleaks（SEC-1、#99）、ONE-4（#99）、REG-5（名簿の丸ごと配布）、対のない正のオラクルに負の対（ONE-6、ONE-7、PUR-7）。

**切る線**

- 10/10 の終わりに MCP-1 が PASS していなければ、HN のタイトルと本文から MCP を外す。
- 10/11 の終わりに PUR-1・2・3・5 が PASS していなければ、ローンチでは目的の申告に触れない。

**毎日の終わり**：PASS の数と残りを1行で人間に報告する。

**ローンチの条件（§20.2）**。全て満たすまで出さない。

- [ ] scan のサンプル（ludion.ai/scan）：WEB-4。プレビューでは動く。ludion.ai への切り替えは人間（DEPLOY.md §3）。
- [x] `npx ludion init` から VERIFIED まで3分以内（新しい環境で3回）：DIV-1、ONE-4（#99。手元で TS 3.4 秒、Python 5.8 秒、拒否からの道 5〜8 秒）
- [x] client 文書の URL が MCP の client_id として通る：MCP-1（案 C、Keycloak 26.8.0）
- [ ] tracecheck.dev の7日分のデータ：PILOT-2（レーン2。デプロイと読み取りのトークンは人間）
- [ ] README（日英）、ドキュメント、security@ の受信（受信は人間）。README は日英とも v2.0 §9 の一点に合わせた（この PR）。security@ の受信は人間。
- [x] git の秘密情報が0件（gitleaks）：SEC-1（#99）
- [ ] npm に `ludion` を公開済み（初版は手で、2版目から Trusted Publishing）

**一点の外で続いていること**

- LOOP-2：push の実行は 4:14〜4:37。FAIL の理由は `preview` ジョブが赤いことだけ（secret と測り方の決めは人間待ち）。
- 棚上げ（再開は人間の判断）：A と B2（`fast-loop-shelf`）、GATE-9（PHP の道具待ち）。

### やらない（§9.5 の凍結。稼働 Gate 300 まで。画面と宣伝からは消すが、コードは捨てない）

- Ballast（保険・保証）、Mandate の同意画面、Depth の段階（D2〜D4）、Glass の公開ログ
- 言行一致の格付けの公開、おとりサイトの網、スクレイピング対策
- 全サイトで共有するブロックリスト、1画面を超えるダッシュボード
- マイナンバー連携、フォームの勝手口（WebMCP）、ブラウザ標準への提案
- 「止める」機能への課金
- tracecheck.dev の宣言台帳と罠の道は、製品の機能ではなく、HN に出す数字として続ける（レーン2）。
- ほかに §26 の「やらないこと」：独自の暗号、ウォレット、決済のプロトコル、CDN、検知エンジンで大手と戦うこと、Ludion のサーバーから止めること、`note` を機械に読ませること、信用を売ること、保険の引受。

### いつもの決まり

- **待ち時間を減らす決まり**（人間、2026-10-03）：
  1. 必須は `loop` だけ。Windows は待たない（夜間のジョブ。担当は1本目）。
  2. strict は外した。マージの後の main の CI が赤になったら、それを最優先で直す（ラチェットが守る）。夜間のジョブの赤も同じ。
  3. PR はまとめる。関連する変更は1本にし、1つのレーンで同時に開く PR は2本まで。
  4. auto-merge を付けたら、CI を待たずに次の仕事に進む。結果は次の区切りで見る（`gh pr checks`、main の `gh run list --branch main`、夜間の `gh run list --event schedule`）。

- **プレビューのデプロイ**：`npm run deploy:preview` だけ。ホームの差し替えなどの回避策は要らない（2026-10-01 11:00 にやめた）。
  - 資格情報は `~/.config/ludion/cloudflare.env`（`Ludion Agents` のトークンと Account ID）。登録フォームの通知先は `~/.config/ludion/signup.env` から、デプロイと一緒に入る。
  - `npx wrangler secret put` を手で使わない。wrangler は `cloudflare.env` を読まないので、ターミナルの別の資格情報で別のアカウントに入れてしまう。
  - Claude はプレビュー（`ludion-site-preview`）以外にデプロイしない。本番、ludion.ai の付け替え、DNS、削除は人間。
- **WEB-1 の注意**：WEB-1 はラチェット済み。サイト（`site/` の下のファイル。`site/deploy.mjs` も含む）を変えたら、プレビューを出し直すまで、手元の scoreboard では WEB-1 が「古い」で落ちる。CI では `preview` ジョブがデプロイしてから回す（`loop` では ELSEWHERE）。
  - プレビューは1つなので、別のブランチのビルドで出したあとは、手元の WEB-1 が落ちる。PR の前に、そのブランチで出し直してから scoreboard を回す。
- GATE-7 に攻撃を足すときは、JSON に `classes`（spec §10.8 の分類）を書く。

- 新しい ADR には番号を付けない。`docs/adr/YYYY-MM-DD-<slug>.md` にする。
- GATE-7 に攻撃を足したら `node accept/conformance/export.mjs` を回す（GATE-10）。STD-2 にテストを足したときも同じ。
- 同じ作業ツリーで、複数のセッションを動かさない（2026-10-01 朝の事故）。
- 揺れるオラクルは、壊れているのと同じ扱い（人間の決定、2026-10-02）。赤を無視する癖を作るから。閾値は下げず、測り方（中央値、単独で回す、Windows で回さない、共有の状態を壊さない）を直す。
- オラクルどうしで共有する状態（参照アプリのキャッシュなど）を、別のオラクルが書き換えたまま去らない。使う側は、使う前に中身が完全かを確かめる。
- 秘密のファイルはリポジトリの外（`~/.config/ludion/`）に置く。`*.env` は `.gitignore` にある。

## 人間待ち

- [x] **判断（朝のレポートのメールの件名）**：2026-10-04、人間の許可で、件名も見出しの数字1つにした（RPT-1 の件名の検査も合わせた）。
- [x] **ludion.ai のトップの文面**：spec v2.0 §9 の一点に書き直した（英日。PR `site/one-point`）（2026-10-04、人間の「全部許可する」で確定）。
- [x] **判断（MCP-1）**：2026-10-04、人間が「全部許可する」。案 C にした：MCP の client_id は拡張のない CIMD（`<origin>/client`）、`/card` は Web Bot Auth の名札のまま。spec v2.0.2（§11.2、§13.1、§9.3、§23.4）、docs/adr/2026-10-04-mcp-client-document.md。Keycloak 26.8.0 で MCP-1、MCP-2 が PASS。keycloak/keycloak#51236 には、再現つきのコメントを投稿した（https://github.com/keycloak/keycloak/issues/51236#issuecomment-5977718433）。
- [x] **spec v2.0 の判断**（2026-10-03）：決定1〜9（ADR-035〜039、041、042）。spec v2.0.1 と CLAUDE.md の芯を直した。
- [ ] **本番の名簿と Card Host のデプロイ**（ADR-041）：設定と手順はできた（docs/DEPLOY.md §6。鍵は `node services/registry/bin/keygen.mjs`、秘密はデプロイと同じ一回で入る）。デプロイ、鍵の保管、`*.agents.ludion.ai` の証明書（2段目のワイルドカード、お金の判断、§4）は人間。
- [ ] **npm の初版**：`ludion` の1本（ADR-036、実装の順の2のあと）を、人間が手で出す。2版目から release ワークフロー。
- [x] **判断（LOOP-2 と `preview` ジョブ）**：案 B（2026-10-04、人間の「全部許可する」で確定）。`preview` は main への push の後だけで回し、WEB-1 の Lighthouse を分ける。実装は secret が入ってから（Claude）。それまで LOOP-2 は `preview` の赤で FAIL のまま。
- [ ] **CI の `preview` ジョブの secret**（人間がトークンを作って登録すると決めた）：`CLOUDFLARE_PREVIEW_API_TOKEN`（`Ludion Agents` の Workers Scripts の編集だけ）と `CLOUDFLARE_PREVIEW_ACCOUNT_ID`。登録したら、`preview` を main の必須チェックに足す。それまで `preview` は赤で、WEB-1 は CI で強制されない（前も SKIP で強制されていなかった）。
- [x] 確認（#69、2026-10-02 に人間が確認）：ルートの重なりの読み。「一番厳しいものが勝つ」を、一致する全てのルートの最高の Pressure と、要件の全部を合わせる（Depth は最大、Ballast、scope は全部）と読んだ。一つを選ぶより厳しくなる場合がある。この読みで正しい（Pressure と Depth は最大、Ballast はどれかが求めれば必須、scope は全部）。
- [x] 確認（#71、2026-10-02 に人間が確認）：「上限付きの Mandate を受け付けない」を、数える上限（`per_day`）のある Mandate の決済を拒否する、と読んだ。`checkout_max` と通貨は記録なしでどの Gate でも効く。正しい。加えて、期間の中で累計する上限（1日の合計金額など）も記録が要り、無ければ拒否。v0 が強制できない上限は、記録があっても拒否する（`unenforceable_limit`、PRS-3）。
- [x] Codex の検証器の監査（10件）：全部採用。#69（5、6、7、8）、#70（1、2、3、9、10、対の意味）、#71（4）、#73 と #76（4 の実装の CI で見つけたバグ）。追加のオラクル案7件も採用（LOOP-3、LOOP-4、STD-5、PRS-3、GATE-11、GATE-12、PRS-4）。
- [x] 判断（GATE-8）：2026-10-01 朝、人間が案 A を条件付きで承認した。2026-10-03 に入れた（条件 a：2件の nonce は別々、条件 b：1時間の nonce の攻撃2つを GATE-7 に足して PASS。docs/adr/2026-10-01-real-chatgpt-agent-signs-for-an-hour.md の「実施」）。
- [x] **エージェント用の Cloudflare アカウントへ移す**（DEPLOY.md §5.2 の 1〜4）：2026-10-01 11:00。プレビューは https://ludion-site-preview.ludion-agents.workers.dev 、WEB-1 PASS。境界は §5.3。
- [ ] **移したあとの後始末**（DEPLOY.md §5.2 の手順 5、人間）：
  - 本番のアカウントの `ludion-site-preview`（前のプレビュー）を消す。通知先の秘密が入っているので、残すとそのフォームからも通知が届く。エージェントのトークンではもう見えない。
  - 古いトークン 2 本の失効を、ダッシュボードで確かめる。ターミナルの「前からある方」は 11:05 に 401 を返した（失効したと見える）。09:00 に置いたものは確かめられない。
  - Claude を起動したターミナルの窓を閉じる（環境変数に古いトークンの値が残っている）。
  - wrangler のログインは 11:05 に消えていた。済み。
- [ ] **`privacy@ludion.ai` でメールが届くようにする**（Cloudflare の Email Routing、人間がやる）。登録フォームの告知が、削除の宛先として案内している。
- [ ] **ludion.ai を新しいサイトに切り替える**（docs/DEPLOY.md §3、15分、クリック単位）。旧は Worker `ludion` のカスタムドメイン。`ludion-site` を作って付け替える。
- [ ] **旧資源の削除**（docs/DEPLOY.md §1.3、Ludion の16件だけ）。消す前に：
  - 提供元で秘密を失効させる：`ludion-api` の OpenAI と楽天のキー、`ludion-fallback-relay` の `PROVIDER_API_KEY`、`ludion` の GitHub OAuth アプリ。Worker を消してもキーは生きている。
  - D1 3つ、KV 2つ、R2 2つの中身を書き出す。提出物や登録者の情報なら、残すか消すかを決める。
  - `chat-app-relay`（Worker）は Ludion のものか判断できなかった。リストに入れていない。
- [x] ~~**npm の publish**（docs/PUBLISH.md、人間が 2026-10-01 にやると言った）~~ → ADR-036 で置き換え（`ludion` の1本だけ。上の「npm の初版」）。下の2行は旧い前提
  - **`ludion` だけを先に出せる**（#75、PUB-3）：tarball が CLI のコードを同梱し、`@ludion/*` が npm に一つもなくても入る。組織 `@ludion` も要らない。手順は PUBLISH.md §0.5。
  - `@ludion/gate-*` は、セキュリティの4件（#69）が入ったので出せる状態。出すかは人間の判断。出すときは先に組織 `ludion` を作り、表の順に出す。
  - **2版目からは release ワークフロー**（PUB-4、PUBLISH.md §6）：最初の版を手で出したあと、パッケージごとに trusted publisher を設定し、GitHub に environment `npm`（承認者＝人間、Prevent self-review、main だけ）を作る。手順は §6.1。
  - 注意：Claude の `gh` は人間と同じアカウント `Ludion-ai`。environment の承認の関所は、同じアカウントのトークンからは区別できない。切り離すなら、Claude に別のアカウントか、Actions の承認ができない細かいトークンを渡す（PUBLISH.md §6.1）。
- [x] **main のブランチ保護の strict**：2026-10-04 に API で外した（`required_status_checks.strict: false`、必須は `loop` だけのまま）（2026-10-04、人間の「全部許可する」で確定）。
- [ ] npm `ludion` と `@ludion`、PyPI `ludion` の確保（2026-09-30 時点で全て空き。匂わせ投稿の前に）
- [x] リポジトリの公開設定の判断 → public、`Ludion-ai/Ludion`（2026-09-30）
- [x] main のブランチ保護：PR 必須、`loop` チェック必須、auto-merge 許可（2026-09-30。strict と enforce_admins も付けた）
- [x] `CLOUDFLARE_API_TOKEN`：2026-10-01 朝、前からあるトークンが通るようになった。プレビューのデプロイ（WEB-1）に使った。LIVE-1（canary）はまだ。
- [x] 旧 Ludion の Cloudflare 資源の棚卸し：2026-10-01 09:03、`node scripts/cf-inventory.mjs`（GET だけ）。結果は docs/DEPLOY.md §1.3。
- [ ] 判断（お金）：Card Host の `*.agents.ludion.ai` は2段目のワイルドカードで、Universal SSL の範囲外。
  - 選択肢：Advanced Certificate Manager（有料）、名前を `dvr-….ludion.ai` に寄せる（spec の変更）、別のドメイン。
  - 詳細は docs/DEPLOY.md 4。
- [ ] `SIGNUP_WEBHOOK_URL` → LP の登録通知（Discord の incoming webhook）
  - プレビューには入っている（`~/.config/ludion/signup.env` から、デプロイと一緒に。DEPLOY.md §2）。試しの送信はしていない。
  - 本番の `ludion-site` には、人間が DEPLOY.md §3 の手順 1 で入れる。
  - 無いあいだ、デプロイしたフォームは「送信できませんでした」と答える（503）。受け取ったふりはしない。
- [x] 判断：WEB-8 は、プレビューに出す成果物を手元の workerd で動かして測る読みで PASS とする（2026-10-04、人間の「全部許可する」で確定）。
- [x] 登録フォームの文面：2026-10-01 に人間が承認した（保存は「先行登録のご案内が終わるまでか、削除のご依頼を受けるまで」、削除の宛先は privacy@ludion.ai）。
- [x] 登録フォームの文面：2026-10-01 に承認済み（上）。メモは閉じた。
- [ ] 商標の調査（区分 9、42、45）
- [ ] （任意）見込み客の了承を得た本物のアクセスログ。scan のコーパスは今は合成データだけ。本物が 1 本あれば、それが一番良い次のフィクスチャになる。`accept/fixtures/logs/` に入れる前に匿名化の方針を決める。
- [x] 判断：fail_mode "closed" の拒否は、v0 では `signature_required`（401）のまま。専用のコード（503 `gate_unavailable`）はローンチの後に見直す（2026-10-04、人間の「全部許可する」で確定）。
- [x] 判断：GATE-1 の「一貫した改名」を許す読みを、「バイト単位で一致」として認める（2026-10-04、人間の「全部許可する」で確定）。
- [x] 判断：日次レポートの記録に `operator` を足した（#97。1時間の件数には前からある。外に出るものは増えていない）。
- [ ] 日次レポートの送信基盤：送信サービス、送信ドメイン、SPF/DKIM/DMARC、配信停止。`ludion report` は中身を作るだけで、送信はしない。
- [x] GATE-9 の道具：`@php-wasm/node` をテストだけの依存に足してよい（2026-10-04、人間の「全部許可する」で確定）。GATE-9 自体は Claude のバックログ（ローンチの範囲の外）。
- [x] 判断：STD-4 は今のまま（issue の文面を出力に載せるだけ。CI から公開の issue は立てない）（2026-10-04、人間の「全部許可する」で確定）。
- [x] 判断（Mandate v0）：Mandate は spec v2.0 §9.5 で凍結中。今の実装（上限超えは `mandate_scope`、同意のときだけ `aud` を聞く、カテゴリの Mandate）のまま、凍結を解く時に見直す（2026-10-04、人間の「全部許可する」で確定）。
- [x] 判断：nonce なしの同一署名の再送は SPOOFED のまま（安全側）。`requireNonce` は既定にしない（2026-10-04、人間の「全部許可する」で確定）。
- [x] 本番公開の前の `/e/<code>` と `/gate` の文面：承認（2026-10-04、人間の「全部許可する」で確定）。