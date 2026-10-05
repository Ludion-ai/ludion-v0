# ローンチ当日の手順書（Show HN、2026-10-13 22:00 JST）

やるのは人間。Claude が手元で回せる確認には「（Claude）」と書いた。コマンドはリポジトリの直下で。本番の資格情報が要るもの（wrangler の本番のログイン）は人間だけが打つ。

## 前日（10/12）

### 1. LIVE の全部

```sh
node accept/live/live4.mjs                 # ludion.ai が main のビルドで、noindex がない（Claude も回せる）
gh run list --workflow ci.yml --event schedule --limit 1   # 夜間の LOOP-2・LIVE-4・Windows が緑
```

- LIVE-1〜3（canary、本物の第三者のエージェント、Cloud の北極星）は、読み取りのトークンが要る。トークンが無いままなら、ローンチの文面でこれらの数字に触れない。
- PILOT-2（tracecheck.dev の直近7日）：`TRACECHECK_D1_READ_TOKEN` などを入れて `node pilots/tracecheck/live.mjs`。数字を show-hn.md の空欄に入れる。
- ludion.ai のビルドが main と同じか：DEPLOY.md §1.5 の「確かめる」。違えば §1.5 で出し直す。

### 2. きれいな環境で npm i と init → VERIFIED

npm から入れる（リポジトリの中では回さない）。空のディレクトリと空の npm のキャッシュで、Mac か Linux と、Windows で1回ずつ。

```sh
mkdir /tmp/ludion-d1 && cd /tmp/ludion-d1
export npm_config_cache=/tmp/ludion-d1/.npm
npx ludion-ai@latest init --name "Launch Check" --contact mailto:you@example.com
npx ludion-ai register                    # 名前が名簿に載る（Card Host の名前のとき）
npx ludion-ai doctor                      # All good（⚠ や ✖ が出たら止まる）
npx ludion-ai sign GET https://<デモのサイト>/ --curl   # 出た curl に -sI を付けて送る → Ludion-Receipt の class が VERIFIED
```

- 3分以内に VERIFIED まで行くこと（ONE-4、DIV-1 と同じ）。時間を測っておく。
- `curl -s https://<id>.agents.ludion.ai/card` と `/client` が 200 で、`token_endpoint_auth_method` が `private_key_jwt`（MCP-4）。
- 終わったら、その名前を `npx ludion-ai revoke` で消す（名簿をきれいに保つ）。

### 3. デモのサイトが失効の配信を購読しているか

デモのサイトの `ludion.config.json` の `registry` に、`"revocations": "https://registry.ludion.ai/v0/revocations/stream"` があり、サーバーが長く動いていること（gate-node）。

```sh
curl -sN --max-time 20 https://registry.ludion.ai/v0/revocations/stream | head -5   # 配信が生きている（heartbeat か event が来る）
```

- 試す：使い捨ての名前を作って登録する。デモのサイトに署名して VERIFIED を見る。`npx ludion-ai revoke` する。数秒のうちに、同じ署名付きのリクエストが `403` で、受領証は `REVOKED` になる。
- 数秒で変わらなければ、購読が切れている。サーバーを再起動して、もう一度。

### 4. 名簿の守り

- `services/registry/wrangler.json` の `REGISTRY_PAUSE_NEW` が `"0"` で、`REGISTRY_LIMITS` がある状態でデプロイされている（DEPLOY.md §7.1）。
- 一時停止の手順（§7.2）を、一度プレビューではなく手元で読んでおく。当日にコマンドを探さない。
- プラン：Workers Paid にしたか（DEPLOY.md §7.3）。Free のままなら、1日 100,000 リクエストで Error 1027 になる。

### 5. 文面

- show-hn.md の `[ ]` と `[__]` が全部埋まっている。数字は、その日のオラクルと合っている。
- faq.md を手元に開いておく。

## 当日（10/13）

