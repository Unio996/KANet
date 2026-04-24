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
| kasia-console/src/services/connection-manager.js | resolveRequestAuth + CRUD + refresh worker |
| kasia-console/src/api/auth.js | resolve / connections 端点 |
| kasia-console/src/api/oauth.js | OAuth start/callback + 临时 1455 端口监听 |
| agent-adapter/src/providers/resolve-auth.mjs | 共享 auth 缓存 + 401 恢复 |

---

