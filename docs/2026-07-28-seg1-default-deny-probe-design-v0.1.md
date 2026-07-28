# 第一段验收 · default-deny probe 套设计 v0.2(NWT 红队审已吸收·可落码)

> **Status**: CURRENT
> **v0.2 变更(2026-07-28)**: 吸收 @NWT 设计审 verdict `249fef06`(GREEN-with-1-MUST-FIX + 4 note)。
> **🔴 MUST-FIX 的方向与 v0.1 相反,已改**:见 §4.0。**四个 note 全吸收**:§4.1(b-2 指定命令)· §3 表补 `armed=off` 行 · §5④(Agent Card 无 origin)· §4.4(b-1 移出用例集)。
> **而 v0.2 另有一格是 Bettor 复核 NWT 建议时新核出来的**(§4.1.1 免费对照臂),比双方原稿都干净。
> **batch**: 第一段(能力清点与强制)
> **作者**: Bettor(架构师帽) · **红队审**: @NWT(设计审·独立,非自审) · **落码**: 待红队过后派
> **依据**: `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md` 第一段「完成定义(预注册,开工后不许改)」

---

## 0. 一句话

**第一段的验收定义里 (b) 那半 —— 承重的那半 —— 照它的字面去实现,会得到一个【空过】的测试:它会全绿,而闸从来没有被执行过。** 本设计给出会真正执行到闸的 probe 形状。

---

## 1. 先复述预注册的验收定义(原文,不改写)

```
❌ 不是「权限代码写完了、审过了」
✅ (a) 枚举 probe: 每条【清单上的】能力有一个对应的越权 probe, 全部 BUST
🔴 (b) default-deny probe: 拿凭证尝试【不在清单上的】动作, 预期默认拒绝
       —— 不存在的能力名 / 未授权的表 / 未注册的消息类型, 各至少一发
```
> 路线图自己的理由:「『你被授予了这些』由 (a) 证;而『别的做不了』指向的是【清单之外】,那里没有 probe。⇒ 只有 (a) 就是拿 N 个 BUST 去证一个它们够不着的命题。」

**这个理由成立,本设计不动它。本设计动的是 (b) 的【实现形状】。**

---

## 2. 🔴 核心发现:(b) 的第一项「不存在的能力名」照字面做 = 空过

### 2.1 实读到的执行顺序(`kasia-relay/src/relay.mjs`,非推断)

```
process.on('message', cmd) →
  ① validateCommandPayload(cmd)      ← 未知 type 在这里就被拒, 【早于闸】
       ⇒ 回执 { ok:false, error:'invalid command: …' }      ← 🔴 没有 phase / 没有 reason_code
       ⇒ return                                              ← 根本不往下走
  ② handshake/send_message 的地址校验  ← 也早于闸
  ③ authorizeCommand(cmd)             ← 闸在这里(§4.1 locus)
       ⇒ deny 回执 { ok:false, denied:true, phase:'authorization', reason_code:'…' }
```

### 2.2 ⇒ 后果

```
🔴 probe 发一个【不存在的能力名】 ⇒ 被 ① 拒 ⇒ probe 看到"被拒了" ⇒ 判 PASS
   而闸(③)【一次都没运行】。这条 probe 证明的是【命令校验器】, 不是【default-deny】
🔴 而它与真 default-deny 在【"有没有被拒"这个判据下逐字相同】—— 两种完全不同的机制,
   同一个观测结果
```
🔵 **这正是「失败不产生失败,产生一个形状正确的答案」在验收层的实例**:一个空过的验收,和一个真验收,报告长得一样。而它一旦被写进"第一段已验收",**后面每一段都站在它上面**。

### 2.3 🔨 修正:(b) 必须拆成两条,判据落在 `phase` 上

| (b) 子项 | 由哪个机制负责 | probe 必须断言 |
|---|---|---|
| **b-1 不存在的能力名** | `validateCommandPayload`(**不是闸**) | `error` 匹配 `invalid command:` **且** 回执里**没有** `phase` 字段 —— 明确记为「命令校验层拒绝」,**不计入 default-deny 证据** |
| **b-2 已注册命令 + origin 缺失/非法** | `authorizeCommand`(**这才是闸**) | `denied===true` **且** `phase==='authorization'` **且** `reason_code==='ORIGIN_MISSING_OR_INVALID'` |
| **b-3 已注册命令 + origin='app' + 凭证里没有的意图** | `authorizeAppCommand`(信封验证链) | `phase==='authorization'` **且** `reason_code` ∈ app 路径拒绝枚举(**待填,见 §5 未知格**) |

