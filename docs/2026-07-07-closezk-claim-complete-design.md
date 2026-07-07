> **Status**: CURRENT

# CloseZk claim-complete 版设计 — claim entry 补全 + exit-path 矩阵硬门 + 跨 .sil 单位一致性

**作者**: J2(应急跨域顶卡1, J1 机器 15:20 判定实离线, Bettor 拍板启动应急线) · **日期**: 2026-07-07 · **reviewer**: NWT(双倍审力:逐条 checklist + 独立枚举 exit-path)

**起因**: 今天 3o6cs 51.11KAS 出生即焊死——`_j2_closezk_repro4.sil` 没有 `claim` entry(未在当时范围内实现)+ `escape_trigger` 的 `attestedAtSeconds` 语义跟 genesis-mint 委员实际签的 `attestedAtMs` 语义不一致(阈值算出来≈公元 58484)= 双出口出生皆断。定案核销后 Bettor 立新硬门:**收真钱前 genesis 前必验 exit-path 矩阵**。本设计 = 那个硬门第一次真正被走一遍,产出 claim-complete 版新合约,供下一个真实 ZK-native 市场 genesis 使用。**`_j2_closezk_repro4.sil` 本身冻结不改**(D-005 精神:已经被真实资金/dust demo 用过的字节码不动),新合约走新文件。

---

## 0. 既有资产清单(不重造,NWT checklist 要求)

| 需要的东西 | 复用来源 |
|---|---|
| escape_trigger / escape_claim 结构(deadline flag-flip + 逐 bettor nullifier claim) | `_j2_closezk_repro4.sil` L66-161,一字不动搬过来(今晚 dust demo 验证过 zk_close 段,escape 段 7/6 全链验证过) |
| claim 的 merkle membership 证明逻辑(depth-10, leaf=`blake2b(pk+amount)`) | `PayoutShard.sil` L171-225(`claim` entry),955 赢家生产验证过的原始逻辑,逐行照抄换绑定对象 |
| nullifier bitmap(w0-16, 17-word, depth-10 cap) | `_j2_closezk_repro4.sil` 已有 ctor 字段 + escape_claim 已在用的读写模式,直接复用同一份状态变量 |
| dust 边界修法(最后一个 claimant 不产生 0-value continuation) | `_j2_closezk_repro4.sil` L140-160(escape_claim 洞④修法,2026-07-06 NWT 抓 + Owner 令修),逐行照抄换分支条件 |
| `zk_continuation.proving` schema(gate/proof/guestPayoutRoot 数据来源契约) | `docs/iteration/COORD-LEDGER.md` T2b(i) 段(今晚刚定稿,NWT GREEN) |

---

## 1. 跨 .sil 单位一致性表(NWT checklist ①,58484 教训直接对应项)

**根因回顾**:`_j2_closezk_repro4.sil` L17 ctor 字段名 `attestedAtSeconds`,L72 `escape_trigger` 用 `(attestedAtSeconds + 21600) * 1000` 判定(假设输入是秒值,`*1000` 转 `tx.time` 的毫秒域)。但 genesis-mint 设计(`docs/2026-07-07-zk-genesis-mint-pipeline-design.md` §2.2)里委员 `close_attest` 签的字段叫 `attestedAtMs`(毫秒值,W2 机制沿用至今)。genesis-mint 时如果把 `attestedAtMs` 的值原样喂进 `attestedAtSeconds` 这个 ctor 槽 = 原样复现 58484 坑(把毫秒当秒存,再 `*1000` 变成又乘了一次,阈值飞到天边)。

**采用方案 = (a) 全链路统一到 ms 域**(NWT checklist ① 的推荐项,非 (b) 显式转换点——理由:少一个能出错的转换步骤,今天的教训就是"多算一步"引入的):

| 阶段 | 字段名 | 单位 | 数值来源 | .sil 内用它的行 |
|---|---|---|---|---|
| 委员 close_attest 签名(PayoutShardV2) | `attestedAtMs` | 毫秒 | 委员 5 签 sighash 覆盖,链上 committee-attested(见 `docs/2026-07-07-zk-genesis-mint-pipeline-design.md` §2.2) | 不在本合约,是上游 PayoutShardV2 的 state |
| genesis-mint(zk_handoff 落链后,driver 读 PayoutShardV2 state)| `attestedAtMs` | 毫秒(**不转换**) | 直接从 PayoutShardV2 continuation state 读出原值,原样烤进新合约 ctor | ctor param(见 §2 diff) |
| 新合约 ctor 常量 | `attestedAtMs`(**改名,原 `attestedAtSeconds` 删除**) | 毫秒 | genesis-mint 时烤死,不可变 | `entrypoint function escape_trigger` 的 `require` 行 |
| `escape_trigger` require | `ESCAPE_GRACE_MS` (**改名,原 21600 常量删除单位歧义**) | 毫秒(21600000 = 6 小时,**不再 `*1000`**) | 团队签字确认的宽限期(见 §4,仍是占位数,需另行签字,非本设计解决) | `require(tx.time >= attestedAtMs + ESCAPE_GRACE_MS)` |
| `tx.time`(Kaspa 内建) | — | 毫秒(memory `reference-silverscript-txtime-ms-lockfile-threshold` 已坐实此语义,非本设计新发现) | 链上 | 同上一行 |

