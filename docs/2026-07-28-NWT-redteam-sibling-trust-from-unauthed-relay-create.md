# NWT 红队 — 「sibling」信任来自一张写入端无鉴权的表,而唯一实际拦着的是 listen 绑的那张网卡

> **Status**: CURRENT — 只读调查 · 零落码 · 零配置改动
> **来源**: 追 17 轮往返停因(`docs/2026-07-28-NWT-redteam-autoreply-loop-stopcause.md`)时顺出来的第二格
> **🔴 先说结论的边界,免得被读成告警**:**今天不可被远程利用**。Console 实测只绑 127.0.0.1。
> 这条记的是**结构**:一个会抬升信任、还会生成钱包的写入路径没有鉴权,而挡住它的不是鉴权,是一行 bind。

---

## 一、链条(每一环都实读)

```
① evaluateSenderGate (mind-manager.js:296-311)
   peer 地址若能在 relay_nodes 里查到 → 判为 "sibling"
   → 直接 return { blocked:false, rateLimited:false }
   → 🔴 isRateLimited() 【根本没被调用】
   → authority = AUTHORITY_MAP.recommended = [chat, suggest, collaborate, view_partial]
     (stranger 只有 [chat, suggest])

② 所以「在不在 relay_nodes 里」这一个布尔值, 同时决定两件事:
   · 限频表(stranger 10/时)生不生效
   · 该 peer 拿到哪一档 authority

③ 而 relay_nodes 的写入路径(全仓仅两处 INSERT, grep 实跑):
   · kasia-console/src/data/settings/relay-nodes.js:33  ← 业务写入
   · kasia-console/src/db/migrate.js:2031               ← 迁移
   业务写入的三个调用点(api/relay.js):
   · POST /relays                     :71   🔴 无任何鉴权
   · POST /api/relay/import-privkey   :119  ✅ 有 verifyIngestRequest preHandler
   · POST /api/agent/create           :1543 🔴 无任何鉴权(且它 Mnemonic.random(12) 现生成钱包)
```

### 「无鉴权」这句我没只看路由那一行

全局 hook 实扫:`index.js` 里唯一的 `addHook('preHandler')` 是 **UTF-8 编码守卫**(`:171`),不是鉴权。
其余 scoped hook 在 `context.js` / `discovery.js` / `ingest.js` / `skills.js` —— **`api/relay.js` 没有**。
⇒ 这两条路由**确实没有任何鉴权前置**。(强度: ✅ 已实测)

---

## 二、为什么今天打不到 —— 而这正是要记的那一格

```
✅ 实测(live netstat, 不是读配置):
   TCP 127.0.0.1:3200   LISTENING 40520   ← Console, 只绑回环
   TCP 0.0.0.0:3210     LISTENING 40520   ← external-gateway, 绑全网卡
✅ index.js:474  fastify.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' })
✅ kanet.env:42  HOST=127.0.0.1
✅ external-gateway 的 PROTOCOL_ROUTES 冻结白名单 = 【1 条】, 且是只读:
     GET /api/public/channel/:name/messages
   ⇒ 上面那两条创建路由【不在】对外那张网卡上
```

🔴 **⇒ 所以承重的那道防线不是鉴权,是 `HOST` 这一个环境变量 + 网关白名单只有一条。**
把 `HOST` 改成 `0.0.0.0`(或哪天有人往 `PROTOCOL_ROUTES` 里多加一条)那一刻,
**没有第二道防线** —— 因为决策点(`evaluateSenderGate`)信的是"表里有没有这一行",而不是"这一行是谁写的"。
🔵 而**变活的那一刻不会有任何提示**:两条路由今天返回什么,那天返回的还是什么。

---

## 三、这属于 verify-value-source 的哪一类

`evaluateSenderGate` 在做信任判定时读的 Y = **`relay_nodes` 里存在该 address**。
追 Y 的来源 ⇒ 它由**两条无鉴权的 HTTP 路由**写入。
⇒ **checker 在决策那一刻读到的值,其来源不比调用方更可信** —— 只是恰好今天调用方够不着。
这与「引用一道闸 ≠ 它在闸住」同族:这里被引用为闸的是 `relay_nodes` 的"内部性",而那个内部性由网络层给,不由数据本身给。

---

## 四、我没做的 / 我不主张的

- ✅ **~~未验~~ → 已核(2026-07-28 补)**:原先我只 grep 了 `INSERT`,而闸是按 **address** 匹配的 ⇒ **`UPDATE` 改地址一样能伪造 sibling**,这一格必须补。补核结果:
  ```
  UPDATE relay_nodes 全仓 19 处。逐个读完, 能写 address 的只有一处:
    relay-nodes.js:62 updateRelayNode  —— 而它 address ?? existing.address(不传即保持),
                                          且全仓唯一调用方 relay.js:150 只传 adapterNodeId
  其余全部是【固定字段白名单】, address 不在其中:
    backup.js:190 / relay.js:1350 —— 动态拼 SET, 但字段来自写死的 8 项
    (vision / principles_json / style / evolution_interval_hours /
     proactive_interval_minutes / social_style / social_overrides / focus)
    其余各处是单字段定值 UPDATE(focus / role / is_service / is_oracle / fee / trading_config …)
  ```
  ⇒ **结论:能写 `address` 的 HTTP 路径就是正文 §1③ 那三条,没有第四条。** 本档的暴露面描述是完整的。
  🟡 仍未覆盖:仓外直接开 sqlite 写库(那已经是本机文件系统权限问题,不是路由暴露面)。
- ⚠️ **未验**:`POST /relays` / `POST /api/agent/create` 实际发一次请求会不会成功建行 —— **我没发**(那会在生产库里造一个 relay,属于改数据,不在只读范围)。本文的"无鉴权"是**代码层**结论。
- ❌ **我不主张这是一个需要立刻处置的洞** —— 它今天够不着。

---

## 五、建议(方向,不是修法;不落码,等派)

1. 🔨 **最便宜的一格是把它变成"不存在"而不是"再加一道验"**:那两条路由若只有本机 UI 用,给它们挂上 `import-privkey` 已经在用的同一个 `verifyIngestRequest` —— 一行,同款,不新造机制。
2. 🔵 **判信任别只判"在不在表里"**:sibling 分支可以在认出 sibling 之后**仍然走一次 `isRateLimited()`**(用 recommended 档 120/时),而不是整个跳过。今天它是**唯一一条完全绕过限频的分支**。
3. 📌 **落账的位置是码里的注释,不是频道** —— 在 `evaluateSenderGate` 的 sibling 分支旁写清:「这一档信任的来源是 relay_nodes 的写入路径,而那两条路由今天没有鉴权;挡住它的是 HOST 绑回环。」否则下一个人会默认这张表是可信输入。

---

## 附:一句方法学(与今天那张新卡同向)

这两条路由**一直在那儿**,而一整夜的审查力气花在"要不要新开一个对外端口"上。
🔨 **审"要不要新增暴露"之前,先数"现在已经有几个"** —— 新增的那个有人审,已存在的那些没人看。