🔴 **判据铁律**:**「被拒了」不是判据,「被哪一层拒的」才是。** 结构化 `phase`/`reason_code` 是 Codex 第二轮 RED 修正④ 专为此加的(`relay.mjs:368-377` 注释原文:让"把 GATE DENY 误当到达执行层"这类误判**在结构层面不可能发生**)—— **本设计只是把这个已有能力用到验收上,不新增机制。**

---

## 3. 🔴 第二个发现:第一段那句承诺,今天只对 origin='app' 成立

实读 `authorize.mjs` armed=on 分支,四个 origin 的**实际语义**:

| origin | 闸做了什么 | 是不是"强制" |
|---|---|---|
| `internal` | **信标签放行**(注释原文:乙路 TCB,场景 B 可伪=乙已接受 TCB 残留) | 🔴 **否** — 信任,不是验证 |
| `operator` | **信标签放行**(白名单/auth/IP 在 operator-settle 端点做,闸不重复) | 🔴 **否** — 且依赖「全仓唯一 `sendCommandAsync(...,'operator')` 调用点」这个**单来源假设** |
| `legacy-unmigrated` | **显式正向标记后放行** + LOUD warn + 计数 | 🔴 **否** — 注释自己写着「迁移债 marker·**非安全控制**」 |
| `app` | 完整 grant/envelope 验证链 | ✅ **是** |
| 缺失/非法 | fail-closed 拒 | ✅ **是**(default-deny 本体) |
| 🔴 `armed=off`(**NWT note-2 补的行**) | `:70` **在判 origin 之前**无条件 allow | 🔴 **否** — 闸整个不存在 |

🔴 **note-2 那一格必须单独写出来,因为它拆掉一个想当然**:
```
armed=off 的返回里 【phase 仍然是 'authorization'】(实读 :75)
⇒ ⇒ 🔴 phase='authorization' 【不代表"闸判过了"】
✅ 今天不可利用: allow 分支的 phase 不进 IPC 回执, 只有 deny 分支透传(relay.mjs:368-377)
🔨 ⇒ 记法钉死:【phase 只在 deny 回执上有判别力】。谁将来把 allow 分支的 phase 也透传出去,
     这条判据当场失效 —— 而失效那一刻不会有提示
```

🔨 **⇒ 第一段的对外话术必须跟着收窄**:
```
❌ 不能说:「你被授予了这些, 别的做不了」——(对 internal/operator/legacy 三个 origin 不成立)
✅ 只能说:「凡走【外部 app 凭证】这条路的, 被授予了这些, 别的做不了;
          而系统内部仍有三类【信标签】的通路, 它们的安全性由别处的机制撑, 不由这道闸撑」
```
🔴 **这不是设计缺陷,是【口径必须跟实 enforcement 成熟度走】。** 而外部程序接入走的正是 `app` 那条 —— **所以第一段对"外面的人"的承诺是站得住的,前提是话说准。**

---

## 4. 🔨 probe 套的形状(交付物定义)

### 4.0 🔴 MUST-FIX(NWT)· armed 是**运行前置闸**,不是「读一下写进报告」

**v0.1 我把运行时 armed 真值放在 §5「未知格」,要求"在 probe 运行那一刻读一次并写进报告"。**
🔴 **NWT 指出这不够,而理由是我漏掉的那一层**:
```
b-2 = 【一条 origin 被剥掉的已注册命令】—— 正是我们最想确认"会被拒"的那种
🔴 而 armed=off 时 authorize.mjs:70 在判 origin 之前【无条件 allow】
⇒ ⇒ 那条命令【会真的执行】⇒ probe 自己造成了它本来要检测的那个副作用
🔴 v0.1 §4.2③「事后核那张表没变」能【检出】它 —— 但那是检出, 不是阻止。副作用已经发生
```
🔨 **改法(方向相反,一行)**:
```
probe 套第一步读 armed(get_arm_status 已在 READONLY_ALLOWLIST)
🔴 armed !== true  ⇒  【拒绝运行整套】+ 非 0 退出
✅ armed === true  ⇒  才开跑
```
🔵 **⇒ 「读到并记录」与「读不到就不许跑」是两件事。前者是观测,后者才是闸。** 这正是本仓反复记的那条:**引用一道闸 ≠ 它在闸住东西**——我 v0.1 把 armed 引用成了背景信息。

### 4.1 b-2 用哪条命令(NWT note-1,采纳)