**结果**:整条路径(委员签名 → genesis-mint 烤 ctor → `.sil` require)只有一种单位(毫秒),零转换点,`escape_trigger` 的 `require` 行从 `(attestedAtSeconds + 21600) * 1000` 简化为 `attestedAtMs + ESCAPE_GRACE_MS`——**字面上更简单,不是更复杂**,这是消除 58484 坑的结构性修法而非补丁。

**⚠ escape-anchor 单位统一**(Bettor 要求⑤):`closeZkTmplAnchor`(PayoutShardV2 §2.1 新增 ctor 字段,`blake2b(gatePrefix+gateSuffix)` 型的模板锚)本身不编码任何时间值(纯 opaque hash),不存在单位歧义——上面这张表已经是"跟 anchor 同一套 genesis-mint 管线产出值"的完整单位口径,不需要额外协调。

---

## 2. `CloseZkV2.sil` diff(相对 `_j2_closezk_repro4.sil`,新文件,不改老文件)

**文件位置**:`kasia-console/src/lib/CloseZkV2.sil`(比照 `PayoutShard.sil`/`PayoutShardV2.sil` 的既有存放位置,不再放根目录 `_j2_*` 临时脚本区——`_j2_closezk_repro4.sil` 归位改名是独立非阻塞 backlog,新文件从一开始就放对地方)。

### 2.1 ctor 改动(单位统一,§1 表格落地)

```diff
 contract CloseZkV2(
     byte[32] gateTmplHash,
     byte[32] betsRootBaked,
     byte[32] refundRootBaked,
-    int      attestedAtSeconds,     // 洞②修正: genesis-mint时 off-chain builder 读 kaspa_tx_log 里 close_attest 落链时间烤入
+    int      attestedAtMs,          // §1 修正: 直接读 PayoutShardV2 close_attest state 的 attestedAtMs 原值烤入, 不转换单位
     int      init_attestedWinner,
     int      init_closed,
     byte[32] init_payoutRootField,
     int      init_consolidated_pool,
     int init_w0, ... int init_w16
 ) {
```

### 2.2 `escape_trigger` 改动(单位统一)

```diff
     entrypoint function escape_trigger(int selfOutIdx) {
         require(closed == 1);
-        require(tx.time >= (attestedAtSeconds + 21600) * 1000);   // ⚠ 21600 占位, 未签字确认
+        require(tx.time >= attestedAtMs + ESCAPE_GRACE_MS);        // ESCAPE_GRACE_MS 常量见 §4, 仍是占位数, 需团队另行签字(本设计只修单位, 不重新论证时长)
         require(tx.outputs[selfOutIdx].value == consolidated_pool);
         validateOutputState(selfOutIdx, { ... 不变 ... });
     }
```

### 2.3 `zk_close` / `escape_claim`:**逐字节照抄,零改动**(NWT checklist 隐含要求:REGRESSION-safe,今天 dust demo 验证过的字节码原样保留)。

### 2.3.1 守恒前提:Σ(payoutRootField 全部 leaf) == consolidated_pool 精确成立(Bettor 15:28 方向审必答洞)

**问题**:§2.4 的 dust 边界分支用 `consolidated_pool == payout` 判定"是否最后一个 claimant"。guest 用整数除法算 pari-mutuel payout(`(stake * distributable) / total_win_stake`),若有取整余数且没有归零规则,Σ(payout leaves) 会 < `consolidated_pool`,最后一个 claimant 永远走不到"精确清零"分支,留一个含余数 sompi 的 `closed==2` continuation——若 §3.1 裁定选 A(`closed==2` 无逃生舱),这个余数会**永久焊死**,跟 3o6cs 同族问题。

**核实结果(读 `zk-payout-guest/methods/guest/src/main.rs`,commit `8b9b50f0`,非猜测)**:**已有 canonical 余数规则,不是缺口**。

