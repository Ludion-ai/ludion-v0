# 朝の報告（レーン2、2026-10-06）

書いた時刻：（下の「書いた時刻」）。夜間モード：人間に聞かず、spec に一番合う方で進めた。外への書き込み、公開、デプロイ、GitHub の設定変更、外のページの読み込みはしていない（夜間モードの指示が届く前に、#128 に PR のコメントを1つ書いた）。

## 終わったもの

| | 中身 | 状態 |
|---|---|---|
| MND-1〜4 | 運営者が Root 鍵で自分のエージェントにかける Mandate（`prn: "self"`）。名簿の発行と取り消し（Root の署名だけ）、CLI の `npx ludion-ai mandate create/list/revoke`、SDK の `mandateFor`、受領証と1時間の集計に委任の判定、help のページ | #128 マージ済み |
| DEMO-1 | `examples/demo-shop`：店（経路ごとに scope）と、乗っ取られるエージェント。範囲の中は通り、罠のパスワード変更と削除は 403 `mandate_scope`（SDK でも、盗んだ Session 鍵で手で署名しても）、Root の無い作り直しは名簿が 401、revoke で全部 REVOKED。60秒の台本も書き直した | #129（CI 待ち、auto-merge） |
| MSG-1 | README の冒頭（英日）、トップページ（英日）、show-hn.md、faq.md を3つの問いと「Ludion が防がないもの」で書き直した。言い過ぎの語の検査つき | #132（CI 待ち、auto-merge） |
| MND-5（任意） | SDK の側のシートベルト：`mandateFor(me, { strict: true })` で、範囲の外の要求は署名も送信もしない（Gate の無いサイトでも） | ブランチ `lane2/mnd5`（push 済み）。PR は2本の枠が空いたら |
| CEN-1・2 | census（`/census`、`/ja/census`）と各社への連絡の下書き5通 | **手元だけ**（`lane2/census-local`、push していない）。下の判断の1 |

## PASS の数

- レーン2の系列（9件）：手元で全部 PASS（MND-1〜5、DEMO-1、CEN-1・2、MSG-1）。main では MND-1〜4 の4件。
- 全オラクル（手元、`lane2/mnd5` の上）：（下の「全体の scoreboard」）

## 朝に見てほしい判断

詳しくは `docs/STATE.lane2.md` の「朝に見てほしい判断」（16項目）。急ぐものだけ：

1. **census を出すか**。リポジトリが公開なので、PR を出すだけで各社の名前と値が、事前連絡より先に見える。夜は出さずに手元に置いた。「出す」なら、すぐ PR にする。値は手元の資料（レーン1が 2026-10-04 に各社の公開文書を読んだメモと、GATE-8 の検証）だけで作った。Claude in Chrome、Comet、Microsoft Copilot はまだ確かめていない（昼に読む）。
2. **MND-3 の `sub` 違い**：spec は 403 `mandate_required`。PRS-2（ラチェット済み）が 401 `invalid_signature` に固めているので、そのままにした（より厳しい）。spec に合わせるなら、PRS-2 と GATE-7 の期待を変える判断が要る。
3. **`per_day` は「1日の決済の回数」のまま**（PRS-3、10-02 に確認済み）。だから `checkout` の Mandate には `--checkout-max` と `--currency` が要り、spec §3.2 の例のコマンドにこの2つを足した。
4. **HN のタイトル**は、レーン2 spec の「Identity, limits and a kill switch for AI agents」にした（親 spec §20.1 の推奨と違う）。トップページの中心も3つの問いに変えた。
5. **検証器の対照の更新**：1時間の集計の行に `mandate` を足したので、行のキーを手で並べていた PRIV-4 の対照と SEED-2 の e2e に足した（判定は変えていない）。

## 人間待ち

- census を出すかの判断と、各社への連絡（5通の下書きは手元のブランチ。送るのは人間、公開は 10/13）。
- MND-3 の `sub` 違い（上の2）。
- （任意）録画で `agent.mjs --model` を使うなら `ANTHROPIC_API_KEY`（一度も動かしていない）。
- 前からのもの：tracecheck.dev へのデプロイと PILOT-2 のトークン、`SECURITY.md` の約束、毎朝のレポートの Webhook（任意）。