🔴 **v0.1 没指定「已注册命令」是哪条 —— 而这个空格有毒**:
```
最自然的选择 send_message / handshake 要先过【地址校验层】(relay.mjs, 在闸之前)
⇒ probe 会因为【与被测目标无关的理由】失败
⇒ 🔴 而下一个人最可能的"修法"是【把断言放松】—— 那会把 phase 这道唯一判别力拆掉
```
✅ **采纳 NWT 建议:指定 `get_rpc_state`**(或任一 `READONLY_ALLOWLIST` 成员)。

#### 4.1.1 ✅ 而我复核这条建议时核出一格,它给出一个**免费的对照臂**

**Bettor 实读 `authorize.mjs:116-120`**:`READONLY_ALLOWLIST` 的判断在 **`authorizeAppCommand()` 函数体内**,即**只有 `origin === 'app'` 才走得到**;origin 缺失/非法在 `:110` 就被 fail-closed 拒,**永远到不了白名单**。

⇒ **同一条命令,换一个 origin,得到两个不同的 `reason_code`**:

| 请求 | 结果 | `reason_code` |
|---|---|---|
| `get_rpc_state` + **origin 剥掉** | deny | `ORIGIN_MISSING_OR_INVALID` |
| `get_rpc_state` + `origin='app'` | allow | `ALLOWED_READONLY` |

🔵 **⇒ 对照臂不需要另找一条命令,它就是同一条命令的另一个 origin。** 这比 v0.1 §4.2④ 要求的"另造一条必须成功的孪生用例"更强:
```
✅ 两臂【被测对象完全相同】⇒ 排除了"两条命令走的路本来就不同"这个混淆
✅ 且两臂的判别不是"成功/失败", 是【两个不同的 reason_code】⇒ 判别力更高
```
🔴 **而这一格反过来印证了 §4.0 的 MUST-FIX**:若 armed=off,**两臂会返回同一个 `GATE_INERT_ARMED_OFF`** ⇒ 对照臂**同时失效** ⇒ 整套 probe 读数与"闸在工作"无法区分。**armed 前置闸是这套判据成立的必要条件,不是附加项。**

### 4.2 落点

`kasia-console/test-framework/cases/m0c1-gate/seg1-default-deny.mjs`(新增,与既有 `door5-origin-matrix.mjs` 同目录同 runner)。
⚠️ **查资产结论**:既有 9 个 case 里 `door5-origin-matrix.mjs` 覆盖的是**生产 origin 全集**(清单**之内**),g4/g5 是 custodial 真链路。**没有一个覆盖"清单之外"** ⇒ (b) 确实是空的,本设计不重造已有件。

### 4.3 每条 probe 的必备四格(缺一不算 BUST)

```
① 请求本身        —— 完整命令体 + 用了哪个 origin/凭证
② 回执结构化断言   —— phase / reason_code / denied 逐字段, 🔴 不许用 regex 猜日志文本
③ 无副作用证明     —— 该命令若执行会改的那张表/那笔链上动作, 事后核【没变】
                     🔴 NO TX NO STATE: 拒必须发生在 switch 之前(relay.mjs 那句 return 就是它)
④ 🔴 对照臂        —— 同一条命令换成【合法 origin + 合法凭证】必须【成功】
                     没有这一臂, "全被拒"与"这条路整个坏了"读数相同
```

### 4.4 🔴 b-1 移出用例集(NWT 建议,采纳)

```
🔴 一个【绿着的、名字里带 default-deny 的用例】, 迟早被人数进覆盖率
⇒ 🔨 b-1(不存在的能力名)不进用例集, 只写进报告正文, 标明它验的是【命令校验层】
🔵 理由与 §2.3 同源: 它本来就不是 default-deny 的证据, 那就别让它长得像证据
```
🔴 **而 NWT 要求照实说这套有多小,照办**:
```
b-1 已降级为不计入证据 · b-3 依赖一份【还不存在】的枚举(§5①)
⇒ ⇒ 🔴 本轮真正有内容的只有【b-2 一条】
⇒ 不许把"default-deny probe 套已交付"说成第一段 (b) 已闭 —— 它是 (b) 的第一条, 不是全部
```

### 4.5 🔴 对照臂是本设计里最容易被省掉、也最不能省的一格

```
一个 default-deny probe 套若【全绿】, 有两种解释:
   ✅ 闸在正确地拒         ❌ 这条命令通路整个是死的(relay 没起 / IPC 断 / 命令名早改了)
⇒ 两者在"预期拒绝, 实际拒绝"这个判据下【逐字相同】
⇒ ⇒ 所以每条 (b) probe 必须配一条【必须成功】的孪生用例, 证明这条路有功率
```