```rust
// main.rs:157-176(节录)
let distributable = pool - fee_sompi;                      // 守恒起点: distributable + fee_sompi == pool(consolidated_pool) 精确成立, 无额外取整
let winners: Vec<&Bet> = input.bettors.iter().filter(|b| b.direction == input.winning_direction).collect();
let mut payouts: Vec<PayoutLeaf> = winners.iter().map(|b| {
    let amt = ((b.stake as u128) * (distributable as u128) / (total_win_stake as u128)) as u64;   // 整数除法, 有余数
    PayoutLeaf { pk: b.pk, amount: amt }
}).collect();
let assigned: u64 = payouts.iter().map(|p| p.amount).sum();
payouts[0].amount += distributable - assigned;              // ★ dust 全部归 payouts[0](winners 过滤后数组的第一个)
let mut leaves = payouts;
leaves.extend(input.fee_leaves...);                          // fee leaves 追加在 winner leaves 之后, 顺序即最终 merkle_index 顺序
payout_root(&leaves)
```

**守恒链**:`Σ(winner payout leaves) == distributable`(整除余数已被 `payouts[0]` 吸收,精确无余)+ `Σ(fee leaves) == fee_sompi`(fee leaves 是直接传入的既定金额,非再分配)⟹ `Σ(payoutRootField 全部 leaf) == distributable + fee_sompi == pool == consolidated_pool`,**精确成立**,不是概率意义上"大概率对齐"。`payouts[0]`(拿 dust 的那个 winner)在 `payout_root()` 建树时数组下标 0,对应最终 `merkle_index == 0`——跟 J2 最初设想的"remainder 归 merkle_index 最小的 winner"规则**结果一致**,但权威规则来源是 guest 电路本身(main.rs:172-173),非本设计新提议。

**🔴 真实断裂分支(Bettor 15:33 独立源码核验,main.rs L152-156)**:上面"精确成立"的推导有一个前提没写出来——`fee_sompi` 的计算有两条路:`fee_leaves` 非空时直接取 `Σfee_leaves`(此时 L175 `leaves.extend(fee_leaves)` 把这些 leaf 真实放进树,守恒链成立);但**若调用方 `fee_leaves` 传空且 `fee_bps > 0`,`fee_sompi` 走 bps fallback(`pool * fee_bps / 10000`,整数截断)算出一个值从 `distributable` 里扣掉(L157),但 L175 `extend` 的是这个空的 `fee_leaves` = 没有任何 leaf 承载这笔 `fee_sompi`**——`Σ(payoutRootField 全部 leaf) == distributable == pool - fee_sompi < pool`,**fee 部分在 `closed==2` 永久无主(没有任何 merkle proof 能证明这笔钱归谁,claim 机制物理上够不到它)**。**结论:"Σleaf == pool 精确成立"只在(`fee_bps==0` 或 `fee_leaves` 显式非空提供)时为真,不是在任何输入组合下都成立的不变量。**

**§2.4 dust 边界分支的成立前提因此收紧**:①`consolidated_pool == payout` 精确清零仍然会在"最后一个 claimant"发生(不管顺序),但**仅当 mint 时构造的树真实覆盖了 `pool` 全额**——若上游用了 bps-fallback 空 `fee_leaves`,树本身就先天不完整(少了 `fee_sompi` 那部分),claim 全部走完后会剩一个 `fee_sompi` 大小、没人能证明归属的 `closed==2` continuation,永久卡死(§3 closed==2 无逃生舱这条风险因此实际发生)。②因此 **§4 硬门第⑤条(driver 独立断言 `Σleaf == consolidated_pool`)不是防御性/锦上添花,是承重件**——它是唯一能在 genesis 前拦住"用了 bps-fallback 导致树先天不完整"这个真实断裂分支的检查点,必须 **BLOCKING**(断言失败 = 拒绝 mint,不是警告)且必须有对应测试用例(§4.1)。③**mint 政策二选一,推荐禁 bps-fallback**:genesis-mint driver 一律要求调用方显式提供完整 `fee_leaves`(哪怕金额为 0 也要显式传空数组走"零 fee 场景",不允许依赖 guest 内部的 bps 隐式计算路径)——这样从**输入层面直接消除**这个断裂分支的触发条件,比"事后用断言拦"更彻底(断言是最后一道防线,禁用触发条件是从根切断攻击面)。

### 2.4 新增 `claim` entrypoint(NWT checklist ③④⑤ 全部落地)

