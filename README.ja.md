# Ludion

[English](README.md)

**1行で、AI が自分の鍵と名前を持つ。MCP でも Web でも同じ名前で通じる。1行で、世界中から消せる。**

AI のエージェントは、人の代わりにサイトを読み、比べ、ログインし、買う。受け取るサイトの側からは、それが誰の AI なのかが分からない。Ludion は、その AI に名札と鍵を持たせ、サイトにはその名札を読む関所（Gate）を無料で配る。土台は標準の [Web Bot Auth](https://datatracker.ietf.org/wg/webbotauth/about/)（[RFC 9421](https://www.rfc-editor.org/rfc/rfc9421) の署名）と、MCP の Client ID Metadata Document（CIMD）だ。

## エージェントの側：1行で名前と鍵

```sh
npx ludion init --name "My Agent" --contact mailto:ops@example.com
```

1つの画面が出る。

```text
あなたの AI の名前：https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai

  Web    Signature-Agent: sig1="https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai"
  MCP    client_id = https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai/card
  消す   npx ludion revoke   （1時間以内に、世界中で通らなくなります）

  README に貼るバッジ：
  [![Ludion ID](https://ludion.ai/badge/dvr-k7q2m6x4pcab3cde.svg)](https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai)
```

- **Web**：要求に署名する。`npx ludion sign GET https://example.com/` は、どの HTTP クライアントにも貼れる署名のヘッダーを出す。Node なら `ludion/diver` の `ludionFetch` が、署名、鍵の回転、nonce、本文のダイジェストを引き受ける。
- **MCP**：同じ名札の URL（`…/card`）を client_id にする。名札は CIMD の形で、`redirect_uris` は loopback（`http://127.0.0.1/callback`）、認可サーバーへは Session 鍵の `private_key_jwt` で名乗る（`ludion/diver` の `clientAssertion`）。秘密の文字列は持たない。
- **消す**：`npx ludion revoke` で、名簿（Registry）に失効を出す。名簿を購読している Gate には数秒で、そうでない Gate にも名簿の証明（Staple）の寿命（最長1時間）のうちに届く。
- 目的の申告：要求に「何をしに来たか」を一語（`read` か `act`）と一文で添えられる（`Ludion-Purpose`、署名で覆う）。一文にメールアドレス、電話番号、URL、長い数字があれば、送る前に止める。

## サイトの側：名札を読む関所

```sh
npm install ludion
```

Express なら2行。

```js
import { ludion } from "ludion/gate/node";
app.use(await ludion());
```

`package.json` の隣に `ludion.config.json` を置く。

```json
{ "site_id": "site-your-shop", "pressure": 0 }
```

- **最初は見るだけ**（Pressure 0）。人に返すページは変わらない（Gate が足すのは `Ludion-*` のヘッダーだけ）。自動化の最初の1件を記録した時点で、サーバーのコンソールに1行出る。
- **通す・壁・止める**は、設定の1行で効き、その行を消せば戻る。

  ```json
  "pressure": 1,
  ```

  名乗らない自動化にだけ、サイトの既存の摩擦（CAPTCHA など）を当てる。署名した AI は通る。

  ```json
  { "match": "/login", "pressure": 2 }
  ```

  その経路でだけ、名乗れない自動化を止める（`401 signature_required`）。

  ```json
  "decisions": [
    { "who": "GPTBot", "action": "block", "scope": "writes" }
  ]
  ```

  名指しで止める（`403 blocked_by_site`）。`who` には、Diver の id、署名した相手のホスト、User-Agent の名乗り、`"unnamed"` を書ける。`until` に日時を書けば、その時に解ける。

- **止めるのはサイトだけ。** Ludion のサーバーには、誰かを止める経路がない。判断はサイトの設定の中にだけある。
- **朝のレポート**（`npx ludion report`）は、見出しの数字が1つ（自動化のうち署名で名乗った割合）、決めることが1つ。クローラーを名乗る送信は「偽物の疑い」、署名して「読むだけ」と言いながら書き込んだ相手は、その言葉と並べて出す。
- Next.js（`proxy.js` の1行）と Cloudflare Workers の入れ方は [ludion.ai/gate](https://ludion.ai/gate)。Gate の拒否には、どれにも説明のページがある：[ludion.ai/e](https://ludion.ai/e)。

## 外に出るもの

- Gate の外に出るのは、1時間ごとの件数だけ。キーは経路のテンプレート（`/orders/:id`）、メソッドの種類、分類、判定、運営者（Diver の id か名乗りの名前）で、値は件数。来訪ごとの時刻、IP、国、本文、クッキー、クエリの値、目的の一文は出ない。
- 来訪ごとの記録は、サイトの中に7日だけ置いて消す。
- `send_metadata` を切れば、鍵の一覧の取得のほかは何も外に出ない。

## ログから始める

[ludion.ai/scan](https://ludion.ai/scan) にアクセスログを落とすと、決済、ログイン、登録、フォームに、署名のない自動化がどれだけ触れたかを数える。ログはブラウザの中で読み、どこにも送らない。nginx、Apache、Caddy、IIS、CloudFront、AWS ALB、Cloudflare Logpush、Vercel、Fastly の形式（gzip も）を読む。手元に `npx ludion scan access.log` でも同じ数字が出る。

## いまの状態（2026-10-04）

- **npm への公開はまだ。** それまでは、このリポジトリから動かす（`npm ci` のあと、下の例）。
- **名簿（Registry）と名札の置き場（`*.agents.ludion.ai`）は、まだ本番で動いていない。** 設定と手順は揃っている（[docs/DEPLOY.md](docs/DEPLOY.md) §6）。それまで `register` と `revoke` は、手元で動かす参照の名簿（[`services/registry`](services/registry)）に向ける。
- **MCP**：CIMD を有効にした Keycloak 26.8.0 で確かめた。名札のうち Ludion と Web Bot Auth の項目（`ludion`、`web_bot_auth`）を、Keycloak が知らない項目として拒む（[keycloak/keycloak#51236](https://github.com/keycloak/keycloak/issues/51236)）。その2つを除けば、loopback、PKCE、Session 鍵の `private_key_jwt` で認可が通る。扱いは決めているところだ。
- 保証（Ballast）、委任の同意画面（Mandate）、段階（Depth）のコードはあるが、今は表に出していない。

## 作り方

Ludion は、検証器に向かって作っている。進んだかどうかは、スコアボードの行が PASS になったかで示し、「動いた」とは書かない。

- [`docs/MISSION.md`](docs/MISSION.md) が、真になるべきこと（オラクル）の一覧。正のオラクルには、同じ性質の負のオラクルを対にする（本物が通り、偽物が通らない）。
- [`accept/registry.mjs`](accept/registry.mjs) がそれを動かし、`npm run scoreboard` が表にする。
- 一度 PASS したオラクルは、ラチェット（`npm run ratchet`）が固定し、CI が落とさせない。
- 製品の意図は [`docs/ludion-spec.md`](docs/ludion-spec.md)。§8 が不変条件。判断の記録は [`docs/adr/`](docs/adr)。

```sh
npm ci
npm test               # 秒
npm run scoreboard     # 分：全部のオラクル
node examples/e2e.mjs  # エージェント、Gate、VERIFIED。すべて 127.0.0.1 の上で
```

## 原則

- **中立。** 特定の CDN、AI の会社、クラウド、決済網に依存しない。Gate はサイト自身の基盤の中で動く。
- **開かれている。** 仕様、Gate、SDK はオープンソース。運営（名簿）だけが Ludion のもの。
- **人のデータは持たない。** 外に出るのは集計だけ。
- **自前の暗号は作らない。** Ed25519 は WebCrypto で、RFC 9421 は Web Bot Auth の参照実装で。

## ライセンスとセキュリティ

Apache-2.0（[LICENSE](LICENSE)）。脆弱性の報告は [SECURITY.md](SECURITY.md) のとおりに。
