# D3-rev1 验收 Checklist（Bettor · 协调域 · rev1 落地时按此审 = 验收标准前置）

> **用途**: 把散在 COORD-LEDGER (288)(293)(303)(309)(310) + Codex MSG-214/215 回裁里的四方审意见**并集成一份自足清单**。
> 不是替 settler 做设计决策（那些 J2 在 D3 原稿已做），是把"rev1 必须包含哪些节 / 每处依据"列成可勾选结构，降低组织成本 + 提前公开验收标准少一轮往返。
> **@J2**: 照此填即满足全部四方审；**@NWT/@Codex**: 红队按此对照攻击面；每项标了出处，有异议指出处驳。

---

## A. 单制品统辖全部例外语义（MUST-FIX①, Bettor (288) + Codex (293)①/MSG-215 面1）
- [ ] 一份**版本化、market-scoped 签名制品**是 Leg A 排序切换 + Leg B 排除语义 + Leg C 谓词跳过的**唯一激活源**。
- [ ] 无有效制品 ⇒ 现行规则原样 fail-loud（`bshard-close-enforce.mjs:466/467/798/799` + `pool-payout-root.mjs:70` 不变）。
- [ ] 不允许：old+new 制品组合 / 逐 leg 回退 / 节点本地版本偏好 → 任一都不得产生不同语义。

## B. 独立权威绑定（Codex (293)② MUST-FIX — hash==本地 metadata 不够）
- [ ] 制品 canonical bytes 带**域分隔** `KANET_CANARY2_ADJUDICATION_V1`。
- [ ] 含：确切 `market_id` + 策略/制品版本 + 确切 scope + 不可变 digest。
- [ ] **政策权威签名**（Owner，非委员会——委员会有自举死结）；enforce 对 **pinned 公钥独立验签**。
- [ ] git 全文入库仅为可得性/审计；**git 位置本身不是权威**；`pool_markets.metadata` 只 cache digest，非唯一信任根。

## C. 认证全 10 行排序键（Codex (293)③/MSG-215 面2 + J1 n1 MUST）
- [ ] 制品钉**全 10 行规范元组集**（非只 8 个跳过行）：`side_lock_tx, bettor_pk, direction, stake_amount, pay_amount_sompi, side_lock_daa|null` + 排序规则声明。
- [ ] enforce 排序前**比对载入行 vs 制品承诺集**（多一行/少一行/改一字 ⇒ fail-loud，在 root 构造之前）。
- [ ] 排序用**显式码点比较**（小写 hex 后 `a<b?-1:1`），**禁 localeCompare**（J1 n2，`:74` 现隐患一并修）。

## D. 完整集/第 11 bettor（Codex (293)④/MSG-215 面3）
- [ ] 二选一并明写：(a) 独立关闭 complete-set 缺口；或 (b) Owner 制品**显式裁定确切 10 行经济集 + 行数 + 聚合承诺**，并声明残余不确定性为**有界政策接受**（推荐 b，与 Owner 结果直令一致）。
- [ ] enforce 的 complete-set 检查在**任何 payout/refund root 构造之前**跑，对承诺行数比对。

## E. 签名托管/重放（Codex MSG-215 面4）
- [ ] 签名域分隔绑定 market_id + 版本 + scope + digest + **一次性/防重放**语义（旧签名不能复用到别 market/版本）。
- [ ] T-SIGN 路径 arm 后不得让同一 relay 既选策略内容又自授权（enforce pinned-pubkey 独立验签闭掉"driver 自检自己制品"洞）。
- [ ] 依据: 签名工具复用 D-010 基建(`coord-status-sign.mjs`)；权威=Owner 终端逐字 GO digest（Bettor (293) 提案，待 Codex 终确）。
- [ ] 🔴 **Codex (6d2d8607) 补强**: E 的一次性/防重放**不能是勾选框, rev1 必须做成机器可验证**——确切签名 canonical bytes/域 + market/版本/scope/digest 绑定 + **fail-closed verifier/state 规则**阻止"已消费/已被取代的裁决"被复用。prose 勾选不算该属性的证据。

## F. Leg B 真委员路径（Codex (293)⑤/MSG-215 面5）
- [ ] 无条件排除通过**真 `reDeriveCommittee`**（poolMerkleRoot 锚定树）验证，非 standalone selector fixture。
- [ ] j34vb 的 pre/post selected committee **逐字节相同**（两 pk 不在池 ⇒ 应 no-op）。

## G. 资金腿（Codex (281)④ + J2 §6 Leg E）
- [ ] 8 行在 betsRoot/refundRoot/payoutRoot 全程包含，金额=各自 stake，**结算前后叶集与金额逐字不变**（机器可查判据）。
- [ ] "排除出委员会" 结构上不可变成 "排除出经济权益"。

## H. 负测矩阵真实性（Codex MSG-215 面6 — 每条必触生产 seam）
- [ ] 无制品 ⇒ NULL-DAA 仍 fail-loud（无 DB 谓词回退）
- [ ] hash 有效但签名无效/缺失 ⇒ fail-loud
- [ ] 别 market/别版本制品 ⇒ fail-loud
- [ ] 制品缺任一整市场排序行 / 改任一 side_lock_tx ⇒ root 构造前 fail-loud
- [ ] 本地 metadata digest 改成配未授权制品 ⇒ 仍 fail-loud（签名独立）
- [ ] A/B/C 不能独立激活或跨版本混用
- [ ] Leg E: 8 行经济承诺不变
- [ ] **每条负测标注它触达的生产 seam 文件:行**（只在 helper/fixture/合成前置里红的不算闭合信用）
- [ ] 用例落 `kasia-console/test-framework/cases/`，文件名 `*.test.mjs`（否则 runner 扫不到）

---

**闭合条件**: A-H 全绿 → Codex 红队(MSG-215)对不可变 rev1 blob 出可利用性 verdict → 落码 → 上表测试全跑 → 链稳(J1 干净窗)→ 重启窗 arm T-SIGN → Owner 对 digest GO → 签名 → 广播 → S7 两节点 confirmed 同 settle_txid。
