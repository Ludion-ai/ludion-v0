# 運営者が自分のエージェントにかける Mandate ── Root の署名で発行し、`prn: "self"`

日付：2026-10-05（レーン2）
関係：レーン2 spec（`docs/lanes/lane2-spec.md`）§3.2・§3.3・§4、spec §11.6、docs/adr/2026-10-01-mandate-v0-passkey-consent-and-site-charge.md（PRS-2）、PRS-3、MND-1〜4

## 背景

v0 の Mandate は、利用者（Principal）がパスキーで同意し、名簿が発行する（PRS-2）。その同意の画面は凍結中（spec §9.5）。レーン2 spec は、v0 の委任を「運営者が、自分のエージェントにかける上限」にした。乗っ取られたエージェントや、Session 鍵を盗んだ者が、その外に出られないことを、Gate のあるサイトが確かめる。

## 決定

### 1. 発行と取り消しは Root の署名の文

- `POST /v0/divers/{id}/mandates`：Diver の Root が署名した文（JWS、typ `ludion-mandate-self+jwt`）。中身は `sub`、`aud`、`scope`、`limits`、`exp`、`iat`、`nonce`。
  - 名簿は、登録された Root の公開鍵でだけ検証する。Session 鍵、他の Diver の Root、別の typ の文は 401。
  - `iat` は ±5分（鍵の承認と同じ）。同じ文は一度しか通らない（409）。失効した Diver は 403。
  - 範囲・上限・期限の検査は、利用者の同意の道と同じ関数（`mandateTerms`）。`checkout` は `checkout_max` と `currency` を持つ。寿命は既定24時間、最長7日。
- `POST /v0/divers/{id}/mandates/{jti}/revoke`：Root の署名の文（typ `ludion-mandate-self-revoke+jwt`）。自分の Root がかけたものだけを取り消せる（他は 403）。失効のストリームと Staple の `mrev` で届く（利用者の取り消しと同じ道）。
- 出す Mandate の `prn` は `"self"`。Gate は `pw-…` と `"self"` を読む。

**なぜ Root か**：動いているエージェントは Session 鍵しか持たない（spec §11.3）。発行を Root に限れば、乗っ取られたエージェントも、Session 鍵を盗んだ者も、自分の上限を広げられない。RFC 9421 の要求（Session 鍵の署名）で発行を受け付けると、この線が消える。

**名簿が知ること**：利用者の同意の道と同じ。発行の時に `aud`（サイト）を聞くが、持つのはハッシュ、Diver、期限、self の印だけ。サイト・範囲・上限は持たない（2026-10-04 に人間が確認した読みのまま）。

### 2. SDK と CLI

- `npx ludion-ai mandate create --site <https origin> --scope … [--checkout-max N --currency CCY --per-day N] [--expires 24h]`、`list`、`revoke <jti>`。発行と取り消しのときだけ Root を開く（合言葉）。Mandate は `ludion.json` の `mandates` に置く。
- SDK の側のシートベルト（MND-5、任意）：`mandateFor(me, { strict: true })`。Mandate のあるサイトへの要求は使う範囲を名乗り（`ludionFetch(url, { scope: "checkout" })`。GET と HEAD は `read`）、範囲の外、範囲を名乗らない書き込み、期限切れや取り消し後の要求は、署名も送信もしない（Gate の無いサイトでも）。既定は切ってある：デモでは、サイトの Gate が断るところを見せるため。縛れるのはエージェント自身のコードだけで、盗んだ Session 鍵で手で署名する者を止めるのはサイトの Gate（DEMO-1）。
- SDK：`createDiverSigner({ …, mandate: mandateFor(me) })`。`mandate()` は要求（メソッドと URL）を受け取り、行き先のサイトの Mandate を選ぶ。`mandateFor` は `mandates` しか読まない。Root も合言葉も要らない（MND-1 は、合言葉の無いプロセスで CLI が出した1行を動かし、Root を読まないことを確かめる）。

### 3. 判定は今のまま。受領証と1時間の集計に判定を足す

- 範囲の外は 403 `mandate_scope`、ここで効く Mandate が無ければ 403 `mandate_required`（PRS-2、PRS-4）。
- 受領証、来訪の記録、1時間の集計のキーに `mandate`（`ok`／`required`／`scope`／`none`）を足した。Mandate そのもの（jti、範囲）は外に出ない。
- `per_day` は「1日に通る決済（`charge()`）の回数」のまま（PRS-3）。記録の無い Gate は `per_day` 付きの Mandate の決済を拒否する。
- `sub` 違い（別の Diver の Mandate）と偽造は SPOOFED（401 `invalid_signature`）のまま（PRS-2）。レーン2 spec の MND-3 は 403 `mandate_required` と書いている。人間の判断待ち（STATE.lane2.md）。

## 見直す条件

- 利用者の同意の画面の凍結が解けたとき：`prn: "self"` と `pw-…` を同じ経路で並べて見せる（どちらの許しかを、サイトのレポートで分ける）。
- `per_day` を決済以外の「使った回数」にしたくなったとき（PRS-3 の意味が変わる。人間の判断）。
- Root を OS の鍵の保管庫や KMS に置く仕組みができたとき：CLI の「合言葉で開く」を置き換える。
