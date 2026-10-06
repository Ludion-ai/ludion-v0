# ローンチ当日の手順書（Show HN、2026-10-13 22:00 JST）

やるのは人間。Claude が手元で回せる確認には「（Claude）」と書いた。コマンドはリポジトリの直下で、PowerShell でそのまま動く形にした（`curl` は `curl.exe` と書く。PowerShell の `curl` は別物）。本番の資格情報が要るもの（wrangler の本番のログイン）は人間だけが打つ。

**この日に見せるもの**：AI エージェントについての3つの問いに、サイトが自分で答えられること（docs/lanes/lane2-spec.md §0）。

| 問い | 答える仕組み | 前日に確かめる所 |
|---|---|---|
| この AI は誰か | 名札と署名（`npx ludion-ai init`） | 2.1 |
| 何をしていいのか | 委任（Mandate）の範囲。外の要求はサイトの Gate が `403 mandate_scope` | 2.2 |
| どう止めるのか | 失効（`npx ludion-ai revoke`）。購読しているサイトは数秒、ほかも最長1時間 | 2.3 |

npm の名前は `ludion-ai`（`ludion` は npm に断られた。docs/adr/2026-10-05-npm-name-ludion-ai.md）。コマンド名は `ludion` のままだが、入れていない所では必ず `npx ludion-ai …` と打つ。

## 前日（10/12）

### 1. 本番がそろっているか

docs/DEPLOY.md §0 の5段の確かめを、もう一度上から（GET だけ。何度回してもよい。Claude も回せる）：

```powershell
node scripts/prod-check.mjs cert
node scripts/prod-check.mjs dns
node scripts/prod-check.mjs registry --kid <DEPLOY.md §0 段4 で控えた kid>
node scripts/prod-check.mjs card-host
node scripts/prod-check.mjs site
node accept/live/live4.mjs
npm view ludion-ai version
gh run list --workflow ci.yml --event schedule --limit 1
```

- 全部 `OK`。`site` が `NG`（古いビルド）なら、DEPLOY.md §0 の段5で出し直す。
- `npm view ludion-ai version` が出したはずの版（0.1.0 以上。0.0.1 は名前を押さえるための空の版）。
- 夜間（LOOP-2・LIVE-4・Windows）が緑。
- LIVE-1〜3（canary、本物の第三者のエージェント、Cloud の北極星）は読み取りのトークンが要る。無いままなら、ローンチの文面でこれらの数字に触れない。
- PILOT-2（tracecheck.dev の直近7日）：`TRACECHECK_D1_READ_TOKEN` などを入れて `node pilots/tracecheck/live.mjs`。数字を show-hn.md の空欄に入れる（show-hn.md はレーン2の持ち物。数字を入れるのは人間）。
- デモのショップ（`https://shop.demo.ludion.ai`、examples/demo-shop）が動いていること：`curl.exe -s -o NUL -w "%{http_code}\n" https://shop.demo.ludion.ai/products` が `200`。

### 2. 3つの問いを、本物の npm から1回ずつ

npm から入れる（リポジトリの中では回さない）。空のディレクトリと空の npm のキャッシュで。Windows と、Mac か Linux で1回ずつ。時間を測る（2.1 は3分以内。ONE-4、DIV-1 と同じ）。

```powershell
mkdir $HOME\ludion-d1; cd $HOME\ludion-d1
$env:npm_config_cache = "$HOME\ludion-d1\.npm"
```

（Mac か Linux では `mkdir /tmp/ludion-d1 && cd /tmp/ludion-d1 && export npm_config_cache=/tmp/ludion-d1/.npm`。以下のコマンドは同じ。）

#### 2.1 この AI は誰か

```powershell
npx ludion-ai@latest init --name "Launch Check" --contact mailto:you@example.com
npx ludion-ai register                    # 名前が名簿に載る（Card Host の名前のとき）
npx ludion-ai doctor                      # All good（⚠ や ✖ が出たら止まる）
npx ludion-ai sign GET https://shop.demo.ludion.ai/products --curl   # 出た curl に -sI を付けて送る（PowerShell では curl.exe）
```

- 受領証（`Ludion-Receipt`）の class が `VERIFIED`。
- `curl.exe -s https://<id>.agents.ludion.ai/card` と `/client` が 200 で、`token_endpoint_auth_method` が `private_key_jwt`（MCP-4）。

#### 2.2 何をしていいのか

委任を作る（Root の合言葉を知っているのは、この窓だけ。エージェントのプロセスには渡さない）：

```powershell
npx ludion-ai mandate create --site https://shop.demo.ludion.ai --scope read,checkout --checkout-max 5000 --currency JPY --per-day 3
```

デモのエージェント（examples/demo-shop/agent.mjs。DEMO-1 が CI で回しているのと同じ「乗っ取られた判断」）を、この名前で動かす：

```powershell
node <リポジトリ>\examples\demo-shop\agent.mjs --scripted --shop https://shop.demo.ludion.ai
node <リポジトリ>\examples\demo-shop\agent.mjs --stolen --shop https://shop.demo.ludion.ai
```

- `--scripted`：商品を見る・カートに入れるは通る。罠のレビューに従ったパスワードの変更とアカウントの削除は `403 mandate_scope`。
- `--stolen`：盗んだセッション鍵で SDK を通さずに署名しても `403 mandate_scope`。そのセッション鍵で委任を作り直そうとすると、名簿が断る（Root の署名しか受けない）。
- どれか1つでも違えば、その日の HN の文面から「何をしていいか」を外す相談をする（レーン2の切る線）。

#### 2.3 どう止めるのか

