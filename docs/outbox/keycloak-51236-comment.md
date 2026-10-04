# 投稿済み：keycloak/keycloak#51236 へのコメント（2026-10-04、人間の許可で Claude が投稿。https://github.com/keycloak/keycloak/issues/51236#issuecomment-5977718433 。再現のリンクは、案 C の前のコミット bfb8dc7 に向けた）

- 宛先：https://github.com/keycloak/keycloak/issues/51236 （CIMD: authorization request rejected when Client ID Metadata Document contains unknown properties）
- 関連：修正の PR https://github.com/keycloak/keycloak/pull/51235 （2026-10-04 時点で open、未マージ）
- 目的：同じ不具合で、Web Bot Auth の名札（Signature Agent Card）も拒まれることを、再現手順つきで伝える。修正の優先度を上げてもらう。
- 投稿は対外の書き込みなので人間がやる（CLAUDE.md「人間に渡すもの」）。会社としての約束は含めていない。

---

**Comment (English):**

We hit the same failure with Web Bot Auth "Signature Agent Cards" used as CIMD documents, on **26.8.0** (`--features=cimd`).

A Signature Agent Card (draft-meunier-webbotauth-registry) is a CIMD document plus a `web_bot_auth` object, and issuers may add their own namespaced object (ours is `ludion`). With the CIMD executor enabled, the authorization request fails before any policy check:

```
WARN  [org.keycloak.protocol.oauth2.cimd.clientpolicy.executor.ClientIdMetadataDocumentExecutor]
HTTP connection failure: com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException:
Unrecognized field "web_bot_auth" (class org.keycloak.representations.oidc.OIDCClientRepresentation), not marked as ignorable
... client_policy_error_detail="Client Metadata fetch failed"
```

What we checked, all on 26.8.0 with an in-memory realm (`client-id-uri` condition + `client-id-metadata-document` executor, `only-allow-confidential-client`):

- The card as published (with `web_bot_auth` and `ludion`): rejected as above, at the authorization request.
- The same card with only those two members removed: authorization code with PKCE to a loopback redirect (`http://127.0.0.1/callback`, any port), consent, then `private_key_jwt` with an Ed25519 key from `jwks_uri` → token issued, `azp` = the card URL. So everything else works; only the unknown members break it.

RFC 7591 §2 says the authorization server MUST ignore client metadata it does not understand, and CIMD documents are written by third parties, so unknown members will be common (the ChatGPT and Lovable cases above are the same failure). #51235's approach (ignore unknown properties when parsing CIMD documents) fixes our case too.

Reproduction (Node + Java 21, no Docker): https://github.com/Ludion-ai/Ludion/tree/main/accept/mcp — `mcp.test.mjs` starts Keycloak 26.8.0 with `--features=cimd`, serves the card over TLS, and runs the flow; its failure message prints the reason from Keycloak's log and the result of the control without the extension members.

---

## 補足（人間向け）

- リンク先の `accept/mcp` は、この PR がマージされてから有効になる。投稿はマージの後に。
- 公開リポジトリを名指しするので、投稿すると Ludion の名前が Keycloak の issue に出る。
