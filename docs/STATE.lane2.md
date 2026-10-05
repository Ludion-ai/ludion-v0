# STATE（レーン 2）

最終更新：2026-10-05 深夜（Claude Code、レーン 2。作業ツリーは `C:\Users\haya0\ludion-lane2`、ブランチは `lane2/` で始める）

## 担当（2026-10-05 から）

人間の指示：`docs/lanes/lane2-spec.md`（レーン2 spec「3つの問い：誰か・何をしていいか・どう止めるか」）。親は `docs/ludion-spec.md`。食い違ったら親が正しく、食い違いは `docs/outbox/` に書く。

| 期限（JST） | PASS させるもの |
|---|---|
| 10/10 23:59 | MND-1〜4、DEMO-1、CEN-1・2 |
| 10/11 23:59 | MSG-1（文面の書き換え） |
| 余裕があれば | MND-5（SDK の側のシートベルト） |

- 境界（spec §2）：オラクルの系列は MND・DEMO・CEN・MSG だけ。`ratchet.json` は書かない（ラチェットはレーン1）。レーン1の持つファイル（DEPLOY.md、PUBLISH.md、runbook、名簿の保存（LEAK-1）、CI）は触らない。gate-core・registry・diver の既存ファイルは最小の差分。毎日 main を取り込む。
- 外に出す文章は `docs/outbox/` に下書きまで。出すのは人間。
- **レーン3**（2026-10-05 夜、`docs/lanes/lane3-spec.md`、作業ツリー `C:\Users\haya0\ludion-lane3`）：公開、運用、`ludion-ai` への改名。npm の `ludion` は似た名前の検査で断られ、`ludion-ai` になった。コマンド名（bin）は `ludion` のまま。
  - 人間の指示：**レーン2は自分の持つファイルの中だけ `ludion-ai` に合わせる**（`npx ludion-ai …`、`import … from "ludion-ai/…"`）。他のファイルはレーン3が変える。
  - 合わせたもの：`/e/mandate_required`・`/e/mandate_scope`（英日）、CLI の `mandate list` の案内、ADR。これから書く demo-shop、README の冒頭、トップページ、show-hn、faq、demo-script、census も `ludion-ai` で書く。
- 毎日の終わりに1行で報告：レーン2の系列の PASS の数と残り。
- 前の担当（tracecheck.dev の計測、ローンチの文書）は区切りまで終えて main に入っている（#81〜#84、#88、#89）。残りは人間待ち（下）。

## §3.1 の確認（2026-10-05、main 28a84b9 の上で）

あるものは使い、無いものだけを作る。

1. **Gate は Mandate を検証し、scope で拒否するか**：する。
   - 検証（`packages/gate-core/src/mandate.mjs` の `verifyMandate`）：名簿の鍵の署名と typ、`sub` と Staple（要求の鍵に縛られている）、`aud` と要求のオリジン、`exp`、取り消し（失効の一覧と Staple の `mrev`）。
   - 拒否（`classify.mjs` の `decideRoute`）：Pressure 2 以上で `require.scope` のある経路に、有効な Mandate が無ければ 403 `mandate_required`、範囲の外なら 403 `mandate_scope`。経路が重なれば scope は全部（PRS-4）。
   - `aud` 違い・期限切れ・取り消し済み・Staple なし → Mandate なし（403 `mandate_required`）。
   - **spec と違うところ**：
     - `sub` 違い（別の Diver の Mandate を運ぶ）と偽造は SPOOFED（401 `invalid_signature`）。PRS-2（ラチェット済み）がこの答えを固めている。spec の MND-3 は 403 `mandate_required`。→ 人間待ち（下）。
     - `prn` は `pw-` で始まるものしか読まない。`"self"` は不正（SPOOFED）になる。→ 足す。
     - `per_day` は決済（`charge()`）の回数で、共有の記録（ledger）で数える。記録の無い Gate は、`per_day` 付きの Mandate の決済を `mandate_scope`（`no_shared_ledger`）で拒否する（PRS-3、人間が 10-02 に確認）。検査の段で拒否すると PRS-3 が落ちる（理由を charge の応答で見ている）。
     - `checkout` の Mandate は1回の上限（`checkout_max`）と通貨を持つ（無ければ名簿が拒否し、Gate は不正とする）。
