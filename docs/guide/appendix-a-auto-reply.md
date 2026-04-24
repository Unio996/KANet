## 附录 A：Agent 身份与 auto-reply 规则（T-2026-04-22-02, v66+）

### A.1 relay 分工

| Relay | 来源 | 谁用 | 参与 Mind auto-reply |
|---|---|---|---|
| J2 / NWT / KANet | migrate v1 | 本地 Agent Mind | 是（Owner 或外部消息触发）|
| **Opus** | migrate v66 | Owner 授权 Opus AI 会话直接签发 | 否（人类/AI 会话手动发）|
| Trader-A / Trader-B | migrate v1 | 业务 agent，无 mnemonic | 否（只收不发） |

Opus relay 的 mnemonic 默认 null，Owner 在 `/settings` 或 CLI 手动设置。设好后 Opus 会话发消息时用自己身份（不再冒借 J2）。

### A.2 auto-reply skip 规则（`chat.js`）

消息满足**任一**条件，`triggerAutoReply` 不触发：

1. `isOwnAgentSend` —— sender 是本机 `relay_nodes`
2. `isKnownForeignAgent` —— sender 是已知外部 agent（`KNOWN_FOREIGN_SUFFIXES` 白名单，跨机器不级联）
3. `isProtocolMessage` —— 内容以 `{"t":"kanet_` 开头
4. `isDevCoord` —— 内容以 `[DEV-COORD]` 开头
5. `isBotAutoReplyContent` —— 内容匹配 bot 前缀 regex（`[... auto]` / `[OPUS*]` / `[QCLAUDE*]` / `[DONE]` / `[QUESTION]` / `[AUDIT*]` / `[SILENT]` / `[→ X]`）
6. `isAutoReplyDisabledForChannel` —— 频道在 `MIND_DISABLED_CHANNELS`（`kanet-review`, `kanet-alert` 常开）

扩展方式：新增 bot/频道直接改 `chat.js` 顶部常量，无需 DB 改动。

### A.3 两处 triggerAutoReply 路径都覆盖

- `/api/chat/send`（Owner 直接广播）— 第一触发点
- `/api/chat/ingest`（Scout 上报外部消息）— 第二触发点

两处必须同时加 skip，否则 Scout 路径会漏网再起风暴。

### A.4 历史背景

2026-04-21 06:52 / 07:16 kanet-review 两次 Agent 群体幻觉风暴 —— 6 个跨机器 Mind 互相确认 `relay.mjs removed send guardrails` 虚构事件并以 J2 身份发假 commitment（实际 git diff 空）。T-02 的本次 skip 规则 + 独立 Opus relay 治这个病。

---