```silverscript
    // NWT checklist③: 验对象是 payoutRootField(zk_close 写入, guest 算出的 pari-mutuel payout 树),
    //   不是 refundRootBaked(escape_claim 专用的原始 stake 树, 语义不同: payout 金额 ≠ 原始 stake)。
    //   leaf 公式 blake2b(bettorPk + byte[](payout,8)) 照抄 PayoutShard.sil claim entry(L179), 非重发明。
    entrypoint function claim(
        int selfOutIdx, int payoutOutIdx,
        byte[32] bettorPk, int payout, int merkle_index,
        byte[32] s0, byte[32] s1, byte[32] s2, byte[32] s3, byte[32] s4, byte[32] s5, byte[32] s6, byte[32] s7, byte[32] s8, byte[32] s9
    ) {
        require(closed == 2);                                             // ★ 精确 ==2: zk_close 已完成, 与 escape_claim 的 ==3 互斥(§3⑤)
        require(merkle_index >= 0); require(merkle_index < 1024);         // depth-10 cap, 同 PayoutShard.sil claim / escape_claim
        require(payout >= 1); require(payout <= consolidated_pool);
        byte[32] cur = blake2b(byte[](bettorPk) + byte[](payout, 8));
        int div = 1;
        int b0 = (merkle_index / div) % 2; if (b0 == 0) { cur = blake2b(byte[](cur) + byte[](s0)); } else { cur = blake2b(byte[](s0) + byte[](cur)); } div = div * 2;
        int b1 = (merkle_index / div) % 2; if (b1 == 0) { cur = blake2b(byte[](cur) + byte[](s1)); } else { cur = blake2b(byte[](s1) + byte[](cur)); } div = div * 2;
        int b2 = (merkle_index / div) % 2; if (b2 == 0) { cur = blake2b(byte[](cur) + byte[](s2)); } else { cur = blake2b(byte[](s2) + byte[](cur)); } div = div * 2;
        int b3 = (merkle_index / div) % 2; if (b3 == 0) { cur = blake2b(byte[](cur) + byte[](s3)); } else { cur = blake2b(byte[](s3) + byte[](cur)); } div = div * 2;
        int b4 = (merkle_index / div) % 2; if (b4 == 0) { cur = blake2b(byte[](cur) + byte[](s4)); } else { cur = blake2b(byte[](s4) + byte[](cur)); } div = div * 2;
        int b5 = (merkle_index / div) % 2; if (b5 == 0) { cur = blake2b(byte[](cur) + byte[](s5)); } else { cur = blake2b(byte[](s5) + byte[](cur)); } div = div * 2;
        int b6 = (merkle_index / div) % 2; if (b6 == 0) { cur = blake2b(byte[](cur) + byte[](s6)); } else { cur = blake2b(byte[](s6) + byte[](cur)); } div = div * 2;
        int b7 = (merkle_index / div) % 2; if (b7 == 0) { cur = blake2b(byte[](cur) + byte[](s7)); } else { cur = blake2b(byte[](s7) + byte[](cur)); } div = div * 2;
        int b8 = (merkle_index / div) % 2; if (b8 == 0) { cur = blake2b(byte[](cur) + byte[](s8)); } else { cur = blake2b(byte[](s8) + byte[](cur)); } div = div * 2;
        int b9 = (merkle_index / div) % 2; if (b9 == 0) { cur = blake2b(byte[](cur) + byte[](s9)); } else { cur = blake2b(byte[](s9) + byte[](cur)); } div = div * 2;
        require(cur == payoutRootField);                                   // ★ NWT checklist③: 验对象是 payoutRootField, 不是 refundRootBaked/betsRootBaked
        int word_idx = merkle_index / 63;
        int bit_in   = merkle_index % 63;
        int mask = 1;
        for (b, 0, bit_in, 63) { mask = mask * 2; }
        int nw0 = w0; int nw1 = w1; int nw2 = w2; int nw3 = w3; int nw4 = w4; int nw5 = w5; int nw6 = w6; int nw7 = w7; int nw8 = w8;
        int nw9 = w9; int nw10 = w10; int nw11 = w11; int nw12 = w12; int nw13 = w13; int nw14 = w14; int nw15 = w15; int nw16 = w16;
        // ★ NWT checklist⑤: 复用 escape_claim 同一份 w0-16 顶层 state 变量(非重开一份新 nullifier)——
        //   安全性论证见 §3⑤, 不是悄悄假设。
        if (word_idx == 0)       { require((w0 / mask) % 2 == 0); nw0 = w0 + mask; }
        else if (word_idx == 1)  { require((w1 / mask) % 2 == 0); nw1 = w1 + mask; }
        else if (word_idx == 2)  { require((w2 / mask) % 2 == 0); nw2 = w2 + mask; }
        else if (word_idx == 3)  { require((w3 / mask) % 2 == 0); nw3 = w3 + mask; }
        else if (word_idx == 4)  { require((w4 / mask) % 2 == 0); nw4 = w4 + mask; }
        else if (word_idx == 5)  { require((w5 / mask) % 2 == 0); nw5 = w5 + mask; }
        else if (word_idx == 6)  { require((w6 / mask) % 2 == 0); nw6 = w6 + mask; }
        else if (word_idx == 7)  { require((w7 / mask) % 2 == 0); nw7 = w7 + mask; }
        else if (word_idx == 8)  { require((w8 / mask) % 2 == 0); nw8 = w8 + mask; }
        else if (word_idx == 9)  { require((w9 / mask) % 2 == 0); nw9 = w9 + mask; }
        else if (word_idx == 10) { require((w10 / mask) % 2 == 0); nw10 = w10 + mask; }
        else if (word_idx == 11) { require((w11 / mask) % 2 == 0); nw11 = w11 + mask; }
        else if (word_idx == 12) { require((w12 / mask) % 2 == 0); nw12 = w12 + mask; }
        else if (word_idx == 13) { require((w13 / mask) % 2 == 0); nw13 = w13 + mask; }
        else if (word_idx == 14) { require((w14 / mask) % 2 == 0); nw14 = w14 + mask; }
        else if (word_idx == 15) { require((w15 / mask) % 2 == 0); nw15 = w15 + mask; }
        else                     { require((w16 / mask) % 2 == 0); nw16 = w16 + mask; }
        byte[34] winnerLock = new ScriptPubKeyP2PK(pubkey(bettorPk));
        require(tx.outputs[payoutOutIdx].scriptPubKey == byte[](winnerLock));
        require(tx.outputs[payoutOutIdx].value == payout);
        // ★ NWT checklist④: dust 边界修法, 逐行照抄 _j2_closezk_repro4.sil escape_claim(L140-160) 同款分支,
        //   非重新发明。最后一个 claimant 精确清零 consolidated_pool 时不产生 0-value continuation output。
        if (consolidated_pool == payout) {
            // 最后一笔: 覆约生命周期在这笔 tx 结束, 不留 continuation, 不约束 selfOutIdx。
            require(tx.outputs[payoutOutIdx].value == consolidated_pool);   // 显式守恒(同 escape_claim 同款防御性写法)
        } else {
            require(tx.outputs[selfOutIdx].value == consolidated_pool - payout);   // ★ 守恒 weld, 逐笔递减
            validateOutputState(selfOutIdx, {
                attestedWinner: attestedWinner,
                closed: 2,   // ★ 不变: 靠这个值 stay 住让下一个 winner 还能调, 不靠 closed 变化分辨"谁领过"(同 escape_claim 洞①修法核心)
                payoutRootField: payoutRootField,
                consolidated_pool: consolidated_pool - payout,
                w0: nw0, w1: nw1, w2: nw2, w3: nw3, w4: nw4, w5: nw5, w6: nw6, w7: nw7, w8: nw8, w9: nw9, w10: nw10, w11: nw11, w12: nw12, w13: nw13, w14: nw14, w15: nw15, w16: nw16
            });
        }
    }
```

