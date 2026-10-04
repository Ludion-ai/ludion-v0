# Python の Diver は pyauth の上に作り、RFC 9421 の食い違い 3 つを自前で直す。JS と同じファイルを読み書きする

日付：2026-09-30（2026-10-04 に main へ。spec v2.0 の ADR-028 と番号がぶつかるので、日付の名前にした）

## 決定

1. **`python/ludion`**：Python の Diver SDK。
   - 提供するもの：`python -m ludion init|sign`、`Diver`、`DiverAuth`。
   - `DiverAuth` は `auth(request) -> request` の呼び出し可能オブジェクト。httpx、requests、urllib のどれにも `auth=` でそのまま渡せる。どれも依存にしない。
2. **JS の CLI とバイト互換**：`ludion.json`、封をした Root（ADR-019 の形式）、サムプリント、diver_id、ディレクトリ、Card を JS と同じにする。
   - 封の中身は JS と同じ：scrypt（N=2^17、r=8、p=1）、AES-256-GCM、AAD は `ludion-root-v1\n` と公開鍵・kid の JSON。
   - どちらの言語で作った身元も、もう一方で開ける。DIV-1 は、Python が封をした Root を JS の `openRootKey` で開いて確かめる。
3. **暗号の置き場所**：暗号プリミティブは `cryptography`（OpenSSL）だけ使い、呼び出しは `python/ludion/_crypto.py` の 1 モジュールに閉じる。
   - 閉じ込めるもの：Ed25519 の生成と公開鍵の導出、scrypt、AES-256-GCM。
   - 署名そのものは `http-message-signatures` の中で行う。鍵オブジェクトは `_crypto` が渡す。
   - CRY-1 の走査は今 `packages/` と `services/` しか見ていない。`python/` は、この規則を人の目で守っている段階。
4. **署名ベースの組み立て**：`http-message-signatures`（pyauth）2.0.1 に任せる。ただしコンポーネントの解決だけは `_ConformantResolver` に差し替え、STD-3 で見つかった RFC 9421 の不適合 3 つを直す。
   - §2.1.2 の `key`
   - §2.2.3 の既定ポート
   - §2.2.6 の空のパス
   
   上流への報告は `docs/outbox/2026-09-30-pyhms-*.md` に下書きした。直ったら差し替えを外す。
5. **配布**：wheel は `python/pyproject.toml`（flit_core）からローカルで作る。ビルドの backend は `clean-room/build.lock` でハッシュ固定する。PyPI への publish は人間の仕事（CLAUDE.md）。

## 理由

- **署名ベースを自前で書かない理由**：自前で書けば、この repo の中に 2 つ目の RFC 9421 実装を持つことになる。構造化フィールドの直列化は細部で間違えやすい。pyauth の直列化と構文解析をそのまま使い、差分は標準の条文 1 つずつに対応した小さな上書きに留める。こうすれば、何を直したかが監査できる。
- **呼び出し可能な `auth` にした理由**：spec §12.3 の例（`httpx.Client(auth=DiverAuth.from_env())`）が、依存を増やさずにそのまま動く。
- **CLI の出力の扱い**：CLI は ✔ や ⚠ を出力する。日本語の Windows の cp932 のように、それを表せないコンソールでは stdout を `errors="replace"` にする。
  - DIV-1 の最初の実行で、`python -m ludion init` がここで落ちることが分かった。
  - 速いテストに降ろして固定した（`clean-room/div1.test.mjs`）。

## 捨てた代替案

- **署名ベースを Python で自作する**：上に書いた理由。
- **pyauth を fork する**：上流に直してもらう方が世界のためになる。
- **Python の SDK を JS の CLI のラッパーにする**：Node が要る Python の SDK は、3 分で入らない。

## 見直す条件

- pyauth が 3 つの不適合を直したとき。そのときは差し替えを外す。STD-3 の上流テストが反転して知らせる。
- CRY-1 の走査を `python/` にも広げるとき。
- Root の保管を KMS や OS のキーチェーンに移すとき。JS と同時に移す。
