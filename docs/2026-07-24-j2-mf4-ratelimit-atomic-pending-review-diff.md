# J2 MF4 待审 diff（限流 DB 灌爆修复·2026-07-24）

跨节点传递用临时文件（NWT 无法直接 fetch 我本地 working tree），审完随本次 manifest 更新一起删除。

## 变更文件
`kasia-console/src/api/capability.js`

## 新 content_digest（sha256 hex）
```
771c34dffff6f6f4a8391d66374cc7f18f5b7666c2f28623b18eb85882799335
```

## 变更内容（三点，对应 Bettor 派工 `#xw1umo` 后 Codex 第二轮 MUST-FIX 4）

1. **`checkRateLimit` 调用顺序**：从「限流在 grant 存在性验证之前」改为「grant 存在性验证之后」——原顺序下任意伪造 grant_id 字符串会先写一行进 `pilot_rate_limit_log`，才在 grant 查询步骤被拒，等于开了用海量随机 grant_id 撑爆限流表的口子。grant 存在性检查本身是一次索引命中的 SELECT，cheap，移到限流前不违反 cheap-to-expensive 排序（仍早于签名验证 kaspa-wasm 验签 + amount cap BigInt 运算）。

2. **`GRANT_ID_MAX_LEN = 128`**：`checkRateLimit` 入口加长度 cap，超长 grant_id 直接拒绝，不进入 DELETE/SELECT/INSERT 路径。

3. **`_rateLimitTxn = sqlite.transaction(...)`**：count+insert 从「两条独立 prepare().run()」改成 `sqlite.transaction()` 包裹的单个 SQLite 事务（BEGIN/COMMIT），消除依赖"Node 单线程内无 await 天然序列化"这种隐式假设——显式让 SQLite 引擎保证原子性。

## 对抗测试证据（非假设性断言）

- **灌爆测试**（`g4mf-ratelimit-flooding-test.mjs`）：伪造 100 个不存在的 grant_id 连续打，`pilot_rate_limit_log` 最终 0 行；500 字符超长 grant_id 不导致 500 崩溃。
- **真并发测试**（`g4mf-concurrency-test.mjs`）：`Promise.all` 20 个请求同时打同一合法 grant_id（非顺序 await），状态码分布 `{"429":17,"503":3}`，DB 表内精确 3 行——证明事务原子化在真并发负载下确实生效。
- 既有回归 26 PASS / 2 FAIL（预先存在的失败，无新增）+ 既有限流/白名单隔离测试 7/7 PASS + `node --check` OK + `lint-kanet.mjs` 0 errors。

## 请求
NWT 独立核实：① `sha256sum kasia-console/src/api/capability.js` 是否等于上面的 digest；② 走读上面三点改动是否真落码（非仅注释声称）；③ 给 `review_ref`。核完后我把 `scripts/m0a-exception-manifest.json` 的 `MRC-capability-gateway-wallet-transfer` 条目 `content_digest`/`review_ref` 更新、连同本文件删除一起提交。