---

## 3. exit-path 矩阵(NWT checklist② + NWT 独立枚举发现,表格体,不接受叙述体)

| closed | 接受此值为 precondition 的 entry | 至少一条路径能让 bettor 实拿到钱? | deadline 级逃生舱? | 备注 |
|---|---|---|---|---|
| **0** | 无(本合约任何 entry 都不接受 `closed==0`) | N/A | N/A | **理论态,生产管线不产生**——`zk_handoff` 只在 PayoutShardV2 `closed==1`(委员已 attest)之后才 mint `CloseZkV2`,`init_closed` ctor 恒为 1。genesis-mint driver 必须硬编码校验 `init_closed==1`,拒绝以其他值 mint(§4 新硬门第②条)。 |
| **1**(已 attest 待处理) | `zk_close`(→2) / `escape_trigger`(→3, deadline-gated) | 是(通过 `zk_close`→`closed=2`→`claim`) | 是(`escape_trigger`, `tx.time >= attestedAtMs + ESCAPE_GRACE_MS`,§1 单位已统一) | 双出口,互斥(write-once),不会死锁——**前提是 §1 单位统一生效**,今天的坑就出在这一格。 |
| **2**(zk_close 完成,待 claim) | `claim`(逐 bettor, nullifier 防重复,stay 2) | 是(`claim` 本身就是付款) | **未定案——两个选项待 Bettor 裁定,见 §3.1** | **NWT 独立枚举发现,checklist 未覆盖**:若 `claim` 逻辑本身有未测到的边界 bug,`closed==2` 没有像 `closed==1` 那样的 `escape_trigger` 兜底,钱会跟 3o6cs 一样卡死。**这是显式团队知情同意的风险决策,不是留白**(Bettor 2026-07-07 15:23 指令)。 |
| **3**(escape 已触发,待逐 bettor 领) | `escape_claim`(逐 bettor, nullifier 防重复,stay 3) | 是(`escape_claim` 本身就是退款) | N/A(已经是 escape 态本身,不需要再嵌套一层) | 逐行照抄 `_j2_closezk_repro4.sil` 现成代码,今天全链验证过,无进一步需求。 |

