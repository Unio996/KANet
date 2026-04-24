## 十三、认证系统（agent_connections）

### 架构原则

> **Console 拥有凭证，Adapter 消费凭证。resolveRequestAuth 是唯一入口。**

```
Console (凭证所有者)              Adapter (凭证消费者)
─────────────────               ─────────────────
agent_connections 表             resolve-auth.mjs 本地缓存
  api_key / oauth / gateway      ↓
Connection Manager               GET /api/auth/resolve-by-adapter/:id
  resolveRequestAuth()           ↓
  refresh worker (60s)           拿到 { headers, baseUrl, model }
  OAuth callback (port 1455)     ↓
                                 发 AI 请求（401 → 重试一次）
```

### agent_connections 表

| 字段 | 说明 |
|------|------|
| auth_mode | api_key / oauth / gateway |
| status | connected / expiring / refreshing / expired / refresh_failed / reauth_required / revoked |
| credential_version | 每次 token 更新 +1，Adapter 缓存据此失效 |

### 三种连接模式

| 模式 | 用户体验 | token 生命周期 |
|------|---------|---------------|
| api_key | 填 API Key | 永久 |
| oauth | 浏览器登录授权 | access_token ~1h-10d，refresh_token 自动续期 |
| gateway | 填 gateway token | 永久（OpenClaw 管理） |

### OAuth 流程（OpenAI Codex）

1. Console 生成 PKCE code_verifier + code_challenge
2. 浏览器跳转 auth.openai.com/oauth/authorize
3. 用户登录 ChatGPT 账号授权
4. OpenAI 回调 localhost:1455/auth/callback
5. Console 用 authorization_code 换 access_token + refresh_token
6. 加密存入 agent_connections
7. Adapter 通过 resolveRequestAuth 拿到 Bearer token

**关键：** OAuth token 调的是 `chatgpt.com/backend-api/codex/responses`（Codex Responses API），不是 `api.openai.com/v1/chat/completions`。openai.mjs 自动检测 baseUrl 切换请求格式。

### Adapter 请求流程

```
1. 检查本地缓存（未过期 && >5min margin && 未 401）
2. 无缓存 → GET /api/auth/resolve-by-adapter/:adapterId
3. 用返回的 headers + baseUrl 发请求
4. 成功 → 返回
5. 401 → 清缓存 → resolve(force_refresh=true)
   status=connected → 重试一次
   其他 → 直接失败
6. 每个请求最多重试一次
```

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/connection-manager.js | resolveRequestAuth + CRUD + refresh worker + retryRefresh |
| kasia-console/src/api/auth.js | resolve / connections / retry-refresh 端点 |
| kasia-console/src/api/oauth.js | OAuth start/callback + 临时 1455 端口监听 |
| agent-adapter/src/providers/resolve-auth.mjs | 共享 auth 缓存 + 401 恢复 |

### Refresh 自救（2026-04-24 修）

ChatGPT Plus OAuth 曾出现过期 21 小时未续的死锁：`resolveRequestAuth()` 同步路径遇到过期只写 `status='expired'` 不 refresh；后台 worker SQL 仅扫 `status IN ('connected','expiring')`，一旦落入 `expired` 就永不再看。修复：

1. **同步路径自救** — `resolveRequestAuth()` 改 async，过期且有 refresh_token 时立即 `await _refreshConnection()`，不再等 60s worker tick。
2. **Worker 扩扫** — SQL 放宽到 `status IN ('connected','expiring','expired','refresh_failed')` + `refresh_after IS NULL OR refresh_after <= now()`，死状态也能被救活。
3. **UI 一键重试** — `POST /api/auth/retry-refresh/:id`。`/adapters` 页面为每个 OAuth adapter 卡片暴露"重试刷新"按钮，把卡住的 connection 拉回 `connected`。
4. **不自愈的情况** — 连续 refresh 失败 3 次升级为 `reauth_required`，worker 停扫，UI 暴露"重新 OAuth"按钮走完整授权。

### 共享 ChatGPT Plus 的配额陷阱

`plan_type='plus'` 的 OAuth adapter 有**订阅级使用上限**（非按量付费）。多个 Agent 的 brain 若路由到同一个 OAuth adapter 会**共享同一份 quota**，并发下 `429 usage_limit_reached` 把 adapter 整体打挂，`resets_in_seconds` 通常 40-60 分钟。架构建议：每个 Agent 用独立的 api_key adapter，OAuth Plus 只给单一重点 Agent 用。

---