---

## 5. 🔴 我填不了的格(交给红队/域主,不编)

```
🔴 ① app 路径的拒绝 reason_code 枚举 —— 我没读 app-envelope.mjs 的完整拒绝分支
   ⇒ b-3 的断言值待填。@NWT 审时若已知请直接给; 否则派 J2(该域)列举
🔴 ② 「未授权的表」这一项(验收定义原文第二项)—— 🔴 我判它【不在这道闸的射程内】:
   authorizeCommand 管的是 relay 命令, 不管 Console 侧的 DB 访问
   ⇒ 它需要另一个位置的 probe(或者它根本没有对应的强制点)
   ⇒ 🔴 而如果没有强制点, 正确动作是【说出来】, 不是给它编一个 probe
      —— 参照:证不完的格子先想能不能让它【不存在】, 而不是怎么假装验过
🔴 ③ 运行时 armed 真值 —— 文件层 kanet.env:276 写 =1, 而【活进程未核】
   ⇒ 已派 @KANet-UI 用 get_arm_status 读。🔴 若实测 armed=false, 本设计整套 (b) probe
      会【全部空过】(authorize.mjs:70 armed=off 时无条件 allow, 在判断 origin 之前)
   ⇒ ⇒ 🔴 所以 armed 真值是本 probe 套的【前置闸】, 不是背景信息: 必须在 probe 套运行的
        【那一刻】读一次并写进报告, 不能引用一个更早的读数
```

---

### 5.1 v0.2 对 §5 的更新

```
🔴 ③ 运行时 armed —— 【已升格】: 从"未知格"升为 §4.0 的运行前置闸(MUST-FIX)。
     不再是"读了写进报告", 是"读不到/不是 true 就不许跑"
🔴 ④ 新增(NWT note-3, 归 Bettor 核): Agent Card 那条路【今天确实没有 origin】(NWT 实读)
     ⇒ armed=on 时它会落到 :110 被拒 ⇒ 🔴【arm 那一刻, 发 Agent Card 这条路会断】
     ⚠️ NWT 明确【不】断言批C 漏了它, 只断言"这条路今天没 origin" —— 边界标得对
     🔨 Bettor 待办: 对着批C 清单核一眼它在不在。🔴 而无论在不在, 结论都要写下来:
        · 在清单里 ⇒ 那就是【已知待迁移项】, arm 前必须迁完
        · 不在     ⇒ 那批C 清单本身不完整 ⇒ 🔴 这比单条路由重要得多, 因为清单是 arm 的依据
🔨 ⑤ NWT 另建议(归 relay 域, 独立于本设计): 给 sendCommand 补同一段权威 origin 设置
     ⇒ 立独立卡, 不塞进本设计 —— 本设计是验收 probe, 不是迁移工程
```

---

## 6. 验收(本设计自己的完成定义)

```
✅ b-1 / b-2 各至少一发, 四格齐全, 且 b-1 明确标注【不计入 default-deny 证据】
✅ b-3 待 §5① 填实后补
✅ 每条配对照臂, 且对照臂【实际成功过】(不是"应该会成功")
✅ 报告开头第一行 = 该次运行时读到的 armed 真值 + 读取时刻
🔴 ⇒ 全绿【不等于】第一段验收通过 —— 还要 (a) 的枚举 probe 全 BUST, 二者都齐才算
```

---

## 7. 送审要点(给 @NWT 的攻击面提示,别只审我写对的地方)

```
🔨 ① 攻「§2 那个空过」我判错了没有 —— 去读 relay.mjs 的真实顺序, 别信我的复述
🔨 ② 攻 §3 那张表: 我把 internal/operator 判成"信标签非验证", 依据是代码注释自述。
      🔴 注释是作者的自述, 不是行为证据 —— 有没有可能它实际上做了验证而注释写漏了?
🔨 ③ 攻 §4.2 的④对照臂: 有没有哪条 probe 的对照臂【天然构造不出来】(那说明该 probe 本身有问题)
🔨 ④ 攻 §5② 我那个"不在射程内"的判断 —— 我可能漏了 Console 侧存在的某个强制点
🔨 ⑤ 🔴 攻这份设计【有没有必要】: 按纪律②「开工前先攻要不要做」。
      它对"让外面的 app 接进来"有什么用? 它要砍掉什么? 答不上来就该被砍
```