### 3.1 `closed==2` 逃生舱:选项 A vs 选项 B(Bettor 2026-07-07 15:23 指令,取舍由 Bettor 裁定并记 ledger 为知情风险决策)

**选项 A(接受残余风险,不新增 entry)**
- 缓解手段:`claim` 逐行照抄 `PayoutShard.sil` 已在生产验证过 955 赢家的原始 merkle 逻辑(非新代码,bug 面本来就低)+ `cli-debugger` 本地反复验证(今晚 `unlockBshardZkClose` 就是这样查出 gateTmplHash 错值的,零盲目广播试错)+ dust 实例 E2E 先行(小额市场先跑一遍 `claim` 全流程,再上真实大额市场)。
- 代价:`claim` 若真有编译期没测到的边界 bug,`closed==2` 阶段的资金物理上无法挽回(跟 3o6cs 同一种失败模式,但**触发条件不同**——3o6cs 是"entry 压根不存在",这里是"entry 存在但假设有极低概率的实现 bug")。
- 复杂度成本:零(`CloseZkV2.sil` entry 数量 = repro4 的 3 个 + 新增 `claim` 1 个 = 4 个,不再多)。

**选项 B(`closed==2` 加 deadline-gated escape)**
- 需要的机制:`claim` 的授权来源是 `payoutRootField` 这棵 merkle 树的 membership 证明——如果 `claim` 本身有 bug(比如树算错/漏了某个 leaf),问题出在**树或验证逻辑本身**,一个"到期后走 `payoutRootField` 树退款"的 escape 入口会**复用同一棵可能有问题的树**,不能真正兜底"树算错"这类风险;能兜底的只有**不依赖 `payoutRootField` 的独立授权路径**——即比照 `refund_claim`/`cancel_attest` 的模式,新增一个**委员 5 签背书的紧急 override entry**(比如 `emergency_refund`:`closed==2` + `tx.time >= zkCloseAtMs + LONG_GRACE` + 5-of-5 委员签名背书一个新的 `refundRoot`,验证对象换成独立算的 emergency 退款树)。
- 代价:①多一个 money-path entry,状态机从 4 个 entry 变 5 个;②委员必须在紧急场景下重新独立计算一棵"谁还没领到多少"的树(genesis 时刻不存在,需要运行时动态构建,委员各自独立重算——这本身是新的复杂 verify-value-source 逻辑,不是简单复用现成代码);③`LONG_GRACE` 又是一个需要团队签字的新常量(重蹈 §1 单位教训的同类风险:一个新常量 = 一个新的能出错的地方);④这条 escape 路径本身作为**新代码**(委员紧急签名+动态树重算),其正确性验证成本可能不低于它想兜底的 `claim` 本身——**有可能把"claim 万一有 bug"的风险换成"emergency escape 万一有 bug"的风险,而不是净减少风险**。

**选项 C(NWT 补充,15:30,介于 A/B 之间供参考)**
- 不追求"按 merkle 树精确分给每个 bettor",而是委员 5 签 + 超长 grace period(以周计,非 §1 的 6 小时量级)后,把 `consolidated_pool` 剩余部分**整体 sweep 到团队可控的多签/托管地址**(不自动精确分配给具体 bettor)。
- 完全不需要重算任何 merkle 树,只需要委员背书"claim 机制确认失效,启动人工善后"——资金从"可证明永久卡死"变成"可通过链下人工流程追回",**风险性质发生质变**(链上焊死 → 链下可挽回),而非新增一套同样复杂的自动分配代码(选项 B 的核心问题)。
- 复杂度介于 A 和 B 之间:比 B 简单(不需要动态重算树),比 A 多一点(需要一个新 entry + 委员签名 + 长 grace 常量)。

**J2 推荐 = 选项 A**,理由:
1. `claim` 是本设计里**风险最低**的一块(逐行照抄生产验证 955 赢家的代码,不是新逻辑),选项 B 想兜底的恰恰是这块目前证据最扎实的部分。
2. 选项 B 引入的新代码(委员紧急签名 + 动态树重算)复杂度和验证成本不亚于它想保护的对象,不是"免费的安全网"。
3. 缓解手段(cli-debugger 本地验证 + dust 先行)已经是今晚 `zk_close` 撞两个真 bug 都被拦下的实证方法论,同样方法论用在 `claim` 落码/genesis 阶段可以覆盖住"部署前发现 bug"这类风险;选项 A 剩下的敞口是"部署后才发现的边界 bug",这类风险在 `PayoutShard.sil` claim 生产使用这么久没出过事的前提下,评估为低概率高既有验证覆盖。
4. 若 Bettor 裁定选 B,建议**作为独立 T3 任务卡**(委员紧急签名机制 + 动态树重算设计),不占用本设计(claim-complete 版首次落地)的时间线——不应该让"要不要加安全网"这个决策阻塞"先把 claim 基本功能补上"这件事本身。

