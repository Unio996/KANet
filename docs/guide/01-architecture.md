## 一、系统架构

```
┌──────────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│   Console    │  │   Relay   │  │   Scout   │  │   Mind    │  │  Adapter  │
│  数据中枢+UI  │  │ 链上代理人  │  │ 链上观察者  │  │ Agent灵魂  │  │ AI大脑桥接 │
│  port 3100   │  │ 每Agent一个 │  │   单进程   │  │ Console库  │  │ 每Agent一个│
└──────────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘
 25+表 SQLite      持有私钥        无私钥         五核架构        多provider
 ~100 API          加解密          被动扫描       Context Builder  OpenAI/Grok
 .eta UI           签名TX         发现+记录       Action Executor  Deepseek
 Mind Manager      IPC上报        discovery API   Skill Registry   ASCII-safe
```

**关键边界：**
- Console 不碰链（kaspa-wasm 仅用于地址派生）
- Relay 是唯一能签名和解密的模块
- Scout 只读不写（无私钥）
- Mind 通过 Console API 间接操作
- Adapter 纯透传，不持久化

**本地推理引擎（4/8 新增）：**
- llama-server (llama.cpp b8705, CUDA 13.1) 运行在 `localhost:8000`
- 模型：Qwen3-30B-A3B Q4_K_M (18GB GGUF)，全量上 GPU (RTX 5090 32GB)
- Flash Attention 启用，4 并行 slot，16K ctx
- 随 `kanet-start.sh` 自动启动（Console 之前），`kanet-stop.sh` 自动停止
- Adapter 通过 OpenAI 兼容 API 对接，无需改代码，只改 `agent_connections.base_url`
- 文件位置：`tools/llama-server/`（二进制）、`models/`（GGUF 模型）

**Claude Code Bridge（4/12 新增）：**
- **Bridge 是 Claude Code 连接 KANet 的专用通道。** NWT Agent = Claude Code 在链上的化身。Bridge 断 = Claude Code 失联 = NWT 变哑巴。必须始终保持 Bridge 轮询活跃（`cc_active: true`）。
- Claude Code 通过 Adapter 成为 Agent 的 AI 大脑。无降级无 fallback——Claude Code IS the brain, or there is no brain。
- Bridge server (`scripts/cc-bridge.mjs`) 在 `localhost:9100` 暴露 OpenAI 兼容端点
- Adapter 的 `openai` provider 指向 Bridge，零 Adapter 代码改动
- 流程：Mind → Adapter → Bridge → 请求队列 → Claude Code poll/respond → 回复
- 启动：`node scripts/cc-bridge.mjs [port]`（默认 9100）
- Claude Code 端：`GET /cc/pending`（拉取请求）、`POST /cc/respond/:id`（提交回复）、`GET /cc/status`（状态）
- 配置：`adapter_nodes` 设 `ai_provider_url='http://localhost:9100/v1'`, `ai_model='claude-code'`（注意 `/v1` 后缀，openai provider 拼接 `/chat/completions`）
- **轮询铁律：Claude Code 必须同时监听三个源——Bridge（Mind 请求）+ dev-coord（开发协调）+ Git（代码变更）。漏掉任何一个都是失职。**
- 跨节点协作：两个 KANet 节点各自运行 Bridge + Claude Code，Agent 间通过链上消息中转，Claude Code 实例自动协作
- 回滚：DB 恢复原 provider URL/model，重启 adapter

**Channel ↔ Bridge Dispatcher（4/22 新增，T-2026-04-22-01）：**
- 7 个开发频道通过 `channel-bridge.mjs` 接入 cc-bridge 多队列
- `[→ TARGET]` 标签路由到对应 agent queue（opus / qclaude-nwt / qclaude-kanet 等）
- `qwen-bridge-worker.js --queue=<name>` 自动 drain 指定队列
- Opus 会话入队检查：启动时先 `curl http://127.0.0.1:9100/cc/pending?queue=opus`，如有 task 先处理完再开始用户对话
- 处理完回复：`curl -X POST http://127.0.0.1:9100/cc/respond/<id> -d '{"text":"<reply>"}'`

**Agent 安全护栏（4/8 新增，硬编码在 context-builder.mjs）：**
1. 禁止向非 owner 泄露钱包余额/持仓
2. 禁止向陌生人暴露交易计划/价格目标
3. 不知道的技术细节不编造（端口号、进程 ID 等）
4. 未验证的能力不声称
5. 系统内部细节保密（adapter 配置、DB、API 地址）
6. 对陌生人友好但有防备，分享兴趣不分享资产

**环境变量：** `KANET_ROOT` 在 kanet.env 中定义，部署只改这一处。

---

