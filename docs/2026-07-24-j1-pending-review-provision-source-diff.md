# J1 待审 diff — provision.mjs --source 参数（临时文档，NWT 审完可删）

> **Status**: CURRENT（临时·M0a manifest content_digest 待更新，非最终代码状态，仅用于跨节点 diff 传递，NWT 审完给 review_ref 后本文档可删除）

背景：`kasia-console/scripts/m0c1-grant-provision.mjs` 受 M0a manifest `content_digest` 锁定（provision-writer capability，最敏感能力，扩张需 NWT 审 + Owner 知情）。working tree 有未提交改动（加 `--source` CLI 参数，Path B pilot 围栏 §2.1 用），pre-commit hook 正确拦下，正常走审批链。J1 是独立节点，无法用 scratch 共享文件传递，改用此临时 docs 文件（不受 digest 锁定）传递完整 diff。

```diff
diff --git a/kasia-console/scripts/m0c1-grant-provision.mjs b/kasia-console/scripts/m0c1-grant-provision.mjs
index 8d414f6b..5ef3d327 100644
--- a/kasia-console/scripts/m0c1-grant-provision.mjs
+++ b/kasia-console/scripts/m0c1-grant-provision.mjs
@@ -12,8 +12,9 @@
 //   node kasia-console/scripts/m0c1-grant-provision.mjs gen-key
 //   node kasia-console/scripts/m0c1-grant-provision.mjs issue \
 //     --app-key-id <id> --app-pubkey <xonly-hex> --commands <a,b,c> --relay <relay_node_id[,..]> \
-//     --network <testnet-12> [--payee <addr1,addr2>] [--max-amount-kas <N>] [--market <m1,m2>] \
-//     [--branch <b1,b2>] [--valid-days <30>] [--intent-version <1>] [--db <path>]
+//     --network <testnet-12> [--payee <addr1,addr2>] [--source <addr1,addr2>] [--max-amount-kas <N>] \
+//     [--market <m1,m2>] [--branch <b1,b2>] [--valid-days <30>] [--intent-version <1>] [--db <path>]
+//     (--source = Path B pilot 围栏 §2.1: custodial_transfer 限定 fromAddress 出账源钱包集合)
 //   node kasia-console/scripts/m0c1-grant-provision.mjs revoke --grant-id <G> [--db <path>]
 //   node kasia-console/scripts/m0c1-grant-provision.mjs list [--db <path>]
 //
@@ -97,6 +98,7 @@ async function main() {
       outpoint_scope: null, // 复杂结构维度精判归 M0c-2, 本脚本乙期不放开
       branch_scope: args.branch ? JSON.stringify(csv(args.branch)) : null,
       payee_scope: args.payee ? JSON.stringify(csv(args.payee)) : null,
+      source_scope: args.source ? JSON.stringify(csv(args.source)) : null, // Path B pilot 围栏 §2.1: 限定 fromAddress 出账源钱包集合
       max_amount_sompi: args['max-amount-kas'] ? kasToSompiInt(args['max-amount-kas']) : null,
       max_cumulative_sompi: null, // 累计上限 enforcement 归 M0c-3 审计派生
       max_fee_sompi: null,
@@ -108,12 +110,12 @@ async function main() {
     db.prepare(`
       INSERT INTO ${M0C1_GRANT_TABLE} (
         grant_id, app_key_id, app_pubkey, allowed_commands, typed_intent_version,
-        relay_scope, network, market_scope, outpoint_scope, branch_scope, payee_scope,
+        relay_scope, network, market_scope, outpoint_scope, branch_scope, payee_scope, source_scope,
         max_amount_sompi, max_cumulative_sompi, max_fee_sompi,
         valid_from, valid_until, grant_version, created_at
       ) VALUES (
         @grant_id, @app_key_id, @app_pubkey, @allowed_commands, @typed_intent_version,
-        @relay_scope, @network, @market_scope, @outpoint_scope, @branch_scope, @payee_scope,
+        @relay_scope, @network, @market_scope, @outpoint_scope, @branch_scope, @payee_scope, @source_scope,
         @max_amount_sompi, @max_cumulative_sompi, @max_fee_sompi,
         @valid_from, @valid_until, @grant_version, @created_at
       )
```

三处改动：① usage 注释加 `--source` 说明 ② row 对象加 `source_scope` 字段（跟 `payee_scope` 完全同构，`args.source` 存在则 JSON 数组否则 null）③ INSERT 语句列清单 + VALUES 占位符各加一处。零新逻辑分支，纯字段透传（跟既有 `--payee`/`--market`/`--branch` 同一模式）。

对应设计：`docs/2026-07-23-m0c-1-path-b-pilot-containment-relay-side.md` §1。已在 `scratch/j1-custodial-binder-smoketest.mjs` 用例 ⑦⑧ 本地跑通（用这份未提交的 provision.mjs 改动签发带 `source_scope` 的 grant）。
