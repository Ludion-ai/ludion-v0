# npm での名前は `ludion-ai`。コマンドは `ludion` のまま

日付：2026-10-05（人間の指示、レーン3 spec の1。docs/lanes/lane3-spec.md）

## 決定

- npm に出す1本（ADR-036）の名前を、`ludion` から `ludion-ai` に変える。リポジトリの置き場所は `packages/ludion` のまま。
- コマンド名（`bin`）は `ludion` のまま。入れる時と1回だけ動かす時は `npx ludion-ai <コマンド>`（例：`npx ludion-ai init`）。
- import は `ludion-ai/gate/node`、`ludion-ai/gate/next`、`ludion-ai/gate/workers`、`ludion-ai/diver`。サイトは `npm install ludion-ai`。
- `ludion-ai` 0.0.1（名前を押さえるための版）は、人間が手で出した（2026-10-05）。本物の初版 0.1.0 は、本番が立った後に release ワークフロー（`.github/workflows/release.yml`、trusted publishing）から出す。名前が npm にもうあるので、手で出す版はもう要らない。
- スコープ `@ludion` は、人間の npm のユーザー名 `ludion` がすでに持っている。Organization は作らない。リポジトリの中の `@ludion/*` は今までどおり private で、`ludion-ai` の tarball に束ねる。

## 理由

- npm は `ludion` を、既存のパッケージ `luxon` に似た名前だとして断った（似た名前の検査。typosquatting を防ぐための npm の規則）。人間が 2026-10-05 に試して分かった。
- 断られた名前は、こちらからは変えられない。npm に例外を頼むのは時間が読めず、ローンチ（10/13）に間に合う保証がない。
- コマンドを `ludion` のまま残せば、CLI のコード、`ludion.json`、`ludion.config.json`、ヘッダー名（`Ludion-*`）、受領証は何も変わらない。変わるのは「どこから取ってくるか」の1語だけ。

## 影響

- 文書・サイト・オラクルの `npx ludion` と `npm install ludion` と `ludion/…` の import を `ludion-ai` に変えた（このレーンの PR）。WEB-12 と WEB-13 には、断られた名前（`ludion/…`）のページを捕まえる負の例を足した。
- `npx ludion …` は、`ludion-ai` を入れたディレクトリの中では今も動く（`.bin/ludion`）。入れていない所では npm の `ludion` を探しに行って失敗する。だから文書は全部 `npx ludion-ai` に揃える。
- 変えていないもの（持ち主が変える）：
  - レーン2の持つファイル（README の冒頭、トップページ、`show-hn.md`、`faq.md`、`demo-script.md`）。
  - spec（`docs/ludion-spec.md`）の `npx ludion init` の記述。この ADR が優先する（CLAUDE.md の「違う判断をしたら ADR を1枚」）。次の spec の版で直す提案を `docs/outbox/spec-v2-diff.md` に書いた。
  - CLAUDE.md の「npx ludion init の1行」。人間の文書なので、そのまま。
  - ADR-036 の本文。歴史として残し、名前はこの ADR が上書きする。
  - PyPI の名前（`ludion`）。npm とは別の話で、ローンチの後。

## 捨てた代替案

- **`@ludion/cli` などスコープ付きの名前**：`npx @ludion/cli init` は長く、覚えにくい。`@ludion` を人間のユーザー名が持つので出せはするが、1行の体験（spec §9）を短く保つほうを選んだ。
- **npm に例外を申し立てて `ludion` を取る**：期限が読めない。取れたら `ludion` を `ludion-ai` の別名として出すかを、その時に決める。
- **`ludion` の名前を諦めて CLI 名も変える**：コード、ファイル名、文書の変更が大きく、利益がない。

## 見直す条件

npm が `ludion` を使わせてくれた時。

## 出典

docs/lanes/lane3-spec.md の1。ADR-036。PUB-1〜4、WEB-7、WEB-10、WEB-12、WEB-13。
