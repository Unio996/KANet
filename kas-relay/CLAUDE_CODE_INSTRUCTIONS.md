# 给 Claude Code 的指令

## 任务：运行 MCP 连接验证脚本

### 第一步：确认路径

请先确认以下两个文件实际存在：
- `D:/HC/clean/kaspa-mcp/dist/index.js`
- `D:/HC/clean/kasia-mcp/dist/index.js`

如果路径不对，在 `verify-mcp.mjs` 顶部配置区修改 `KASPA_MCP_PATH` 和 `KASIA_MCP_PATH`。

### 第二步：填入凭据

在 `verify-mcp.mjs` 顶部配置区：
- 将 `REPLACE_WITH_REAL_MNEMONIC` 替换为真实的助记词
- 网络已设为 `mainnet`，无需修改

### 第三步：安装依赖并运行

在 `verify-mcp.mjs` 所在目录执行：

```
npm install @modelcontextprotocol/sdk
node verify-mcp.mjs
```

### 预期输出（成功）

```
═══════════════════════════════════════
  kasia-relay MCP 连接验证
═══════════════════════════════════════

── kaspa-mcp ──────────────────────────
✅ [kaspa-mcp] 连接成功

📋 [kaspa-mcp] 可用 tools (N 个):
   - get_my_address
   - get_balance
   - send_kaspa
   ...

🔧 调用 get_my_address
   结果: {"address":"kaspa:..."}

🔧 调用 get_balance
   结果: {"address":"kaspa:...","balance":"...","utxoCount":...}

✅ kaspa-mcp 验证通过

── kasia-mcp ──────────────────────────
✅ [kasia-mcp] 连接成功

📋 [kasia-mcp] 可用 tools (N 个):
   - kasia_get_conversations
   - kasia_send_handshake
   ...

🔧 调用 kasia_get_conversations
   结果: [...]

✅ kasia-mcp 验证通过
```

### 常见问题排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `Cannot find module` | SDK 未安装 | 运行 `npm install @modelcontextprotocol/sdk` |
| `ENOENT` / 路径错误 | dist/index.js 不存在 | 在 mcp 目录执行 `npm run build` |
| `spawn node ENOENT` | node 不在 PATH | 用完整路径 `C:/Program Files/nodejs/node.exe` |
| 连接超时 | MCP server 启动慢 | 正常，首次冷启动可能需要 5-10 秒 |
| kasia 无会话 | 新地址尚无链上记录 | 正常，返回空数组即为成功 |
