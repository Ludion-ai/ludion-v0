# STATE（レーン 2）

最終更新：2026-10-05 夜（Claude Code、レーン 2。作業ツリーは `C:\Users\haya0\ludion-lane2`、ブランチは `lane2/` で始める）

## 担当（2026-10-05 から）

人間の指示：`docs/lanes/lane2-spec.md`（レーン2 spec「3つの問い：誰か・何をしていいか・どう止めるか」）。親は `docs/ludion-spec.md`。食い違ったら親が正しく、食い違いは `docs/outbox/` に書く。

| 期限（JST） | PASS させるもの |
|---|---|
| 10/10 23:59 | MND-1〜4、DEMO-1、CEN-1・2 |
| 10/11 23:59 | MSG-1（文面の書き換え） |
| 余裕があれば | MND-5（SDK の側のシートベルト） |

- 境界（spec §2）：オラクルの系列は MND・DEMO・CEN・MSG だけ。`ratchet.json` は書かない（ラチェットはレーン1）。レーン1の持つファイル（DEPLOY.md、PUBLISH.md、runbook、名簿の保存（LEAK-1）、CI）は触らない。gate-core・registry・diver の既存ファイルは最小の差分。毎日 main を取り込む。
- 外に出す文章は `docs/outbox/` に下書きまで。出すのは人間。
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

## 次の一手

1. PR（`lane2/mandate`）：spec を置く、この STATE、オラクル（MND・DEMO・CEN・MSG）を PENDING で目録と registry に足す、`spec-v2-diff.md` に `prn: "self"` と発行の道。
2. Mandate（MND-1〜4）：名簿の Root の発行と取り消し、gate-core の `prn: "self"`、受領証と1時間の集計に委任の判定、diver の CLI（`mandate create/list/revoke`）と SDK のサイトごとの Mandate、help のページ。
3. デモ（DEMO-1）：`examples/demo-shop`（レーン1の `examples/demo-site` と PRS-5 には触らない）、決まった動きの乗っ取りのエージェント、台本。
4. census（CEN-1・2）：`site/src/data/census.json`、`/census` と `/ja/census`、各社への事前連絡の下書き。
5. 文面（MSG-1）：README の冒頭（英日）、トップページ、`show-hn.md`、`faq.md`、`demo-script.md`。

## 既知の問題（前の担当から）

- Free の CPU（10 ms）：Gate は 1 リクエスト約 0.1 ms。毎朝のレポートは、自動化が 1 日 1 万件で約 10 ms（Node で測った値）。超えた日は、データを引いて手元の `ludion report` で作る。
- `www.tracecheck.dev` は DNS only で Vercel を向き、証明書が切れている（2026-10-03 に外から見た）。Gate は www には立たない。

## 直近のセッション

- 2026-10-05 夜：レーン2 spec を受け取った。`lane2/oracles` は #89 で main に入っていて、未コミットの作業は無かった。main から `lane2/mandate` を切り、spec を `docs/lanes/lane2-spec.md` に置き、§3.1 を確かめた（上）。
- 2026-10-03〜04：tracecheck.dev の計測（#81）、README（#83）、/scan のサンプル（#82）、クイックスタート（#84）、レーン2のオラクル（WEB-10、WEB-11、PILOT-1、PILOT-2、#89）、SCAN-5・6（#88）。
