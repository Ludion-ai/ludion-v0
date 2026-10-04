# ローンチの下書き（Show HN、2026-10-13 22:00 JST）

外に出すのは人間。Claude は下書きだけを置く（CLAUDE.md「人間に渡すもの」）。

| ファイル | 中身 |
|---|---|
| `show-hn.md` | タイトル、本文、最初のコメント（英語）。tracecheck の数字は空欄（PILOT-2 が PASS してから埋める） |
| `faq.md` | スレッドの想定問答（英語、各3行まで）：Cloudflare との違い、mTLS、CIMD はまだ標準でない、プライバシー、誰が払うか、ブラウザの中の AI |
| `runbook.md` | ローンチ当日の手順書：前日の確認（LIVE、きれいな環境での npm i と init→VERIFIED、デモのサイトの失効の購読）、投稿の前の5分、当日に見る数字、壊れた時に戻す手順 |
| `demo-script.md` | 60秒のデモの台本：init → 名前 → Web と MCP で使う → revoke。本番が立ったら録る |
| `private/registry-preseed.json` | 名簿の事前登録（spec §14.2 の10件）。**リポジトリに入れていない**（`.gitignore`）。このリポジトリは公開なので、入れると公開になる。Q21（各社へ事前に連絡するか）は人間の判断待ち。作業ツリー `C:\Users\haya0\ludion` にだけある |

出す前に確かめること：

- npm に `ludion` がある。名簿（`registry.ludion.ai`）と Card Host（`*.agents.ludion.ai`、ACM の証明書）が動いている。
- ludion.ai を main のビルドで出し直した。2026-10-04 の本番は古いビルドで、`/quickstart` と `/agent` が 404。LIVE-4 がもう一度見る。
- 本文の数字と主張が、出す日のオラクルと合っている。3行以内は GATE-3、Keycloak は MCP-1、1時間以内は Staple の寿命。