### 投稿の前の5分

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://ludion.ai/                    # 200
curl -s https://ludion.ai/_build.json                                         # 前日に確かめた site と同じ
curl -s https://registry.ludion.ai/.well-known/ludion-keys                    # 鍵の kid が DEPLOY.md §6.1 で控えたもの
curl -s -o /dev/null -w "%{http_code}\n" https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai/card   # 404（TLS が通って、登録のない名前）
npm view ludion version                                                       # 出したはずの版
```

- デモのサイトに、署名付きのリクエストを1本送って VERIFIED（前日の2の最後の1行）。
- Cloudflare のダッシュボードで、`ludion-site`、`ludion-registry`、`ludion-card-host` の Metrics を開いておく。
- GitHub の main の CI が緑（`gh run list --branch main --limit 1`）。

### 当日に見る数字（30分ごと）

| 数字 | どこで | 動くとき |
|---|---|---|
| HN の順位とコメント | HN | コメントには faq.md を下敷きに、10分以内に返す |
| 5xx の数 | Cloudflare の Metrics（3つの Worker） | 0 でなければ、下の「壊れた時」へ |
| `429 rate_limited` と `503` の数 | `ludion-registry` の Metrics（状態コード別） | 正規の人が 429 に当たっているなら §7.1 で上限を上げる |
| 登録された名前の数 | `curl -s 'https://registry.ludion.ai/v0/bulk?since=0'` の JWS の `divers` の数 | 1時間に数百を越え、同じ形の名前が並ぶならスパム。§7.2 で新しい登録を止める |
| Workers のリクエスト数（1日） | Cloudflare のアカウントの Workers の概要 | Free で 80,000 を越えたら、すぐ Paid に |
| npm のダウンロード | `curl -s https://api.npmjs.org/downloads/point/last-day/ludion` | — |
| 先行登録 | Discord の通知 | — |

名前の数を数えるコマンド：

```sh
curl -s 'https://registry.ludion.ai/v0/bulk?since=0' | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("version",b.version,"names",JSON.parse(Buffer.from(b.jws.split(".")[1],"base64url")).divers.length)'
```

### 壊れた時に戻す

| 何が | まずすること | 戻し方 |
|---|---|---|
| サイト（ludion.ai） | `/_build.json` と 5xx を見る | `npx wrangler@4.144.0 deployments list --name ludion-site` で前の版を探し、`npx wrangler@4.144.0 rollback <version-id> --name ludion-site` |
| 名簿 | 5xx か、スパムか | スパム：DEPLOY.md §7.2 で新しい登録を止める。5xx：`npx wrangler@4.144.0 rollback <version-id> --config services/registry/wrangler.json`（Durable Object の中身は版に関係なく残る） |
| Card Host | TLS のエラーか 5xx か | TLS：§4.4（証明書が Active か、`*.agents` が Proxied か）。5xx：`npx wrangler@4.144.0 rollback <version-id> --config packages/card-host/wrangler.json` |
| 失効の配信 | `curl -sN …/v0/revocations/stream` | 止まっても、購読していない Gate と同じく、Staple の寿命（最長1時間）で通らなくなる。HN では正直にそう書く |
| npm の `ludion` | 壊れた版の症状を1つ再現する | `npm unpublish` はしない。直した版を出し（2版目からは release のワークフロー、docs/PUBLISH.md §6）、壊れた版は `npm deprecate ludion@<版> "<理由>"` |
| Error 1027（Free の上限） | Workers の概要で確かめる | Workers Paid にする（お金。人間） |
| 上限がきつすぎる | 正規の人の 429 の報告 | §7.1：`REGISTRY_LIMITS` を上げてデプロイ |

- 戻したら、HN のスレッドに「何が起きて、何をしたか」を一言書く。隠さない。
- 戻した後に、Claude に赤くなったオラクルを渡す（直すのは速いループのテストに降ろしてから）。
