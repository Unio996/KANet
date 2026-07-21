# 通用分润系统 — 收益可见层设计(再过一遍 + 新增·2026-06-28·送 NWT 审)

**作者**: Bettor(架构)· **日期**: 2026-06-28 · **状态**: 设计稿,送 NWT 审 → Owner 终裁
**Owner 钦定(2026-06-28)**: 节点应能看到所有 KANet 参与方(**introducer / broker / oracle / 节点本身**)收益,为**通用分润系统可用化**打基础。"通用分润系统你早设计好了,再过一遍再让 NWT 审。这系统有用。"
**配既有(不重造)**: `docs/2026-06-22-modular-fee-split-component-spec.md` · `docs/2026-06-28-broker-fee-landed-emit-pass-spec.md` · [[project-fee-model-adversarial-hardened-design]]

---

## 0. 两层定位
通用分润系统 = **①分得对(trustless split)+ ②看得见(收益可见)**。
- **①分得对**:已设计 + live 验过(见 §1),本次**不动**。
- **②看得见**:本次新增。broker DM 是它第一个落地点;Owner 要泛化到全角色 + 节点看全局。

## 1. ①分得对(既有·已闭环·本次不碰)
模块化分润组件(06-22):`feeSplit(feeRules, poolSompi, winners) → {feeLeaves, payoutLeaves}` 纯函数。
- 5 角色:provider(winner)/ facilitator(broker)/ affiliate(introducer)/ verifier(oracle)/ infra(node)。
- feeRules(地址+bps)genesis 烤进 redeem offset-518;settle 委员 **re-derive**,`claimed != re-derived → BUST`。
- 行业无关(电商/自由职业/供应链套预设即用);prediction 预设 = 现有分法逐字搬迁。
- **trustless 分配已 live 验**(x4kpq:close 4123de55 + claim 15ec3d18,payoutRoot char-by-char 对死)。
- ∴ "钱分得对、谁也偷不走" = **已解决**。

## 2. ②看得见(本次新增·收益可见层)
**现状**: `broker_fee_landed` emit 只覆盖 **broker 一个角色**(J2 emit-pass 06-28:只找 broker output)。
**目标**: 每个角色的收益都看得见 + 节点看到所有角色收益。三件:

### 2.1 per-role 收益事件(泛化 broker_fee_landed)
emit-pass 不只找 broker output,而是对 settle TX 的**每个 fee leaf**(broker/introducer/oracle/node 各自地址)`parse outputs_json` → emit 收益事件带 **role 标签**。
- 一个 emitter 参数化覆盖全角色,复用现 broker emit 的**链验金额**逻辑(金额 = `outputs_json.amount_sompi`,**绝不 DB 估**,继承诚实铁律)。
- 倾向统一 `event_type='fee_landed'` + `payload.role`(单 emitter),而非每角色独立 event_type。

### 2.2 per-role 通知(DM·有 tg 映射才发)
- **broker / introducer** = 地址制角色,地址可能 ∈ 托管/link → 映射 tg_user_id → DM(沿用 broker 设计)。
- **oracle / node** = 委员/节点派生地址,通常**无 tg 映射**(非托管用户)→ 不走 DM,走 2.3 节点视图。

### 2.3 节点全局收益视图(Owner 核心点: 节点看到所有人收益)
节点(operator)持一个**聚合账**:它处理/结算的所有市场里,每个角色(introducer/broker/oracle/node 自己)各赚了多少,**链验金额**。
- = operator dashboard / node-side income ledger(query 聚合 `fee_landed` 事件,不新建表)。
- 这是"节点能看到所有参与方收益"的落点,也是 oracle/node 自身收益的呈现路径(运营者即节点持有人,他要看的就是这张账)。

## 3. 为什么这让分润系统"可用化"
**分得对(已解决)+ 每方看得见自己收益(2.1/2.2)+ 节点看得见全局(2.3)= 真能用的通用分润系统。**
每个社会角色因为既"确定拿得到"又"看得见拿到了",才会去做自己那部分 → 协调成本趋零(06-22 §0 协调原语)。可见性是"可用化"的临门一脚:trustless 但看不见 = 用户不信、不用。

## 4. 设计决策(待 NWT 审 + Owner 拍)
1. 收益事件:统一 `fee_landed` + role 字段(单 emitter)✓倾向 vs 每角色独立 event_type。
2. 节点全局视图:query 聚合现有 chain_events ✓倾向 vs 新表。
3. 跨节点:Phase 1 各节点只看自己结算的市场收益(诚实);全网聚合 = 后续。
4. 承重:可见层是**纯只读视图**,不碰 split 机制 → 不影响 trustless(可见层显示错 ≠ 分错钱,故障隔离)。

## 5. 送 NWT 审点
1. 可见层会不会**反向影响 split 的 trustless**?(应纯读不碰 covenant/settle,需确认)。
2. per-role emit 每个 fee output 是否**同样链验**金额(都 parse outputs_json,无一处 DB 估)?
3. 节点全局视图 + per-role DM 会不会**泄露 PII**(各角色 tg↔地址映射 + 金额)?auth 边界?
4. 泛化真成立吗:oracle/node 无 tg 映射,2.2 走不通就只能 2.3 视图——**这是否满足 Owner"节点看到 oracle/node 收益"**?还是 oracle/node 运营者也要独立通知通道?
5. **可行性**:现 broker emit-pass(单角色)改成 multi-role,settle TX 里 fee output 的角色归属怎么判(按 committed feeRules 各角色地址 match)?会不会漏判/误判某角色 output?
