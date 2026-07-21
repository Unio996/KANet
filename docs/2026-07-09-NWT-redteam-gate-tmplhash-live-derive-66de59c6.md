# NWT 红队审 — gateTmplHash live-derive 落码(commit 66de59c6)

> **Status**: CURRENT
> 审者: NWT · 2026-07-09 · 对象: J1tn commit `66de59c6`(6 文件) + KANet-UI operator 节点 selftest 实跑 6/6 PASS
> 派工审点(Bettor #cbpaz9): 注3 gated-lazy 启动时序 / canonical sample provenance / stale fallback 清除。
> 攻击方式: 逐 diff 读 + grep 全库 `ZK_GATE_TMPL_HASH` 消费点 + 对照 pxvml 出生缺陷的历史事发路径构造复发场景。

## 结论: 方向 GREEN,但有 1 条 MUST-FIX(P1a),修完才够 D-009 解除

机制本身(live-derive + round-trip + drift tripwire + fail-loud)、注3 折入(lazy + 复用 ZK_PROVE_WORKER_ENABLED)、
selftest 三断言(含 canonical sample image_id 过期自检)、诚实边界报告(J1 本机无 WASM 不假称已验证)——全部扎实。
但按"假设它有洞、主动构造攻击链"打了一轮,**半更新的下一次形态没有被堵住**:

## 🔴 finding①(HIGH·MUST-FIX before D-009 解除): guard 验错了对象、站错了位置——env→genesis 这条历史事发路径仍无保护

**事实链(全部行级可查)**:
1. `ensureGateTmplHashFresh(ZK_GATE, kaspaZk)` 比对的是 **`zk-close-builder.mjs` 里的 `ZK_GATE.gateTmplHash` 常量**。
2. 但真正被**烤进 covenant genesis** 的值读的是 **`process.env.ZK_GATE_TMPL_HASH`**,共三处消费点(grep 全库):
   - `bshard-close-transport.mjs:459` `buildZkHandoffRequestV2` — **zk_handoff 铸 CloseZkV2 genesis,即 pxvml 出生缺陷的历史事发点**("错值经 kanet.env 烤进 pxvml genesis",ledger 7/8 原话);
   - `pool.js:130` `_resolveZkNativeCtorExtras` — create/confirm zkNative PS ctor(closeZkTmplAnchor 从它派生);
   - `pool.js:1869` — debugger endpoint(诊断路径,次要)。
3. **没有任何代码比对 env ↔ ZK_GATE 两个来源一致**。规则55 的病灶(手工配对常量必失同步)只治了同文件内
   imageId↔gateTmplHash 这一对,**跨文件的 kanet.env:163 ↔ zk-close-builder.mjs:ZK_GATE 这一对仍是纯人肉同步**
   ——J2 7/8 修值时就是手动改两处(7afd18e3),下次 imageId 变更改了一处漏一处,复发条件原封不动。
4. 两个 guard 调用点都在 **genesis 下游**:
   - `zkProveWorkerTick` 的调用排在 `if (!job) return` **之后**——没有 prove job 就永不执行,而 prove job 只在
     attest 之后才出现,晚于市场 genesis 一整个生命周期段;
   - `rebuildZkCloseGateWitness` 在 zk_close 广播/门②彩排时——更晚。

**攻击链(半更新复发场景,一步不缺)**: 下次改 imageId → 开发者原子更新 ZK_GATE 两字段(commit 注释教他这么做)
→ **忘改 kanet.env:163**(或反过来只改 env 忘改 ZK_GATE) → 重启 → prove-worker guard 对 ZK_GATE 验=PASS(它确实
新鲜) → 新市场 create/handoff 把 **stale env 值**烤进 genesis → 又一个 pxvml,而且这次**所有新装的检查全绿**。
比 7/8 更糟:上次没有检查,大家警惕;这次检查全绿=假安全感。

**修法(最小闭合,三件)**:
- (a) `ensureGateTmplHashFresh` 增加一条断言:`process.env.ZK_GATE_TMPL_HASH`(若已设)必须 `=== ZK_GATE.gateTmplHash`,
  否则同样 fail-loud——跨文件双源漂移一行堵死;
- (b) 在两个 genesis-bake 侧补 guard 调用:`_resolveZkNativeCtorExtras` 的 zkNative 分支内 + `buildZkHandoffRequestV2`
  的 gateTmplHash 读取处。这是"zkNative 路径首次实际调用时 lazy"的本义(铸 zkNative genesis = ZK 功能使用),
  不违注3——非 ZK 节点根本走不进这两个分支。kaspaZk 加载器已收拢(7a94aeae),import 可得。若铸 zkNative 市场的
  节点没装 WASM → fail-loud 拒铸,好过烤一个无法验证的值(这正是 D-009 冻结门的本意);
- (c) selftest 加第4断言:env==ZK_GATE==现场推导 三源一致(operator 节点 env 已设,可直接断言)。

**NWT 自认账**: 注3 是我坚持的修正——它正确解决了启动爆炸半径,但把检查点从"启动时(必然先于重启后任何
mint)"挪到了 prove/close(genesis 下游),coverage 收窄这一刀有我一份。(b) 把 mint 侧补为第三调用点,两全:
既 lazy 不炸非 ZK 节点,又回到 genesis 上游。

