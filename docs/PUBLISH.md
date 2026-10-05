# PUBLISH — npm への公開（`ludion-ai`。0.0.1 は人間が手で出した。0.1.0 から release ワークフローで）

Claude Code は publish しない。本物の release ワークフローも起動しない。ここにある手順は、人間がなぞるためのもの。
公開の前提は、PUB-1〜4 が PASS していること（`npm run scoreboard` で確かめる）。

- **PUB-1**：tarball だけから、クリーンな環境に入れて動く。
- **PUB-2**：tarball に余計なものが入っていない。
- **PUB-3**：`@ludion/*` が npm に1つもなくても入る。
- **PUB-4**：npm に出る道は release ワークフローの1本だけ（§6）。

## 0. 公開するもの：`ludion-ai` の1本だけ（ADR-036、docs/adr/2026-10-05-npm-name-ludion-ai.md）

- npm に出すのは `ludion-ai` だけ。リポジトリの置き場所は `packages/ludion`。
  - npm は `ludion` を、似た名前（`luxon`）の検査で断った。だから名前は `ludion-ai`。
  - コマンド名は `ludion` のまま。1回だけ動かすときは `npx ludion-ai <コマンド>`（例：`npx ludion-ai init`）。
- 中身は CLI と、サブパスの `ludion-ai/diver`、`ludion-ai/gate/node`、`ludion-ai/gate/next`（と、Next.js なしで読める `ludion-ai/gate/next/core`）、`ludion-ai/gate/workers`。
- リポジトリの中のパッケージ（`@ludion/gate-core`、`gate-node`、`gate-next`、`gate-workers`、`diver`、`scan`、`report`）は private のまま。`npm publish` の `prepack` で、`packages/ludion/build.mjs` がそれらを `lib/` に写して束ねる（`postpack` で消す。リポジトリには残らない）。
- 束ねるパッケージの一覧は `packages/ludion/vendored.mjs` の1か所。
- 依存は第三者のもの（`web-bot-auth`、`http-message-sig`、`jsonwebkey-thumbprint`、`structured-headers`）だけ。`next` は任意の peer（`ludion-ai/gate/next` を使う時だけ、アプリの Next.js を使う）。
- スコープ `@ludion` は、人間の npm のユーザー名 `ludion` がすでに持っている。Organization は作らない（無印の名前なので要らない）。

## 1. 今の状態（2026-10-05）

| 版 | 出した人 | 中身 | 状態 |
|---|---|---|---|
| 0.0.1 | 人間（手で） | 名前を押さえるための版 | 出た |
| 0.1.0 | release ワークフロー（trusted publishing） | 本物の初版 | **本番（名簿、Card Host、ludion.ai）が立った後に出す**（§6.2） |

- 名前が npm にもうあるので、手で出す版はもう要らない（trusted publisher は、npm にあるパッケージにしか設定できない。それが済んだ）。
- 確かめ方：`npm view ludion-ai versions` が `[ '0.0.1' ]` を返す。

## 2. 公開する直前に（手元で、数分）

```sh
git switch main && git pull && npm ci
npm run scoreboard                       # PUB-1〜4 が PASS、ラチェットの後退なし
cd packages/ludion && npm publish --dry-run
```

- `Tarball Contents` に、`bin/`、`lib/@ludion/…`（束ねた7つ）、`README.md`、`LICENSE`、`package.json` だけが並ぶことを確かめる。
- `test/` や `bench/` が見えたら止める。PUB-2 が落ちているはず。
- `--dry-run` は何も送らない。本物の公開は §6 のワークフローだけ。

## 3. 手で出すのは 0.0.1 だけ（済み）

- 0.0.1 は 2026-10-05 に人間が出した。これからは手で `npm publish` しない。
- §6.1 の4で「トークンでの公開を止める」を選ぶと、手元からの `npm publish` は通らなくなる。それでよい。

## 4. 公開したあとに確かめる（人間、1分）

リポジトリの外の空のディレクトリで確かめる（PowerShell でも同じ）。

```sh
mkdir ludion-check && cd ludion-check
npx --yes ludion-ai@0.1.0 scan <手元の access.log>
npm init -y && npm install ludion-ai@0.1.0
node --input-type=module -e 'await import("ludion-ai/gate/node"); await import("ludion-ai/gate/workers"); await import("ludion-ai/diver"); console.log("ok")'
```

- `npx ludion-ai` が数字を出し、`ok` が出れば公開は完了。
- npmjs.com の `ludion-ai` の版に「Provenance」が出ていれば、release ワークフローから出たもの。
- 気になる点が見つかったら、`npm deprecate` で「使わないで」の印を付ける。`npm unpublish` は72時間を過ぎると使えないので、慌てて消さない。

## 5. 公開しないもの・注意

- `LUDION_ROOT_PASSPHRASE`、`ludion.json`、鍵のファイルは、どの tarball にも入らない。PUB-2 と REG-4 が検査している。
- npm のトークンは CI に置かない。release ワークフローは、人間が起動して承認したときだけ動き、トークンを持たない（OIDC）。
- Claude は publish しない（本物の release ワークフローも起動しない。dry run だけ）。

