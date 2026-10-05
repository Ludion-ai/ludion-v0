# spec への提案：npm の名前を `ludion-ai` に（2026-10-05、レーン3）

spec 本体は、人間が承認してから直す。`docs/outbox/spec-v2-diff.md` は他のレーンも足しているので、ぶつからないように別のファイルにした。決定そのものは docs/adr/2026-10-05-npm-name-ludion-ai.md（ADR が spec に優先する）。

| 条項 | 現状 | 提案 |
|---|---|---|
| §9、§13.1、§20.2 などの `npx ludion init` と、ほかの `npx ludion …` | npm の `ludion` を前提にしている。npm は `ludion` を似た名前（`luxon`）の検査で断った | 全部 `npx ludion-ai …` にする。コマンド名は `ludion` のまま（入れたディレクトリでは `npx ludion …` も動く）と1行添える |
| §10.3、§13.2 の import と `npm install` | `ludion/gate/…`、`ludion/diver`、`npm install ludion` | `ludion-ai/gate/…`、`ludion-ai/diver`、`npm install ludion-ai` |
| §20.2 ローンチの条件「npm に `ludion` を公開済み」 | `ludion` | 「npm に `ludion-ai` の 0.1.0 を、release ワークフロー（trusted publishing）から公開済み」。0.0.1 は名前を押さえるための版で、人間が手で出した |

spec の中の数は、`git grep -n -E "npx ludion|npm install ludion|ludion/(gate|diver)" docs/ludion-spec.md` で出る（2026-10-05 に20行）。