### 3.2 终裁(Bettor 2026-07-07 15:31,记 COORD-LEDGER)

**结构性前提**(Bettor 点破):exit path 必须 genesis 时烤进字节码,`state-in-address` 决定了不能事后 retrofit(51.11 教训本体)——所以"C/B 排 T3"的真实语义不是"给这一版补",是"以后新市场可以铸带 C/B 的版本"。

- **今晚这版(首个市场)维持选项 A**——前提 = KANet-UI 参数草案已锁定首市场为 dust 级 + 纯团队内部资金(1-2KAS),A 的残余敞口 = 几个 KAS 团队钱,可接受。§3.1 的 15:28 四项绑定条件不变(① Σpayout 洞已闭 ② dust E2E 须覆盖 claim 全路径含精确清零分支+多 claimant 顺序领取 ③ B 归档 T3 不阻塞 ④ 本节即签字)。
- **选项 B 正式否决归档**(NWT/J2 论证一致:动态树重算复杂度 ≥ 它想保护的对象)。
- **选项 C 取代 B 成为 T3 首选备胎**,但挂显式警示:委员 5 签 sweep 到团队地址 = **信任模型降级**(ZK-native 线的全部意义是 post-genesis 委员权力被 proof 束缚,C 给了委员 grace 后的无界权力)。**任何含外部真实用户资金的市场要不要铸 C 版,是 Owner 级信任模型决策,须进准入政策硬门,不是工程默认**。

---

## 4. 新硬门(genesis 前必验,Bettor 2026-07-07 钦定"收真钱前必验 exit-path 矩阵"落地为可执行 checklist)

**genesis-mint driver(T2b(ii) 落码时必须校验的前置条件,不是文档承诺)**:
1. `init_closed` 必须 == 1(拒绝 mint 任何其他初值——对应 §3 表格 closed=0 那行"理论态,生产管线不产生")。
2. `attestedAtMs` 直接从 PayoutShardV2 close_attest state 读原值烤入,**不做任何单位转换**(genesis-mint driver 代码里如果出现 `*1000`/`/1000` 就是 bug,红队审必查)。
3. `ESCAPE_GRACE_MS` 常量在真实市场 genesis 前必须由 Bettor/Owner 显式签字确认数值(本设计只修单位, 不重新论证时长——21600000ms=6h 仍是占位, 见 `_j2_closezk_repro4.sil` L67-69 原始占位说明)。
4. genesis-mint 完成后,立刻(同一 review 窗口内)过一遍本文档 §3 exit-path 矩阵,确认这次具体市场的参数(尤其 `consolidated_pool`/`attestedAtMs`)没有引入新的单位/边界问题——**checklist 走一遍,不是"文档存在即等于走过"**。
5. **🔴 承重件(非防御性,Bettor 15:33 独立源码核验升级)——driver 硬断言 `Σ(payoutRootField 全部 leaf) == consolidated_pool`,不等即 BLOCKING 拒绝 prove/铸 gate(⚠ 挂点更正,Bettor 15:55: 不是"拒 mint"——`payoutRootField` 只在 `zk_close` 之后才有真实值,CloseZkV2 genesis-mint 那一刻只有 `consolidated_pool` 烤值,leaf 集在 prove 阶段构造 guest journal/gate 时才存在,这才是真拦截点),且必须有对应测试用例覆盖**:main.rs L152-156 存在真实断裂分支——`fee_leaves` 传空 + `fee_bps>0` 时走 bps-fallback,`fee_sompi` 从 `distributable` 扣除但没有任何 leaf 承载它,`Σleaf == pool - fee_sompi < pool`,树先天不完整,claim 走完会剩一笔无主的 `fee_sompi`,`closed==2` 永久卡死(§3 closed==2 无逃生舱风险因此实际触发,非假设)。此断言是**唯一能在 genesis 前拦住这个真实断裂分支的检查点**(Bettor+NWT 三方独立收敛确认,非误读)。
   - **配套 mint 政策(推荐,不只是断言拦截)**:genesis-mint driver **一律禁止 bps-fallback 模式**——调用方必须显式提供完整 `fee_leaves`(哪怕零 fee 场景也显式传空数组走"零 fee"路径,不依赖 guest 内部隐式 bps 计算)。从输入层面直接消除断裂分支的触发条件,比"事后断言拦"更彻底(断言是最后一道防线,禁用触发条件是从根切断攻击面)。
   - **配套测试用例(T2b(ii)/dust E2E 落码时必含)**:①`fee_leaves` 非空场景,全部 winner + fee 收款人依次 `claim`,验证最后一笔精确清零 `consolidated_pool`,continuation 正确终止(不产生 0-value output)②故意构造 `fee_leaves` 传空 + `fee_bps>0` 的 mint 请求,验证 driver 硬断言正确拒绝(负向测试,证明拦截真的生效非纸面)。
