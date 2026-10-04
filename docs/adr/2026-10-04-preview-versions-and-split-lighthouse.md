# プレビューは版ごとの URL で測り、Lighthouse を3台に分ける（LOOP-2）

- 日付：2026-10-04
- 決めた人：形は人間（2026-10-04 の指示の1）、仕組みは Claude
- 関係するオラクル：LOOP-2、WEB-1（WEB-5 と対）

## 背景

- WEB-1 は、プレビューの全ページで Lighthouse を各3回回す。手元で約9分かかる。これだけで LOOP-2 の10分（main への push の全ジョブ、最初の開始から最後の完了まで）を越える。
- Lighthouse を同じ機械で並べると揺れる。分けるなら別のランナーになる。
- プレビューは1つの Worker。デプロイと検査をジョブの間で1つの鍵で守ることは、GitHub Actions ではできない。

## 決定

1. **いつ回すか**（人間の指示）
   - main への push では、いつも回す。プレビューに出し（live）、プレビューはいつも main を見せる。
   - PR では、サイトの元になるもの（`site/` と、ビルドが同梱するファイル。`siteHash()` が読むもの）か、`.github/workflows/ci.yml` に触れた時だけ回す（`site/changed.mjs`）。PR は版を上げるだけで、live は変えない。
2. **版ごとの URL を測る**
   - Cloudflare は版ごとに preview URL を持つ：`https://<版の id の先頭8文字>-ludion-site-preview.<subdomain>.workers.dev`（`wrangler.json` の `preview_urls: true`）。
   - その URL は、その版のビルドだけを配り続ける。だから、別の実行がデプロイしても、測るものは変わらない。
   - ジョブをまたぐ鍵は要らない。live のデプロイだけを、`concurrency` で順番に並べる。
   - `site/preview.json` に `version_url` を書き、WEB-1 はそれを測る。手元でも同じなので、もう1本のレーンがプレビューを出し直しても、手元の WEB-1 は「古い」で落ちなくなる。
3. **Lighthouse を3台に分ける**
   - `preview-deploy` が一度だけビルドしてデプロイし、`dist` と `preview.json` を渡す。
   - `preview-lighthouse (1/3)〜(3/3)` は、ページを3つおきに分けて並列に測る（英日が偏らない）。
   - `preview` ジョブは何も測らない。3つの結果を `site/test/web1-parts.mjs` の規則で判定してから、ラチェットにかける。
     - 規則：各部分がちょうど1回。このビルド（siteHash）とこの URL から。全ページがちょうど1回。全項目が95以上。
     - 落ちた部分や届かなかった部分は「欠け」として WEB-1 を落とす。
4. **版の URL の `X-Robots-Tag: noindex`**
   - Cloudflare は版の URL にこのヘッダーを足す。live の URL には足さない（2026-10-04 に確かめた）。
   - これがあると、Lighthouse の SEO の監査 `is-crawlable` が落ち、どのページも SEO が 66 になる。サイト自身はこのヘッダーを送っていない。
   - 対処：測る前に、live の URL がこのヘッダーを送らないことを確かめる。そのうえで、版の URL の応答を1バイトも変えずに中継し（状態、ヘッダー、圧縮したままの本文）、`X-Robots-Tag: noindex` の1つだけを外す中継（`site/test/relay.mjs`）を通して測る。
   - 閾値も、監査の項目も変えていない。中継が外すのは、ちょうどその値のときだけ。他の値（`nofollow` など）は残す。速いテストで確かめた。

## 測ったこと（手元、Windows、2026-10-04）

- 版の URL は自分のビルドを返す（`/_build.json` が siteHash と一致）。live は main のビルドのまま。
- 中継なし：12ページすべてで SEO が 66（`is-crawlable 0`）。
- 中継あり：3つの部分が12ページずつ。どれも最低の中央値は 100。判定のジョブは36ページちょうど1回ずつを受け入れた。

## 未確認

- CI での時間。`preview` のジョブの secret が入ったら、main への push の実行で3回測って人間に報告する（人間の指示）。

## 見直す条件

- Cloudflare が版の URL の `noindex` をやめたとき（中継が要らなくなる）。あるいは別のヘッダーを足したとき。
- 10分に収まらないとき：分割の数を増やす。あるいはデプロイのジョブの準備（`npm ci` とサイトの依存）をキャッシュする。
