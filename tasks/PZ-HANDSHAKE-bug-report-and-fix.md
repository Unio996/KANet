# 握手系统调查报告 + 修复方案

**Version**: v1.0
**起源**: Owner 5/1 17:55 Bangkok 给 Trader-M 发握手, 没收到回复
**Owner**: J2 (实施) → NWT (审代码)
**ETA**: ~1-2 小时

---

## 第一部分：Kasia 握手协议梳理

### 协议是怎么走的

一次完整握手 = **2 笔链上 TX**, 总共 ~0.4 KAS:

```
TX #1 (发起方发):  Owner ─── handshake payload ───→ Trader-M
TX #2 (接收方回): Trader-M ─── accept payload ───→ Owner (0.2 KAS)
```

每笔 TX 在 Kaspa 链上的 payload 字段有特定前缀:
- 握手发起: `ciph_msg:1:handshake:` + 加密内容
- 普通消息: `ciph_msg:1:comm:`
- 自存储: `ciph_msg:1:self_stash:`
- 等等

### 系统三个组件各自职责

**Scout (`kaspa-scout/`)** — 链上扫描:
- 订阅 Kaspa 块, 对每笔 TX 看 payload 前缀
- 用 `classifyPayload()` 函数识别类型 (`kaspa-scout/src/lib/protocol.mjs`)
- 如果是 handshake + 收件人是本地地址 → 上报 Console (写入 messages 表)

**Relay (`kasia-relay/`)** — 每个 Agent 一个进程:
- 也订阅块, 自己扫一遍 (`rpc-listener.mjs handleBlock`)
- 用同一个 `classifyPayload()` 识别
- 如果是 handshake 收给自己 → 调 `processHandshake()`
- processHandshake 做: 解密 → 检查重复 → 调 acceptHandshake → sendKaspa 0.2 KAS 回去

**Console (`kasia-console/`)** — 数据中枢:
- 收 Scout 上报, 写 messages 表
- 收 Relay 上报, 写 chain_events / pending_actions 表
- 维护状态机 `relation_states`: observed → accepted → confirmed → active

### Trader-M 收到握手后做什么 (代码已读完)

`kasia-relay/src/rpc-listener.mjs` 第 610-727 行 `processHandshake`:

1. 解密 payload
2. log "HANDSHAKE from xxx — alias: yyy"
3. 调 ingestTx (告诉 Console 看到这笔)
4. 检查黑名单 → 跳过
5. 检查内存里是否已接受过 (`_handshakeAccepted` Set) → 跳过
6. 检查 Console DB `relation_states.status` 是否 accepted/active/confirmed → 跳过
7. 调 ingestMessage (Console 写 messages 表 inbound)
8. 调 Console `/ingest/pending-handshakes` 占锁 (防并发重复)
9. 调 acceptHandshake() 生成回应 payload
10. 调 sendKaspa() 发 TX #2 (0.2 KAS) 给对方 → **这是 Owner 期望收到的 0.2 KAS**
11. log "HANDSHAKE ACCEPTED TX: xxx"
12. markSeen(txid) 防重复处理
13. 顺便发个迎宾消息

### 防重复发送 (4 道防线)

1. `_seen` Set (内存 + seen.json 持久化) — 同一 txid 不再处理
2. `_handshakeAccepted` Set — 同一 sender 不再 accept
3. Console relation_states 检查 — DB 已 accepted 就跳过
4. `pending_actions` 占锁 — 多 worker 不并发

---

## 第二部分：Owner 5/1 的握手发生了什么

### 病因 (症状)

Owner 5/1 17:55 Bangkok 通过 Kasia 客户端给 Trader-M 发了握手, 36+ 小时后还没收到 0.2 KAS 回应。

### 证据收集

**Owner 那笔交易找到了**:
- txid: `804c7e70861379a8f41b284bbde494fe3043a79149a25499d0ccec373bbc17d4`
- 时间: 5/1 10:55:46 UTC = 5/1 17:55 Bangkok ✓ (跟 Owner 说的对得上)
- 来源: Owner 地址 (`...nurgcqs3s588`)
- 在 chain_events 表: `event_type = 'self_stash'`, to_address = Owner 自己

**Trader-M 那边的状态**:
- seen.json (Trader-M 处理过的 txid 记录) — **没有 804c7e708613**
- 意思: Trader-M 的 Relay 从来没处理过这笔交易
- relation_states 表 (Owner ↔ Trader-M): 0 行
- messages 表 (handshake 类型): 0 行
- pending_actions 表: 0 行
- events 表 (handshake_accepted): 0 行

### 病根 (根本原因)

**Owner 那笔 TX 的 payload 前缀是 `ciph_msg:1:self_stash:`, 不是 `ciph_msg:1:handshake:`**。

证据:
- Scout 的 `classifyPayload()` 是按前缀字面比对
- 如果前缀不匹配 handshake, 就不分类成 handshake
- Scout 把它分类成 self_stash, 写进 chain_events
- Relay 用同一个 classifyPayload 函数, 看到 self_stash → 不调 processHandshake → 跳过
- 因为没调 processHandshake, 也就没 markSeen, 没发 0.2 KAS 回应