2. **名簿は Mandate を発行できるか。失効のストリームは jti を運べるか**：
   - 発行：できるが、利用者のパスキーの同意（`POST /v0/mandates`、WebAuthn）だけ。**運営者が Root 鍵で発行する道は無い**。→ 作る。
   - 失効のストリーム：運べる（`scope: "mandate"`、`mdt: [jti]`）。購読していない Gate には Staple の `mrev`（最大32件）で届く。取り消しは利用者のパスキーだけ。→ Root で取り消す道を作る。
3. **diver の SDK は `Ludion-Mandate` を付けて、署名の対象に含めるか**：含める（`createDiverSigner({ mandate })`、`sign.mjs`）。ただし `mandate()` は要求を知らないので、どのサイトにも同じ Mandate が付く。CLI に Mandate のコマンドは無い。→ サイトごとに選べるようにし、CLI を足す。
4. **SDK の実行時に Root 鍵を読み込んでいないか**：SDK の関数（`createDiverSigner`、`ludionFetch`、`createStapleKeeper`）は Session 鍵しか受け取らず、Root を開かない。ただし：
   - 文書（`/agent`）と CLI の `sign` は `ludion.json` を丸ごと読む。そこには Root が封をされて入っている（`--dev` なら平文）。封を開く合言葉（`LUDION_ROOT_PASSPHRASE`）は SDK は読まない。
   - デモの台本（`docs/outbox/launch/demo-script.md`）は録画の前に `LUDION_ROOT_PASSPHRASE` を設定させる。エージェントの環境に合言葉があれば、乗っ取られたエージェントは Root を開ける。→ MND-1 で「合言葉の無い環境で SDK が動く」を確かめ、デモでも合言葉はエージェントのプロセスに渡さない。

## 決めたこと（この spec の範囲）

- **発行の道**：`POST /v0/divers/{id}/mandates`（Root の署名の文、typ `ludion-mandate-self+jwt`）。`/v0/divers/{id}/keys` と同じ形。利用者の同意の道（`POST /v0/mandates`）は変えない。出す Mandate は `prn: "self"`。名簿が持つのは今と同じ（ハッシュ、Diver、期限、self の印）。サイト・範囲・上限は持たない。
- **取り消しの道**：`POST /v0/divers/{id}/mandates/{jti}/revoke`（Root の署名の文）。流れは利用者の取り消しと同じ（失効のストリームと Staple の `mrev`）。
- **`per_day` の意味は変えない**：1日の決済（`charge()`）の回数（PRS-3）。だから `checkout` の Mandate には `--checkout-max` と `--currency` が要る。spec §3.2 の例のコマンド（`--scope read,checkout --per-day 3`）は、そのままでは名簿が拒否する。→ 人間待ち（下）に確認として書いた。
- **`sub` 違いは今のまま**（SPOOFED、401）。PRS-2 を変えるのは人間の判断。

## 朝に見てほしい判断（夜間モード、2026-10-05 夜〜）

人間が不在のあいだ、spec に一番合う方を選んで進めた。違っていたら、その行を指して戻してください。

