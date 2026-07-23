# Path B pilot 试点围栏设计 v0.1 — NWT 红队 verdict

> **Status**: NWT 红队 **GREEN-with-1-doc-fix + 2-note**（2026-07-24）
> **审对象**：`docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（J1+J2，`f447b2ae`）— Path B pilot 试点围栏设计（Owner 批准 `#xx36z6` 工作流①）。
> **立场**：红队默认 refute。这是决定 pilot 阶段 blast-radius 上限的设计，整体质量高（纵深防御思路贯彻/四数值交叉验证/footgun 主动折入），逐点核查找真问题。

---

## 打不穿的（挣的 GREEN）

- **§2.1 pilot 白名单 fail-closed**：`PILOT_WALLET_ALLOWLIST` 空 Set 时 `.has()` 恒 false = 拒所有，与 M0c-1 default-deny 精神一致，不会因忘配置而"意外开放"。纵深防御定型（gateway 早拒非权威 + relay grant-scoped 权威两层）方向对。
- **§2.2/§2.3/§2.4 四数值交叉验证**：50 KAS 钱包顶 / 2 KAS 单笔（25 笔硬顶）/ 5min TTL / 3 笔每分钟限流（25 笔 ≥ 8min 非秒级抽干）——组合逻辑自洽，各数值不是孤立拍脑袋。
- **§2.5 吊销实测**：用真实 `revoke` 命令而非手工 UPDATE 更贴近真实操作路径，测试断言"下一条请求即被拒、无窗口"直接验证 fresh-read 语义。
- **§2.6 激活时序安全**：KANet-UI 发现 + NWT 独立坐实（`authorizeCommand` armed=off 无条件早返回，跳过 origin 判断）已折入设计，性质定性准确（pilot 激活 = M0c-1 gate arm 本身，非小 flag）。
- **§2.7 armReport 互查提案**：填补"armReport 从未被调用"的既有债，方向对（同一天已反复验证的"不单信一层"纵深防御纪律）；TOCTOU 边缘 case（见 note）不影响其价值。

## 🔴 doc-fix：TTL 命名残留矛盾（同今天机制A §3.3 坑同款）

**打穿链**：§2.3（line 55）明确"per-type 表提案作废，改全局常量 `MAX_ENVELOPE_TTL_MS`"——但 §4 诚实边界清单（line 141）与 §5 测试计划骨架（line 151）仍写着旧名字 `PER_TYPE_MAX_TTL_MS[custodial_transfer]`。若落码时照抄 §5 测试用例名字，会真去建一个 per-type 表/对象，跟 §2.3 已定案的"改全局常量"冲突——这是设计文档没清理干净的残留矛盾，误导实现者的经典坑（今天已抓过一次同类问题，机制A §3.3 残留 v0.1 旧措辞）。

**修法**：§4/§5 两处改成 `MAX_ENVELOPE_TTL_MS`（全局），删除 per-type 索引写法 `[custodial_transfer]`。

## 2 note（非 blocker·记账）

- **N1（§2.4 限流键设计·可用性风险）**：限流检查用**未验证的** `grant_id` 声明值，在签名验证之前——"知道 `grant_id` 但没有正确签名私钥"的第三方可以发大量"`grant_id` 对但签名错"的请求，把**合法 app 自己的**限流配额耗尽，造成合法 app 暂时被拒（可用性问题，非资金安全问题——真正钱路防线 amount cap + 钱包顶 + 签名验证依然完整）。localhost-only 环境门槛较高（先要本地访问能力）+ pilot 流量极低，威胁面小。若要根治：签名前的 DoS 护栏用独立于 `grant_id` 的键（如源 IP 或粗粒度全局限流），真实 `grant_id` 配额限流放到签名验证之后。可作为已知限制记录，不阻塞 pilot。
- **N2（§2.3 TTL 数学推导澄清）**：文档"5min TTL - 2min skew 容忍 = 实际有效窗口约 3min"这个具体数学关系**不成立**——独立读 `app-envelope.mjs:237-241` 时间窗检查代码推导：`ISSUED_AT_SKEW_MS` 只容忍 app 时钟比 relay **快**多少（挡"未来"），完全不影响 app 时钟比 relay **慢**的方向。真正决定有效窗口的是 `TTL - max(0, app时钟实际比relay慢的量) - 端到端真实延迟`，这两个因子都跟 `SKEW_MS` 无关。**结论仍认同**（5min TTL 在 pilot 环境下技术上够用——tg-bot 与 relay 大概率同机/同内网，时钟应 NTP 同步偏差毫秒级 + 端到端延迟毫秒到秒级，远小于 5min 预算），但推导理由需改成"低延迟同网环境留有充分余量，主要消耗是端到端处理延迟非时钟偏差"，非"TTL 减去 skew 容忍"这个错误心智模型。

---

## 判据

**GREEN-with-1-doc-fix+2-note**：设计整体扎实（纵深防御/四数值交叉验证/footgun 主动折入/诚实边界清单完整），doc-fix（TTL 命名矛盾）是文档内部一致性问题（清完即闭，非落码阻塞），2 note 均记账非阻塞（限流键 DoS 向量威胁面小 pilot 阶段可接受；TTL 数学推导澄清结论不变）。

**路由⑤必核项（Bettor 派）逐条交付**：①两 flag 耦合（§2.6）✅ 已独立坐实 ②re-arm 六门前置 current 状态：需团队汇总今天 G1/G2 落码后 lint R-SENDCMD-ORIGIN-REQUIRED（ERROR 级）持续生效证据，我未见新增缺失 origin 违规（G1/G2 diff 审时已核）③TTL 有效窗 3min 够不够：✅ 本 verdict N2 澄清，结论够用 ④§2.7 机制：Bettor 已拍板做（机制根治非人工纪律，对铁律 0） ⑤grant-scoped source_scope（J1 relay 侧稿）：待产出，一并审。

**关联**：`docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（审对象）、`docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（机制A 母卡）、`docs/2026-07-23-NWT-diff-mechanism-a-g2-custodial-binder.md`（G2 落码 GREEN，本设计的前置）、memory `reference-multi-flag-atomic-activation-fail-open-gap`（§2.6 同源发现）。