## 6. release ワークフロー（trusted publishing）

`.github/workflows/release.yml` が、GitHub Actions から npm の trusted publishing（OIDC）で出す。npm のトークンはどこにも無い。npm は出した版に provenance（どのリポジトリのどのワークフローで作られたか）を自動で付ける。PUB-4 がこの道の形を検査している。

- 起動は手動（Actions → release → Run workflow）だけ。main からだけ。
- environment `npm` で止まり、人間が承認するまで進まない。
- 公開の前に、同じコミットで PUB-1〜3 を回す。落ちたら何も出さない。
- npm にすでにある版は飛ばす。最初の失敗で残りを止める。
- 既定は dry run（何も送らない）。本番は `dry_run` のチェックを外して起動する。
- npm がまだ知らないパッケージは拒否する（`ludion-ai` は 0.0.1 があるので通る）。

### 6.1 最初に一度だけ

1. **GitHub の environment `npm`**：**済み**（2026-10-05、Claude が `gh api` で一度だけ設定した。記録は docs/STATE.lane3.md）。
   - Required reviewers：`Ludion-ai`。ワークフローは承認まで止まる。
   - Deployment branches：`main` だけ（custom branch policy）。
   - 「Prevent self-review」は**使わない**。人間が一人の間は、起動する人と承認する人が同じなので、有効にすると誰も承認できなくなる。人が増えたら有効にする。
   - 確かめ方（PowerShell）：
     ```powershell
     gh api repos/Ludion-ai/Ludion/environments/npm --jq '{reviewers: [.protection_rules[] | select(.reviewers != null) | .reviewers[].reviewer.login], prevent_self_review: [.protection_rules[] | select(.reviewers != null) | .prevent_self_review], policy: .deployment_branch_policy}'
     gh api repos/Ludion-ai/Ludion/environments/npm/deployment-branch-policies --jq '[.branch_policies[].name]'
     ```
     `reviewers` が `["Ludion-ai"]`、`prevent_self_review` が `[false]`、`policy` が `{"custom_branch_policies":true,"protected_branches":false}`、2行目が `["main"]` なら正しい（jq の式に二重引用符を使っていないので、PowerShell でもそのまま貼れる）。
   - これ以降、Claude の GitHub の権限は人間が絞る。environment を変えるときは、人間が Settings → Environments → `npm` で行う。
   - 注意：Claude の `gh` が人間と同じアカウント `Ludion-ai` のトークンを持っている間は、承認の関所は Claude からも押せる。関所を Claude から切り離すには、Claude のトークンを、Actions の承認ができない細かいもの（fine-grained、Deployments の書き込みなし）にする。
2. **npm の trusted publisher**（人間が貼るだけ。2段階認証が要る）：
   - npm の版：**11.15.0 以上**（`npm trust` の前提。npm の文書による）。`npm -v` で確かめる。古ければ `npm install -g npm@latest`。この機械は 12.2.0 で、`npm trust github --help` に `--allow-publish` があることを確かめた。
   - npm のアカウントで2段階認証が有効なこと。ログインは `npm login`（ブラウザで）。2FA を飛ばす設定の細かいトークンや、昔のユーザー名とパスワードでは `npm trust` は通らない。
   - 貼るコマンド（どのディレクトリからでもよい。パッケージ名を書いているので）：
     ```powershell
     npm trust github ludion-ai --repo Ludion-ai/Ludion --file release.yml --env npm --allow-publish
     ```
     2段階認証を聞かれたら、出てくる URL をブラウザで開いて承認する。
   - 確かめ方：`npm trust list ludion-ai` に、`Ludion-ai/Ludion`、`release.yml`、`npm` の1行が出る。
   - npm はパッケージごとに設定を1つしか持てない。打ち間違えたら `npm trust list ludion-ai` で id を見て、`npm trust revoke ludion-ai --id=<id>` で消してから貼り直す。
3. **トークンでの公開を止める**（人間、npmjs.com）：`ludion-ai` → Settings → Publishing access → 「Require two-factor authentication and disallow tokens」→ Update Package Settings。trusted publishing はこの設定でも通る（npm の推奨）。

### 6.2 0.1.0 を出す（本番が立った後。人間）

1. 版を 0.1.0 に上げる PR（`packages/ludion/package.json`）。Claude が作ってよい。main に入れる。
2. Actions → release → Run workflow。`packages` は `all`（`ludion-ai` だけ）。まず `dry_run` のまま回し、environment `npm` の承認を押す。
   - PowerShell なら：`gh workflow run release.yml --ref main -f packages=all -f dry_run=true`
3. 緑なら、`dry_run` を外してもう一度起動し、承認を押す。
   - PowerShell なら：`gh workflow run release.yml --ref main -f packages=all -f dry_run=false`
4. §4 のとおり確かめる。

### 6.3 版を出すたびに

1. `packages/ludion/package.json` の版を上げる。PR にして main に入れる。
2. §6.2 の2〜4と同じ。
