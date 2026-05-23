## 十二、已知局限（不修，记录在案）

| # | 问题 | 原因 |
|---|------|------|
| 1 | Perception 30s 缓存 + 50 peer 上限 | 当前规模足够 |
| 2 | Gate 1 速率限制纯内存（重启重置） | 危害有限 |
| 3 | tx_records.status 永远 broadcasted | 改 Relay listener 链路长风险高 |
| 4 | catch-up 限制 100 握手 + 50 消息 | 当前规模下不触发 |
| 5 | 双重 whale alert（scanner + whale-alert.mjs） | 阈值已统一，架构重复 P3 |
| 6 | Adapter 遗留 <<SKILL:annotate:...>> 系统 | 和 Mind Skill Registry 两套并存 P3 |
| 7 | protocol.mjs Relay/Scout 各一份 | shared/ 可合并 P3 |
| 8 | ~~kaspa-scout/package.json 硬编码 file: 路径~~ | **已解决（2026-04-08，kaspa-wasm → shared/vendor/kaspa-wasm v1.0.1）** |
| 9 | ~~account_relations 双写~~ | **已解决（v46 DROP TABLE, 2026-04-06）** |
| 10 | ~~interaction_records 残留读取~~ | **已解决（v47 DROP TABLE, 2026-04-06，17 处迁移到 chain_events）** |
| 11 | ~~replies.sent_txid 盲匹配 hack~~ | **已解决（2026-04-06，chain_events 是真相源）** |

> **数据库字典：** 改表前必查 `docs/DATABASE.md`，34 张活跃表全覆盖。migrate.js 当前最新版本 v50。
>
> **2026-04-08 新增：**
> - v50: `adapter_nodes.is_enabled` — 记住用户手动停止状态，重启后不自动拉起
> - `rpc-health.js`: 局域网私有 IP（10.x/172.16-31.x/192.168.x）视同本地节点，Scout 自动切换全量 RPC 模式
> - `whale-signal.js`: 价格源从仅 mm_quotes 扩展到 market-data 缓存（getCachedKasPrice）
> - `kaspa-wasm` 改为 `shared/vendor/kaspa-wasm`（v1.0.1，file: 引用）。**注意：npm @onetokenfe/kaspa-wasm-node@1.0.2 的 sign() 有 sighash 缺陷（payload 不纳入签名），1.0.1 正常。**
> - Adapter UI: 三态状态显示（绿=AI可用/黄=AI错误/灰=离线）+ Ollama 模型自动发现
> - OAuth 回调自动清理空 api_key 连接
> - Mind adapter 动态切换：UI 换 AI 引擎后 30s 内自动生效，无需重启
> - Ollama 本地模型接入：openai provider + localhost:11434/v1，支持 qwen3:30b / qwen2.5vl:32b 等

---