1. **MND-3 の `sub` 違い**：spec は 403 `mandate_required`。PRS-2（ラチェット済み）が 401 `invalid_signature`（SPOOFED）に固めているので、そのままにした。MND-3 の行に注記した（下の人間待ちの1）。
2. **`per_day` は「1日の決済の回数」のまま**（PRS-3）。`checkout` の Mandate は `--checkout-max` と `--currency` を持つ。spec §3.2 の例のコマンドに、この2つを足して使っている（デモも台本も）。
3. **検証器の対照の更新**：1時間の集計の行に `mandate` を足したので、行のキーを手で並べていた2か所（PRIV-4 の対照の行、SEED-2 の e2e の `ROW`）にも足した。判定そのものは変えていない。
4. **デモは新しい `examples/demo-shop`**。レーン1の `examples/demo-site`（PRS-5、scope delete）には触っていない。
5. **台本（`docs/outbox/launch/demo-script.md`）を §3.4 の流れに書き直した**。前の台本の MCP の場面は、spec の流れに無いので外した（MCP-1 は残っている）。
6. **罠の文は、デモの店の商品レビューに置いた**（攻撃者が書いた体）。不変条件16（ページの中で AI に問いかけない）は Ludion 自身のページの話と読んだ。デモの店のページにだけ置き、README と台本に「仕込んだ攻撃」と書いた。
7. **`agent.mjs --model`**（録画用、任意）の既定のモデルは `claude-sonnet-5-5`。鍵が無いので一度も動かしていない。CI は `--scripted` だけ。
8. 夜間モードの指示が届く前に、#128 に PR のコメントを1つ書いた（SEED-2 の対照を変えた説明）。それ以降、外への書き込みはしていない。
9. **HN のタイトルは、レーン2 spec の「Show HN: Ludion – Identity, limits and a kill switch for AI agents」にした**。親 spec §20.1 の推奨（「Give your AI agent its own key, revocable everywhere in one line」）と違う。レーン2 spec は、ローンチの中心を3つの問いに変えるための、後から出た人間の指示なので、そちらを採った。spec-v2-diff.md に書いた。
10. **トップページの中心を、spec §9 の一点（鍵と名前）から3つの問いに変えた**（レーン2 spec §3.6）。init の1行と、通す・壁・止める、scan への導線は残した。数字は今までどおり出所のリンク付き（WEB-2 PASS）。
11. **FAQ に足しかけた「Mandate も無料のまま」は消した**（会社の約束になるため）。もとの「Gate、検証、止めるは無料のまま」のまま。
12. **README の冒頭**は、最初の節（「What Ludion does not prevent」）までを指すと読んだ。その下の節（npx の書き換えなど）はレーン3のもの。

## 人間待ち

- [ ] **判断（MND-3 の `sub` 違い）**：spec は 403 `mandate_required`。今は SPOOFED（401 `invalid_signature`）で、PRS-2（ラチェット済み）が固めている（「A が B の Mandate を運ぶと SPOOFED」）。
  - 案 A（推す）：今のまま。より厳しい（その要求の身元ごと信じない。scope の無い経路でも Pressure 2 なら拒否）。MND-3 は `sub` 違いを「拒否され、アプリに届かず、有効な Mandate として扱われない」で見る。
  - 案 B：spec どおり 403 `mandate_required` にする。PRS-2 と GATE-7 の期待を変える（検証器の変更なので人間の承認）。
  - 決まるまで案 A で進める。
- [ ] **確認（`per_day` と `checkout`）**：spec §3.2 の例は `--scope read,checkout --per-day 3` で、1回の上限と通貨が無い。今の設計（PRS-2、PRS-3）では `checkout` の Mandate は `checkout_max` と通貨を持ち、`per_day` は決済の回数。デモは `--checkout-max` と `--currency` を足して作る。`per_day` を「Mandate を使った回数（経路を問わず）」にしたいなら、PRS-3 の意味が変わるので人間の判断。
- [ ] **tracecheck.dev へのデプロイ**（`pilots/tracecheck/DEPLOY.md`、15 分）と、手順 0 の数字 2 つ（Workers のプラン、1 日のリクエスト数）。
- [ ] PILOT-2 のトークン：`TRACECHECK_D1_READ_TOKEN`、`TRACECHECK_ACCOUNT_ID`、`TRACECHECK_D1_ID`。
- [ ] （任意）毎朝のレポートの Discord の Webhook（`REPORT_WEBHOOK_URL`）。
- [ ] `SECURITY.md` を読む（`docs/THREATS.md` が無い、`security@ludion.ai` の受信、24時間・72時間・報奨金の約束）。

