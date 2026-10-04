# MCP の client_id は、拡張のない CIMD（`<origin>/client`）に分ける。`/card` は Web Bot Auth の名札のまま

日付：2026-10-04（人間が承認した。「全部許可する」。spec v2.0.2 で §11.2・§13.1・§9.3・§23.4 を直した）

## 状況

- spec §11.2 は、名札の URL（`…/card`）を MCP の client_id にする。名札は CIMD の形で、Ludion の拡張は `ludion` オブジェクトに、Web Bot Auth の項目は `web_bot_auth` に入れる。
- CIMD を有効にした Keycloak 26.8.0（2026-10-01 の最新）は、知らない項目のある文書を拒む（`Unrecognized field "web_bot_auth"`。keycloak/keycloak#51236、修正の PR #51235 は未マージ）。MCP-1 は認可の要求で止まる（#96）。
- その2つを外した同じ文書なら、loopback、PKCE、同意、Session 鍵の private_key_jwt で通る（#96 の対照）。

## 決定

- エージェントの原点に、もう一つの文書 `/client` を置く。中身は OAuth の client metadata だけ：`client_id`（`<origin>/client`）、`client_name`、`contacts`、`jwks_uri`（同じ鍵の一覧）、loopback の `redirect_uris`、`grant_types`、`response_types`、`token_endpoint_auth_method: private_key_jwt`。
- MCP の client_id は `<origin>/client`。`init` の画面の MCP の行もそれにする。`init` は `client` も書き、Card Host は `/client` も配る（名簿から作る）。
- `/card`（Web Bot Auth の名札、`ludion` と `web_bot_auth`）は変えない。DIV-2 はそのまま。
- 名前（オリジン）は一つのまま。鍵の一覧も一つ。

## 結果

- MCP-1、MCP-2 は、Keycloak 26.8.0 で今日 PASS する（ブランチで確かめた。DIV-2、DIV-5、PRIV-5、WEB-10 も PASS のまま）。
- 厳しい認可サーバーにも通る。知らない項目を拒む実装が他にあっても、`/client` には知らない項目がない。
- client_id は認可サーバーでの身元なので、決めたら変えない。Keycloak が直っても `/card` に戻さない。

## 捨てた代替案

- **案 A**：spec のまま、Keycloak の修正を待つ。10/10 までに修正版が出なければ、HN から MCP を外す。
- **案 B**：`/card` から `web_bot_auth` と `ludion` を外す。Web Bot Auth の名札でなくなる。DIV-2（ラチェット済み）の緩和になる。

## 見直す条件

MCP の仕様が、Web Bot Auth の名札そのものを client_id にすることを求めた時。

## 出典

spec v2.0.1 §11.2、§13.1、§23.4（MCP-1）。ADR-039。keycloak/keycloak#51236。
