# Ludion レーン3 spec：公開と運用

版：2026-10-05｜置き場所：`docs/lanes/lane3-spec.md`｜親：`docs/ludion-spec.md`｜レーン2：`docs/lanes/lane2-spec.md`

> 人間の指示を、そのまま保存したもの。親 spec と食い違ったら親が正しい。

あなたはレーン3（公開と運用）だ。最初に、この指示を docs/lanes/lane3-spec.md として保存しろ。
親 spec は docs/ludion-spec.md。レーン2の指示は docs/lanes/lane2-spec.md にある。

## ■ 境界

- 作業ツリー：今いる ../ludion-lane3。他のレーンの作業ツリーには触らない。
- ブランチ：lane3/ で始める。状態の記録：docs/STATE.lane3.md。
- オラクルの系列：PUB と LOOP だけを使う。ratchet.json は書かない（ラチェットはレーン1）。
- 持つファイル：packages/ludion/、.github/workflows/、docs/PUBLISH.md、docs/DEPLOY.md、docs/outbox/launch/runbook.md、各 wrangler の設定ファイル。
- 触らないもの：
  - レーン2の持つファイル：README の冒頭、トップページ、show-hn.md、faq.md、demo-script.md、census、Mandate 関係。
  - レーン1の持つもの：名簿・Gate・diver のソース。
  - .claude/settings.json。
- やらないこと：npm への公開、本番へのデプロイ、本番の release ワークフローの起動。これらは人間がやる。
- 秘密の値は見ない。人間が自分の PowerShell で入れる形にする。

## ■ 今日やること（この順）

1. 公開名を ludion から ludion-ai に変えろ。
   - npm で ludion は、luxon に似ているという理由で断られた。ludion-ai 0.0.1（名前を押さえるための版）は、人間が出した。
   - 変えるもの：packages/ludion/package.json の name、ドキュメントとサイトの import と npx のコマンド、PUB と WEB のオラクルの対象。
   - レーン2の持つファイルは、レーン2が自分で変える。触るな。
   - コマンド名（bin）は ludion のまま残せ。
   - ADR を1枚書け（理由：npm の似た名前の検査）。@ludion の名前空間は、人間のユーザー名 ludion がすでに持っている。Organization は要らない。
2. PUBLISH.md を直せ。
   - 0.0.1 はもう出た。本物の初版 0.1.0 は、本番が立った後に release.yml から出す。
   - §6.1 の「Prevent self-review」は、人間が一人の間は使わない。
3. 今の gh のログインで、environment npm を一度だけ設定しろ（gh api を使う）。
   - Required reviewers は Ludion-ai、Deployment branches は main だけ。
   - 設定したら gh api で読み出して確かめ、STATE.lane3.md に書け。
   - この後、人間があなたの GitHub の権限を絞る。それ以降の設定の変更は、手順を書いて人間に渡せ。
4. npm の Trusted Publisher を設定するコマンドを、人間が貼るだけの形で用意しろ。
   - 形：npm trust github ludion-ai --repo Ludion-ai/Ludion --file release.yml --env npm --allow-publish
   - 必要な npm の版も書け。実行するのは人間（2FA が要る）。
5. プレビュー用の secret の手順を、2行にまとめろ。人間が自分の PowerShell で gh secret set を打つ形にする。
6. 人間がやることを「押すボタンだけ」の一覧にして、返事の最後に出せ。

## ■ 次にやること（10/7 まで）

7. DEPLOY.md を、人間が上から順にやるだけで済む形に仕上げろ。
   - 順番：ACM → 証明書 → DNS → 名簿と Card Host のデプロイ → ludion.ai を main から出し直す。
   - 各段に、終わったことを確かめるコマンドを1つずつ付ける。
8. secret が入ったら、LOOP-2 を測れ（push を3回回して、10分に収まるか）。
9. runbook.md を、改名と新しい中心（3つの問い）に合わせて直せ。
10. 人間が本番を立てたら、LIVE-1〜3 を回して報告しろ。

## ■ 報告

毎日の終わりに1行：PUB と LOOP の PASS の数と、人間待ちの一覧。