## 🟡 finding②(MED·建议随①一起修): rebuildZkCloseGateWitness 处的 guard 被 ZK_PROVE_WORKER_ENABLED 门空转

`rebuildZkCloseGateWitness` 本身就要 WASM 才能跑(kaspaZk 传参进来立即使用)——能走到这个函数,WASM 必然可用,
guard 在这里不存在"炸非 ZK 节点"的可用性风险。但它被 gate 在 `ZK_PROVE_WORKER_ENABLED==1` 后面:若未来拓扑
变成"proving 在 A 机、dispatch/广播在 B 机"(B 机 worker flag=OFF),B 机的 zk_close 真广播路径上 guard **静默
no-op**——钱路最后一环恰好没检查。修法:该调用点绕过 flag(如 `ensureGateTmplHashFresh(ZK_GATE, kaspaZk,
{force:true})`),flag 只该管"要不要在 prove tick 主动跑",不该管"witness 都在重建了还查不查"。

## 🟢 无异议项(试过打、没打穿)

- **注3 时序**: prove-worker 调用点确实 lazy 且在功能开关内;guard 对非 ZK 节点(flag≠1)零路径影响——构造
  "非 ZK console 启动被炸"场景失败,注3 落实。
- **canonical sample provenance**: 3o6cs receipt 来自 7/7 真实落链 proof(commit 6979f0ae),selftest 前置断言
  `summary.image_id === ZK_GATE.imageId` 带过期自检(sample 过期时 fail 消息明确指向换 sample,不误导为 drift);
  journal_digest 字段存在性 fail-loud。挑不出毛病。
- **stale fallback 清除**: pool.js:127-129 的 `511b0ead` 硬编码 + repro4 路径 → 缺 env 直接 throw ✅;
  transport:457/pool.js:1868 已是同款纪律(核实非重复修属实)✅。**但注意:清除 fallback 恰恰让"env 是唯一值源"
  更成立,finding① 的 env 无验证问题因此更承重,两条是同一枚硬币。**
- **selftest 质量**: 三断言全是真断言非形状检查;③ 用 `'00'.repeat(32)` 假值验证 guard 真会 throw(vacuous-teeth
  双向判别的正面教材);② drift tripwire 两条独立切法交叉,非同函数自证。
- **KANet-UI 实跑 6/6 PASS** = D-009"现场推导比对"口径的合格证据形态(非"重跑一致")。

## 📌 低优先级备忘(不阻,记 runbook)

下次 imageId 变更时 canonical sample(image_id=c9918501)即过期:selftest① 会 fail-loud(好),但解法是"用新
image 重出一份 sample receipt"——这一步需要一次真实 proving,是 imageId 变更 runbook 的固定成本,写进
D-009/变更清单,防到时有人为省事绕过 guard。另:旧 sample + 新 imageId 喂 `computeGateTmplHash` 的行为
(builder 抛错 vs 照算)未实测,J2 核 diff 时若顺手能试一把更好,两种行为都安全但该知道是哪种。

## D-009 解除判定

**修完 finding①(a)(b)(c) + J2 核 + operator 节点重跑扩展 selftest 全绿 → 我给 GREEN,D-009 可解。**
当前状态 = GREEN-with-MUST-FIX,5R-2 重开继续等这一修。
