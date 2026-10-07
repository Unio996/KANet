# J2 → Bettor: 交付 spike #1 — 「按 txid / 按地址取链上 payload」读路径（只读公共 API，零花费零广播）

分支 `coord/j2-delivery-spike1-20261007`；证据 `docs/provenance/2026-10-07-j2-delivery-spike1/`（5 个脚本 + 原始输出）。
范围：只对公共只读 HTTP API 发 GET/POST-search，**没有任何主网写入、没有碰我们自己的主网库/钱包/进程**。

## 结论（三点逐条）

| 你要核的 | 结果 |
|---|---|
| ① 能不能拿到 payload | ✅ 能。`GET /transactions/{txid}` 返回 `payload`（hex 字符串）+ `is_accepted` + `accepting_block_blue_score`；样本含 886 hex 字符的非 coinbase 交易，字节原样。**更好**：`GET /addresses/{addr}/full-transactions` **按地址直接列出该地址相关的交易及其 payload**（含已被花走/清扫的），对没有任何交易的地址回 `200 []`。⇒ 买家页只需**一次**按信箱地址的查询，不必"先取 UTXO 再逐笔取交易"；信箱被扫走也不丢信。`POST /transactions/search`（批量按 txid）同样带 payload |
| ② 浏览器能不能直连（CORS） | ✅ `api.kaspa.org` 所有上述路由响应 `access-control-allow-origin: *`（带 `Origin: https://example.github.io` 实测）。⇒ GitHub Pages 上的静态页可以直接 `fetch`，不需要代理 |
| ③ 有几家可用读服务能互相兜底 | 🔴 **只有 1 家可用**：`api.kaspa.org`（同一主机 3 条路由可互相兜底，但同机宕了就都没了）。`explorer.kaspa.org` 对非浏览器请求回 Cloudflare 质询 403 且无 CORS ⇒ 浏览器 fetch 不可用；`api.kas.fyi` 回 525；`api.kaspa.stream` 域名不存在；Kasia indexer 根路径 404/503（它是 Kasia 协议专用接口：按 (地址, 别名) 取 `ciph_msg` 信封，不是通用 tx 读取，且本次测到 503 抖动）。**公共节点 wRPC**（结账页 `monitor.js` 已在用）：该页用的 `getUtxosByAddresses` 条目只有面值/`blockDaaScore`，**没有 payload 也没有区块哈希**；节点侧要取 payload 须先知道所在区块哈希——**这条我只按代码用法推断，未对公共节点实测**，故不把它算作可用兜底 |

其它实测：
- 12 次串行 + 30 个并发 GET：全 200，无 429（只是一次小样本，不等于限额；`Cache-Control: public, max-age=8` 且走 Cloudflare）。
- 未知 txid → `404 {"detail":"Transaction not found"}`；延迟 110–640 ms。
- payload 长度样本 876–890 hex 字符/笔均完整返回，说明几百字节密文不会被截断。
- 返回含 `is_accepted` 与 `accepting_block_blue_score` ⇒ 买家页可自行核"已被接受 + 深度 ≥ 20"（用 `/info/virtual-chain-blue-score` 或节点读当前值），不必信任读服务的"已确认"字样。

## 对方案 B 的影响（判定：**有条件通过**）

- **机密/完整性不受影响**：读服务看不到明文，也无法伪造（AEAD 失败即忽略）；它只能拒绝服务、看到谁在查哪个信箱地址（IP+地址，地址由 nonce 哈希派生，不可反推 nonce）。
- **可用性是单点**（③）：api.kaspa.org 宕机/限流/封某来源 ⇒ 买家暂时取不到货（钱已付、货在链上不丢，只是读不到）。V1 缓解（都不新开入站端口）：
  1. 买家页对同一后端做指数退避重试 + 页面明示"读服务暂不可用，货在链上不会丢，稍后重试"；
  2. 支持**手填 txid**（`POST /transactions/search` / `GET /transactions/{id}` 兜底），商家侧在交付后把 `mailbox_txid` 展示在商家后台，客服可发给买家（txid 不是秘密）；
  3. 读后端做成**可插拔接口**（`listAddressTxs(address)`），后续接自建 `kaspa-rest-server`（同一套 API，开源）作第二后端——自建若要给浏览器直读才需要公网入口，**到时按"新开对外端口"单独报**，本次不带。
- **simnet 怎么测**：simnet 无公共读服务。读接口抽象后，测试用"扫 simnet 区块"的适配器实现同一接口（自己的节点、自己的测试链），生产用 api.kaspa.org。接口一致性靠同一套契约测试。

## 判定与建议
- 能进实现：V1 ≈ 3 天、先 simnet、再主网小额（≤ 2 KAS，只用我们自己的地址）——按你的安排。
- 你需要知道的残余风险：**单一第三方读服务**。若你认为 V1 不可接受单点，唯一不新开口的补强是"商家后台展示 txid + 买家手填"（已含）；真正的第二后端要么自建（可能新开口）、要么等 Kasia indexer 稳定后让信箱 payload 套 Kasia 信封（未验证，不建议 V1 做）。
- nonce 只走 `#` 片段的 MUST：已写进 v0.3 设计页（同分支），含断言清单。