= **Owner 的 Kasia 客户端发出的 TX, 在协议层面不是 handshake, 是 self_stash**。

可能原因:
1. Kasia 客户端版本不对 (新协议 vs 旧协议)
2. Kasia 客户端某种"加密发送"模式被误用了
3. Owner 点击的按钮在 Kasia 是 self-stash 不是 handshake

**这不是我们 KANet 系统的代码 bug — 系统按协议正确识别成 self_stash 了**。但是用户体验上, Owner 想发握手, 但客户端发了别的东西。系统这边没办法弥补 (因为协议层就不是 handshake)。

---

## 第三部分：修复方案

### 方案 A — 立即解决 Owner 当前问题 (无代码改动)

让 Trader-M **主动发起**一次握手给 Owner (反方向)。

具体:
```bash
curl -X POST http://127.0.0.1:3100/api/relay/385f68eb-21a8-4e83-bb33-fa9f54a038ea/send-command \
  -H "Content-Type: application/json" \
  -d '{"type":"handshake","target":"kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588"}'
```

效果:
- Trader-M 发 0.2 KAS 握手 TX 给 Owner
- Owner 的 Kasia 客户端收到链上 TX, 看到是 handshake 前缀 (这次是真的 handshake)
- Kasia 客户端要么自动回应 (TX #3, 0.2 KAS 回 Trader-M), 要么 UI 显示给 Owner
- Owner 看到 "Trader-M 跟我握了手"

**风险/不确定**:
- Owner 的 Kasia 客户端有没有 "对方反向发起握手"的处理逻辑, 我不确定
- 但至少 Owner 链上能收到 0.2 KAS, 这是 Owner 期望的

### 方案 B — 长期: 给系统加自动检测 + 恢复

在 Scout 加一个识别: 如果一笔 self_stash TX 的发件人是某个本地 Agent 没接触过的地址, 把它当成"可疑握手"标记, 然后:
- 写一条 inbound handshake 记录到 messages 表
- 让 Trader-M Relay catch-up 拿到, 走正常 acceptHandshake 流程

**实现复杂度**: 中等。要改 Scout 识别逻辑 + Console catch-up 路径。

**风险**: 如果误判 (真的 self-stash 被当握手), 会浪费 0.2 KAS 给陌生人。需要严格的"可疑"判断条件。

### 方案 C — 让 Console 加个 admin 接口手动接受握手

类似管理员后门, 不走链上识别:
- Console 加 endpoint `/api/admin/manual-handshake-accept`
- 参数: localRelayId + remoteAddress
- 直接调 Trader-M Relay sendKaspa 一笔 accept TX 回 Owner
- 同时写 relation_states accepted

**实现复杂度**: 低 (~30 行代码 + 1 endpoint)。

**风险**: 后门接口, 要权限保护。

---

## 推荐路径

**立即**: 方案 A (curl 一行命令, 不改代码) — 解决 Owner 当前问题, 验证 Trader-M 端代码工作正常。

**之后**: 方案 C (加 admin endpoint) — 以后类似情况手动救济用, 不依赖链上识别。

**长期**: 方案 B (Scout 自动检测) — 防再发生。但优先级低, 因为这是 Kasia 客户端协议错的问题, 应该先报告给 Kasia 项目修, 而不是 KANet 这边补。

---

## J2 实施任务

**任务 1: 立即跑方案 A (operator 范围, 不改代码)**
- 跑那条 curl
- 等 ~30 秒 看 Owner 是否收到 0.2 KAS
- 在 dev-coord 报告结果

**任务 2: 实施方案 C (写代码)**
- 文件: `kasia-console/src/api/admin.js` (新建)
- 加 endpoint `POST /api/admin/manual-handshake-accept`
- 参数: `{ relayNodeId, remoteAddress }`
- 调用: 通过 `sendCommandAsync(relayNodeId, { type: 'handshake', target: remoteAddress })`
- 加权限保护: 检查 INGEST_SECRET (跟其他 admin 接口一样)
- 写测试: 至少 1 个单元测试 (mock relay)
- LOC 预算: ~40 行代码 + ~30 行测试

**任务 3: J2 写代码前先 grep**
- `kasia-console/src/api/` 看有没有现成的 admin endpoint 模式可参考
- `relay-manager.js sendCommandAsync` 真签名 (已读过, 是 `(relayNodeId, command, timeoutMs)`)
- 不擅自设计, 撞墙 broadcast NWT

---

## NWT 后续

- 任务 1 由我 (NWT operator hat) 跑 OR J2 跑都行
- 任务 2 J2 ship 后, NWT 切 reviewer hat 审代码
- 全程不需要 Owner 干预

---

*v1.0 — 2026-05-03 NWT 写报告 (per Owner 钦定 调查报告 + 修复方案 + 交 J2 + NWT 审 全自动)*
