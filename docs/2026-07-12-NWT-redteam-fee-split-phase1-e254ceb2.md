# NWT 红队 — B线落1 分润组件本体 diff 审(e254ceb2)

> **Status**: CURRENT
> **对象**: commit `e254ceb2`(fee-split.mjs 组件本体 + deriveSettlementFeeLeaves 薄壳替换 + fee-split.test 23断言 + lint R-FEERULES-CANON-BYPASS)
> **spec**: docs/2026-06-22-modular-fee-split-component-spec.md v1.3
> **verdict**: **GREEN-with-MUST-FIX——落1 可留(纯 lib 零部署),F1 为落2 commit 上链前 BLOCKING,修位就在组件本体**

---

## 我试了哪些攻击(PASS 是挣的,不是看着没问题给的)

全部亲跑,非信 claim:

| 攻击 | 结果 |
|---|---|
| **未知字段静默丢弃 → commit 碰撞** | 🔴 **穿了 = F1**(实测 repro,见下) |
| Σbps≠10000 / 重复 role name / derive 角色 caller 供址 / 非 optional 缺址 / 模板直接上链 / schema_v 不支持 | 全被拒(fail-loud,test① 8断言亲跑绿) |
| roles 乱序 / address 大小写 → commit 漂移 | 没穿(canonical 归一,test②③亲跑绿) |
| bps 变一位 → commit 不变(委员拒签失效) | 没穿(commit 变,test③) |
| 逐字搬迁 byte-equal 造假(7叶 broker/intro/committee×5,含尘差→pk 排序 committee[0]) | 没穿(test④ 用 '000…1' pk 排首正好压尘差分支,与 legacy 逐位同) |
| 1dv70 真实链值回放(feeSompi 6080000 + guest root 31c86567) | 命中(fee-split.test⑤⑥ + fee-single-source 6/6 亲跑绿) |
| 守恒: Σ(payoutLeaves)==pool 精确清零(整除不尽池) | 没穿(test⑥⑦) |
| pool<=0 / 非整数 bps | fail-loud 拒 |
| **四侧接线继承**(签名未变?第 N+1 消费点?) | 全库 grep 尽: transport:348(propose)/voter:590/enforce:478 直调;enqueue 侧按 D-008 设计收 caller 值只验守恒(zk-prove-enqueue.mjs:69-78)= 非漏配。签名/返回形状未变,继承成立 |
| **V1 字节不动** | diff 实核: deriveFeeLeaves/FEE_CONFIG 原文零触碰,仅 deriveSettlementFeeLeaves 内部+import;fee-single-source test⑤ V1(4800000)/V2(6080000) 口径隔离绿;bshard-auto-settler.test 亲跑绿 |
| lint 0 errors 复核 | 亲跑 4 文件 0 errors(141 个无关 doc WARN) |

## F1 🔴 MUST-FIX(落2 BLOCKING·CONFIRMED 实测): validateFeeRules 不拒未知字段 + canonicalize 静默丢弃 → commit 不绑全部语义

**实测 repro**(live 跑,非纸面):
```
base = {schema_v:1, roles:[{provider 9840},{broker 160, address:aa…}]}
evil = base + roles[1].refund_policy='attacker-extension' + 顶层 settlement_mode='evil-top-level'
validateFeeRules(evil) → true(放行)
computeFeeRulesCommit(base) == computeFeeRulesCommit(evil)   // c45b46ce… 逐位相同
```
根因: `canonicalizeFeeRules`(fee-split.mjs:110-117)映射时只拾取 name/bps/address/derive/optional,其余键静默剥除;validateFeeRules 无未知键检查。

**后果**: 未来任何 consumer 读扩展字段而没 bump schema_v → **同 commit 不同行为**——spec v1.2-3 "版本变更天然改变 commit=机制保障"被旁路(加字段不 bump 版本就是绕过路径,而"记得 bump"恰恰是流程纪律不是机制)。落2 commit 上链后此面变真: 两份语义不同的 feeRules 同过链上 commit 验。

**修法**(组件本体内,负测试同补): strict whitelist——顶层键 ⊆ {schema_v, preset, roles},role 键 ⊆ {name, bps, address, derive, optional},未知键 fail-loud throw。未来加字段被迫 bump schema_v = 机制闭合。

## F2 🟡 note(地面核毕零现雷): brokerFeePctBps∈(5000,10000] 行为变更——旧照付/新 throw

薄壳映射 provider bps=10000-bps,撞 PROVIDER_MIN_BPS/ROLE_MAX_BPS=5000 → throw。**地面核**: pool_markets 全量 3722 盘 max=300bps,>5000 零命中(readonly 实查);且三处 create 硬固定 190(pool.js:368/647/968)。**但** create API 验证边界是 0-9999(pool.js:444/697/1052)——若硬固定来日放开,可建出 settle 时才炸的盘 = 延迟 liveness 雷。修位在落2 天然顺手: create 锚 commit 时跑 validateFeeRules 即提前到建单时 fail-loud(J2 落2 设计核对此点即可,无需单独卡)。

## F3 🟡 note: test② "canonicalPredicate 规范锚"非跨实现等价守护

fee-split.mjs:94 注释称"fee-split.test.mjs ⑧ 有守护断言",实际 test② 只锚 canonicalPredicate 自身对 toy object 的行为,_canonicalJson(私有)与 canonicalPredicate 之间**无等价断言**——两实现将来若在边角(非 ASCII 键/数字形态)漂移,test 不报。便宜修(一行): fixpoint 断言 `canonicalPredicate(JSON.parse(canonicalizeFeeRules(r))) === canonicalizeFeeRules(r)`。

## F4/F5/F6 🟢 notes(落3/文档位,不阻落1)

- **F4**: feeSplit 不验 winners(负 stake/坏 pk 不拒;dust→winners[0] 依赖 caller 供序;winner pk 组件 lowercase 而 computePariMutuelPayout 不——大写输入时两实现分叉,当前管线全小写零现雷)。③好用层第三方采用前必须入口验证或文档写死 winners 契约。
- **F5**: committee bps>0 且 committeePks=[] → fee 静默归 winners(与 legacy parity 刻意保留)——组件文档需写明,防第三方误以为委员必收。degenerate 形状差异(J2 已主动披露)同此归档: feeSplit degenerate feeSompi='0' 语义(fee 不收)比 legacy(distributable=pool-fee)更对,落3 文档定死。
- **F6**: lint R-FEERULES-CANON-BYPASS WARN 级+启发式可平凡绕过(`const cr=canonicalizeFeeRules(r); blake2b(cr)` 不触发)——作纵深一层可接受,真正的机制门=落2 链上 commit 验证,记录不改。

## 结论

落1 交付质量高: 纯函数边界干净(notify 零进入)、canonical 单源真单源、byte-equal 逐字搬迁有真实链值锚、V1 零触碰、主动披露三点全属实。**F1 是本审唯一真洞**——组件本体的 validate 就是它该修的地方,落2 的链上 commit 依赖它闭合,故定级"落2 前 BLOCKING、建议即刻在落1 文件补"。F3 一行断言顺手补。其余 note 入落3/文档账。

— NWT 2026-07-12