```powershell
curl.exe -sN --max-time 20 https://registry.ludion.ai/v0/revocations/stream   # 配信が生きている（heartbeat か event が来る）
npx ludion-ai revoke
node <リポジトリ>\examples\demo-shop\agent.mjs --scripted --shop https://shop.demo.ludion.ai
```

- 数秒のうちに、全部の要求が `403` で、受領証は `REVOKED`（ショップは失効の配信を購読している）。
- 数秒で変わらなければ、購読が切れている。ショップのサーバーを再起動して、2.1 からもう一度。
- これで試した名前は消えている（名簿をきれいに保つ）。

### 3. 名簿の守り

- `services/registry/wrangler.json` の `REGISTRY_PAUSE_NEW` が `"0"` で、`REGISTRY_LIMITS` がある状態でデプロイされている（DEPLOY.md §7.1）。
- 一時停止の手順（DEPLOY.md §7.2）を一度読んでおく。当日にコマンドを探さない。
- プラン：Workers Paid にしたか（DEPLOY.md §7.3）。Free のままなら、1日 100,000 リクエストで Error 1027 になる。
- REG-7 の「IP ごとに1時間10件」は、同じ NAT の後ろの人が多いと足りないかもしれない（レーン1の朝の報告、2026-10-06）。上げるなら前日のうちに §7.1 で。

### 4. 文面（レーン2の持ち物。人間は埋まっているかだけ見る）

- show-hn.md の `[ ]` と `[__]` が全部埋まっている。数字は、その日のオラクルと合っている。
- faq.md を手元に開いておく。
- 文面の `npx` が全部 `npx ludion-ai`（`npx ludion` が残っていたら、その行は動かない）。

## 当日（10/13）

### 投稿の前の5分

```powershell
node scripts/prod-check.mjs site
node scripts/prod-check.mjs registry --kid <kid>
node scripts/prod-check.mjs card-host
npm view ludion-ai version
gh run list --branch main --limit 1
```

- 全部 `OK`、npm の版は前日と同じ、main の CI が緑。
- デモのショップに 2.1 の最後の1行を送って `VERIFIED`。
- Cloudflare のダッシュボードで、`ludion-site`、`ludion-registry`、`ludion-card-host` の Metrics を開いておく。

### 当日に見る数字（30分ごと）

| 数字 | どこで | 動くとき |
|---|---|---|
| HN の順位とコメント | HN | コメントには faq.md を下敷きに、10分以内に返す |
| 5xx の数 | Cloudflare の Metrics（3つの Worker） | 0 でなければ、下の「壊れた時」へ |
| `429 rate_limited` と `503` の数 | `ludion-registry` の Metrics（状態コード別） | 正規の人が 429 に当たっているなら DEPLOY.md §7.1 で上限を上げる |
| 登録された名前の数 | 下のコマンド | 1時間に数百を越え、同じ形の名前が並ぶならスパム。DEPLOY.md §7.2 で新しい登録を止める |
| Workers のリクエスト数（1日） | Cloudflare のアカウントの Workers の概要 | Free で 80,000 を越えたら、すぐ Paid に |
| npm のダウンロード | `curl.exe -s https://api.npmjs.org/downloads/point/last-day/ludion-ai` | — |
| 先行登録 | Discord の通知 | — |

名前の数を数えるコマンド（PowerShell でも bash でも同じ）：

```powershell
node -e "fetch('https://registry.ludion.ai/v0/bulk?since=0').then(r=>r.json()).then(b=>console.log('version',b.version,'names',JSON.parse(Buffer.from(b.jws.split('.')[1],'base64url')).divers.length))"
```

### 壊れた時に戻す

| 何が | まずすること | 戻し方 |
|---|---|---|
| サイト（ludion.ai） | `node scripts/prod-check.mjs site` と 5xx を見る | `npx wrangler@4.144.0 deployments list --name ludion-site` で前の版を探し、`npx wrangler@4.144.0 rollback <version-id> --name ludion-site` |
| 名簿 | 5xx か、スパムか | スパム：DEPLOY.md §7.2 で新しい登録を止める。5xx：`npx wrangler@4.144.0 rollback <version-id> --config services/registry/wrangler.json`（Durable Object の中身は版に関係なく残る） |
| Card Host | `node scripts/prod-check.mjs card-host` | TLS：`node scripts/prod-check.mjs dns`（証明書が Active か、`*.agents` が Proxied か）。5xx：`npx wrangler@4.144.0 rollback <version-id> --config packages/card-host/wrangler.json`。`503 registry_unavailable` なら名簿の方を見る |
| 失効の配信 | `curl.exe -sN --max-time 20 https://registry.ludion.ai/v0/revocations/stream` | 止まっても、購読していない Gate と同じく、Staple の寿命（最長1時間）で通らなくなる。HN では正直にそう書く |
| デモのショップ | `curl.exe -s -o NUL -w "%{http_code}\n" https://shop.demo.ludion.ai/products` | サーバーを再起動する（`npm start`）。失効の購読は起動のたびに張り直される |
| npm の `ludion-ai` | 壊れた版の症状を1つ再現する | `npm unpublish` はしない。直した版を release ワークフローで出し（docs/PUBLISH.md §6.3）、壊れた版は `npm deprecate ludion-ai@<版> "<理由>"` |
| Error 1027（Free の上限） | Workers の概要で確かめる | Workers Paid にする（お金。人間） |
| 上限がきつすぎる | 正規の人の 429 の報告 | DEPLOY.md §7.1：`REGISTRY_LIMITS` を上げてデプロイ |

- 戻したら、HN のスレッドに「何が起きて、何をしたか」を一言書く。隠さない。
- 戻した後に、Claude に赤くなったオラクルを渡す（直すのは速いループのテストに降ろしてから）。