## 進み具合（レーン2の系列）

- 手元（`lane2/mnd`、main を取り込んだ上）：MND-1〜4 PASS。DEMO-1、CEN-1・2、MSG-1、MND-5 は PENDING。
- #128 で MND-1〜4 が main に入った。
- 手元（`lane2/msg`）：MSG-1 PASS（6つの文面、仕込んだ10を捕まえる）。トップページを変えたので WEB-2・3・5・8・9 も回して PASS。
- 手元（`lane2/demo`、#129）：DEMO-1 PASS（10秒。流れ全体と、仕込んだ3つ：アカウントの経路に scope が無い店、失効を購読しない店、Session 鍵の文も受け付ける名簿、を3つとも捕まえる）。
  - 同じ変更で回して PASS：LOOP-1・4・5、CRY-1、STD-1・2、GATE-2・5・7・10〜14、PRIV-1〜5、PRS-1〜5、REG-1〜7、LEAK-1、RPT-1・2、DIV-3〜6、PUB-1〜4、SEC-1、NEUT-1、PUR-1〜4、BLK-1、ONE-3、MCP-4、PILOT-1、WEB-2、WEB-3。
  - PRIV-4 の判定の対照（手で組んだ正しい1時間の行）に `mandate` を足した。判定はそのまま（`ROW_KEYS` と比べる）。spec §3.3 の「1時間ごとの集計に委任の判定を入れる」のため。

## 次の一手

1. ✅ #126：spec、STATE、オラクルを PENDING で。
2. PR（`lane2/mnd`）：Mandate（MND-1〜4）。名簿の Root の発行と取り消し、gate-core の `prn: "self"`、受領証・来訪の記録・1時間の集計に委任の判定、diver の CLI（`mandate create/list/revoke`）と SDK の `mandateFor`、help のページ、ADR（docs/adr/2026-10-05-operator-mandate-signed-by-root.md）。
3. デモ（DEMO-1）：`examples/demo-shop`（レーン1の `examples/demo-site` と PRS-5 には触らない）、決まった動きの乗っ取りのエージェント、台本。
4. census（CEN-1・2）：`site/src/data/census.json`、`/census` と `/ja/census`、各社への事前連絡の下書き。
5. 文面（MSG-1）：README の冒頭（英日）、トップページ、`show-hn.md`、`faq.md`、`demo-script.md`。

## 既知の問題

- `npm test`（全部を並べて回す）で、REG-1 の「名簿が落ちても遅れない」（p99 +8 ms）が一度落ちた。単独では3回とも通る。CI は REG-1 を単独で回す（`npm test` は CI で回らない）。レーン1の系列なので、触らずに記録だけ。

### 前の担当から

- Free の CPU（10 ms）：Gate は 1 リクエスト約 0.1 ms。毎朝のレポートは、自動化が 1 日 1 万件で約 10 ms（Node で測った値）。超えた日は、データを引いて手元の `ludion report` で作る。
- `www.tracecheck.dev` は DNS only で Vercel を向き、証明書が切れている（2026-10-03 に外から見た）。Gate は www には立たない。

## 直近のセッション

- 2026-10-05 夜：レーン2 spec を受け取った。`lane2/oracles` は #89 で main に入っていて、未コミットの作業は無かった。main から `lane2/mandate` を切り、spec を `docs/lanes/lane2-spec.md` に置き、§3.1 を確かめた（上）。
- 2026-10-03〜04：tracecheck.dev の計測（#81）、README（#83）、/scan のサンプル（#82）、クイックスタート（#84）、レーン2のオラクル（WEB-10、WEB-11、PILOT-1、PILOT-2、#89）、SCAN-5・6（#88）。