6. **`closeZkTmplAnchor` 必须对 `CloseZkV2` 当次实际编译字节重新计算,不得读取/复用任何 `_j2_closezk_repro4.sil` 时代缓存的旧值**(NWT 红队发现,15:29-15:30——`CloseZkV2` 跟 `CloseZkRepro4` 是不同字节码(多了 `claim` entry),anchor 必须绑定新产物;这跟今晚 `gateTmplHash` 撞的坑同一个 bug 形状——"沿用旧缓存值而非对新产物重新算",红队审必查这一点)。
7. **brokered 市场(`broker_relay_id` 非空)genesis 时 `fee_leaves` 必含 broker 那份**(按 `broker_fee_pct` 换算, 收款 pk = broker relay pubkey——Bettor 2026-07-07 19:01 裁定:broker fee 真实到账是 ZK-native 管线的原生属性, 不往老 committee-sig 路径补 fee 机制(D-001 锁), `fee_leaves` 机制本来就是为这个建的)。跟第⑤条硬门(禁 bps-fallback, 必须显式提供完整 `fee_leaves`)是同一个输入面的两条约束, mint driver 落码时一并核对。

---

## 5. w0-16 共享安全性论证(NWT checklist⑤,不能悄悄假设)

`claim`(`closed==2` 前置)与 `escape_claim`(`closed==3` 前置)对同一份顶层 state 变量 `w0`..`w16` 读写,安全性成立的理由:

1. `closed` 是 write-once 语义(`zk_close`: 1→2;`escape_trigger`: 1→3),两条转换从同一个前置状态(`closed==1`)出发,互斥(`.sil` 无法同时执行两次不同的 `validateOutputState` 落两个不同值)。
2. 因此对**同一个合约实例**(同一条 UTXO 续约链),`closed` 在其剩余生命周期内只能是 2 **或** 3 中的一个,不会出现同一实例先后经历 `closed=2` 又 `closed=3`(或反过来)的情形——**没有两条路都活的场景**。
3. `w0-16` 的语义是"这个 merkle 树(不管是 `payoutRootField` 还是 `refundRootBaked`)的哪些 leaf index 已经被领过"——因为一个实例终身只绑定一棵树(要么 payout 树要么 refund 树,由 §3 的互斥保证),bitmap 在该实例生命周期内只会被一种语义解读,不存在"同一个 bit 被两棵树的不同 leaf 各解读一次"的冲突。
4. **结论**:共享同一份 `w0-16` 状态变量是安全的,不是节省 ctor 字段的取巧——是建立在 `closed` write-once 互斥这个已经被 `.sil` 语言层面强制的不变量之上。

---

## 6. 团队知情同意签字区(§3 closed=2 风险条款)

- [ ] Owner/Bettor 确认:接受"`closed==2` 无 deadline 级整体退款"这一风险敞口,理由 = `claim` 逻辑继承自生产验证代码、风险评估为低,新增逃生舱对钱路复杂度无收益。
- [ ] NWT 红队复核:§2 `claim` entry 逐行 diff 对照 `PayoutShard.sil`/`_j2_closezk_repro4.sil escape_claim` 无隐藏偏差。
- [ ] genesis-mint driver 落码(T2b(ii))时逐条核对 §4 新硬门 4 项。

---

## 7. 剩余开放问题(留 T2b(ii) 落码阶段解决,非本设计范围)

1. genesis-mint driver 如何从 PayoutShardV2 close_attest 落链的 tx 里可靠读出 `attestedAtMs` 原始值(读 witness 还是读 state splice——具体字节 offset 待 T2b(ii) 落码核对,复用既有 `spliceLeafState`/`_PMR_*` 系列 offset 表模式,非新发明)。
2. `ESCAPE_GRACE_MS` 最终数值签字(§4 第③项)。
3. `CloseZkV2.sil` 编译后的 selector dispatch 校验(4 个 entry:`zk_close`/`escape_trigger`/`escape_claim`/`claim`,新增 `claim` 后 dispatch 逻辑需显式验证路由正确,同 `PayoutShardV2.sil` W1 落码时用过的方法,memory `feedback-ss-entry-reorder-breaks-handler-selector` 教训不默认"新文件天然安全")。
