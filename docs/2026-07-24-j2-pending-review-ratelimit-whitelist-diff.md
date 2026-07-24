# 待审 diff — J2 ②③限流+白名单落码 (M0a manifest 更新前置)

> NWT 审用临时传递文件(同今夜 j1-pending-review 模式)。审完给 review_ref，J2 更新 manifest digest+正式 commit 后本文件删除。

new digest（`kasia-console/src/api/capability.js`）: `ec2ad6ef8ef418eb4befc3f36d7b097f0afbfbd692d8764f9f8095e185dc0adc`

```diff
diff --git a/kasia-console/src/api/capability.js b/kasia-console/src/api/capability.js
index 649a656c..b33da2f3 100644
--- a/kasia-console/src/api/capability.js
+++ b/kasia-console/src/api/capability.js
@@ -43,10 +43,40 @@ function getGrantFreshGateway(grantId) {
   }
 }
 
+// Path B 围栏 §2.4（docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md）：进程外限流参数
+// （Bettor ratify 数值）——每 grant_id 每 RATE_LIMIT_WINDOW_MS 窗口内 ≤ RATE_LIMIT_MAX 次请求。
+const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟
+const RATE_LIMIT_MAX = 3; // 每 grant_id 每分钟 3 笔（J1 `19:44:07` 提案，Bettor ratify）
+const RATE_LIMIT_CLEANUP_MULTIPLE = 10; // 清理超过 10 倍窗口的旧行，自清理不另起 cron
+
+/**
+ * Path B 围栏 §2.4：进程外（DB 持久化，非内存计数器）限流，keyed by app-grant（Bettor 原话）——
+ * 用 env.grant_id 这个**未验证的声明值**（签名验证之前，见 §2.4 母卡诚实标注：NWT note 已定性
+ * 这是可用性风险非资金安全风险，第三方可耗合法 app 配额但转不出钱，Bettor accept for pilot）。
+ * 返回 { ok:true } 或 { ok:false, error }。fail-closed：DB 异常算拒绝，不放行。
+ */
+function checkRateLimit(grantId) {
+  const now = Date.now();
+  try {
+    // 自清理：每次检查顺带删除超过 10 倍窗口的旧行，不需要独立 cron/daemon。
+    sqlite.prepare('DELETE FROM pilot_rate_limit_log WHERE requested_at < ?').run(now - RATE_LIMIT_WINDOW_MS * RATE_LIMIT_CLEANUP_MULTIPLE);
+    const windowStart = now - RATE_LIMIT_WINDOW_MS;
+    const { cnt } = sqlite.prepare('SELECT COUNT(*) AS cnt FROM pilot_rate_limit_log WHERE grant_id = ? AND requested_at >= ?').get(String(grantId), windowStart);
+    if (cnt >= RATE_LIMIT_MAX) {
+      // 🔴 超限不记录本次尝试（防止被拒请求本身继续膨胀计数、放大拒绝面，§2.4 母卡已标注）。
+      return { ok: false, error: `grant 限流：每 ${RATE_LIMIT_WINDOW_MS / 1000}s 至多 ${RATE_LIMIT_MAX} 笔请求` };
+    }
+    sqlite.prepare('INSERT INTO pilot_rate_limit_log (grant_id, requested_at) VALUES (?, ?)').run(String(grantId), now);
+    return { ok: true };
+  } catch (e) {
+    return { ok: false, error: '限流检查异常（fail-closed 拒）: ' + (e?.message || 'unknown') };
+  }
+}
+
 /**
- * 网关早拒验：结构 + protocol/domain/version + intent_type + 签名（MUST，§3.2）+ grant 存在/未吊销/
- * 有效期 + amount cap（cheap-to-expensive：这几步全部零解密成本，任一步失败都在触发 privkey 派生前
- * 拒绝——Bettor `#xw1umo` 钦定顺序，防止无效签名/超额请求白白触发一次 AES 解密）。
+ * 网关早拒验：结构 + protocol/domain/version + intent_type + 限流（§2.4）+ 签名（MUST，§3.2）+
+ * grant 存在/未吊销/有效期 + amount cap（cheap-to-expensive：这几步全部零解密成本，任一步失败都在
+ * 触发 privkey 派生前拒绝——Bettor `#xw1umo` 钦定顺序，防止无效签名/超额请求白白触发一次 AES 解密）。
  * 返回 { ok:true, grant, env } 或 { ok:false, code, error }（code 供 handler 映射 HTTP 状态）。
  */
 async function earlyRejectCheck(env, intentType) {
@@ -59,6 +89,11 @@ async function earlyRejectCheck(env, intentType) {
     return { ok: false, code: 403, error: `本路由不接受命令 ${env.intent_type}（须 ${intentType}）` };
   }
 
+  // 限流（§2.4，cheap-to-expensive 第一项：结构确认过 grant_id 是字符串之后、签名验证之前）——
+  // keyed by 声明的 grant_id，读的是 ENVELOPE_FIELDS 结构已保证存在的字段，无需等 grant 查证。
+  const rl = checkRateLimit(env.grant_id);
+  if (!rl.ok) return { ok: false, code: 429, error: rl.error };
+
   // grant fresh 读（cheap，一次 DB 查询，供签名验证取 app_pubkey + 后续 amount cap 复用同一行）
   const gr = getGrantFreshGateway(env.grant_id);
   if (!gr.ok) return { ok: false, code: 503, error: `grant registry 读失败: ${gr.error}` };
@@ -155,14 +190,24 @@ export async function registerCapabilityRoutes(fastify) {
       const check = await earlyRejectCheck(env, intentType);
       if (!check.ok) return reply.code(check.code).send({ ok: false, error: check.error });
 
-      // 🔴 到此为止，全部 cheap 检查已过（结构/协议/intent_type/grant 存在吊销有效期/签名/amount cap）。
-      // 只有这些都通过、且 relay armed 状态确认 OK（§2.7，见下）才触发 privkey 派生（expensive：
-      // DB 查询 + AES 解密）。
+      // 🔴 到此为止，全部 cheap 检查已过（结构/协议/intent_type/限流/grant 存在吊销有效期/签名/
+      // amount cap）。custodial_transfer 分支下方还有 pilot 白名单（§2.1）+ relay armed 状态确认
+      // （§2.7）两道，都通过才触发 privkey 派生（expensive：DB 查询 + AES 解密）。
       if (intentType === 'custodial_transfer') {
         const fromAddress = check.env.intent?.fromAddress;
         if (typeof fromAddress !== 'string' || !fromAddress) {
           return reply.code(400).send({ ok: false, error: 'intent.fromAddress 缺失/非法' });
         }
+
+        // 🔴 Path B 围栏 §2.1：gateway 早拒白名单层（non-authoritative，纵深防御第一层，独立于
+        // relay 侧 grant-scoped source_scope 权威层，见母卡 §2.1）。空 Set = 未配置 = default-deny
+        // 拒所有（同 M0c-1 default-deny 精神，不会因为忘配这个 env 变量而"意外开放"）。cheap：纯
+        // env 解析 + Set 查找，无 DB/IPC，早于 relayId 解析。
+        const pilotAllowlist = new Set((process.env.PILOT_WALLET_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean));
+        if (!pilotAllowlist.has(fromAddress)) {
+          return reply.code(403).send({ ok: false, error: 'fromAddress 不在 pilot 白名单（gateway 早拒层，非 grant scope 缺陷）' });
+        }
+
         const relayId = CUSTODIAL_RELAY_ID();
         if (!relayId) return reply.code(503).send({ ok: false, error: '转账暂不可用（CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配）' });
 
diff --git a/kasia-console/src/db/migrate.js b/kasia-console/src/db/migrate.js
index 2a2ff37d..af265cce 100644
--- a/kasia-console/src/db/migrate.js
+++ b/kasia-console/src/db/migrate.js
@@ -5570,5 +5570,19 @@ export function runMigrations() {
     }
   }
 
+  // v192 (2026-07-24, J2, M0c-1 Path B pilot 围栏 §2.4·恢复派工 claim==code 纪律②): pilot_rate_limit_log
+  // 建表 — gateway 转发 custodial_transfer 前限流(keyed by app-grant 声明值, 签名验证之前, cheap-to-expensive)。
+  // 设计: docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md §2.4。
+  {
+    sqlite.exec(`
+      CREATE TABLE IF NOT EXISTS pilot_rate_limit_log (
+        grant_id TEXT NOT NULL,
+        requested_at INTEGER NOT NULL
+      );
+      CREATE INDEX IF NOT EXISTS idx_pilot_rate_limit_grant_time ON pilot_rate_limit_log(grant_id, requested_at);
+    `);
+    console.log('[migrate] v192: pilot_rate_limit_log 建表 (M0c-1 Path B pilot 围栏 §2.4, gateway 限流 keyed by grant_id).');
+  }
+
   console.log('[migrate] DB migrations complete.');
 }
```
