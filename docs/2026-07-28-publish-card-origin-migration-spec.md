# publish_card 调用点 origin 迁移 — 改法 spec(未批·零落码)

> **Status**: CURRENT
> 派工:Bettor 2026-07-28(note-3 由 NWT 抓出,Bettor 逐格实核后定 n=1)· 落码 KANet-UI · diff 审 NWT
> 🔴 **本文件是【改法】,不是码。按流程:出改法 → Bettor 批 → 落码 → NWT diff 审 → 装载。**

## 一、要改的那一行

```
kasia-console/src/api/relay.js:1511   const sent = sendCommand(request.params.id, { type: 'publish_card', … });
```
全仓唯一一个用 `sendCommand`(同步版)发的**业务命令**调用点 ⇒ **n=1**。

🔴 **为什么它躲过了枚举**(Bettor 已定性,此处只引不改写):四份权威枚举档按**路由/命令**枚举,
而这一条的特殊性**不在它是哪条路由,在它调了另一个函数** ⇒ 按前者枚举,永远数不到它。

## 二、两个函数的实际差别(实读,不是按名字推)

| | `sendCommand`(:247) | `sendCommandAsync`(:286) |
|---|---|---|
| 返回 | `boolean`(child 存在即 `true`) | `Promise<result>`;无 child 时 **reject** |
| 等不等结果 | **不等**,发出即返回 | 等 relay 回执,默认 **30s** 超时 |
| `__origin` | **不挂** | 由 `origin` 形参**权威设置**,并显式覆写/剥除 command 里夹带的同名字段 |

## 三、🔴 而这次改动**不只是补一个参数** —— 有一格必须先让 Bettor 知道

```
现状: 路由拿到 sent===true 就 return { ok: true }
🔴 而 sent===true 的含义只是【IPC 把命令交给了子进程】——
   它【不表示】卡片上链了, 也不表示 relay 接受了这条命令
⇒ ⇒ 一个身份面的链上动作, 端点在【什么都还没发生】的时候回了 ok
```
🔵 这正是本仓铁律「**NO TX NO STATE CHANGE**」要防的形状:**广播没上链 = 什么都没发生,不准推进状态**。
🔴 **⇒ 所以换成 `sendCommandAsync` 会【顺带修掉一个真 bug】,而这意味着它不是零行为变更**:

```
✅ 改前: 端点立即返回 ok:true(不管链上成没成)
✅ 改后: 端点等 relay 回执 —— 成功才 ok, 失败/超时如实回错
🔴 代价: 该请求会阻塞到最多 30s(发卡是一笔链上 TX)
🔴 影响面: 三个调用方全是【人点按钮】的 UI 路径(agent.eta / agent-v2.eta / relays.eta)
          + 一个脚本(scripts/_onboard-trader-m.mjs)
```

## 四、两个方案,我给推荐但不自己拍

**方案 A(推荐):换 async + 如实回报**
```
const result = await sendCommandAsync(request.params.id, { type:'publish_card', params:{…} }, 30000, 'internal');
成功 ⇒ reply.send({ ok:true, ...result })      // result 里带 txId
失败 ⇒ catch: 'Relay not running' ⇒ 503; 其余 ⇒ 502 + 原始 error 字面
```
- ✅ 拿到 origin(本次派工的目的)
- ✅ 顺带让端点**不再对用户说谎**
- 🔴 用户面行为改变(按钮会转 30s;而现在是秒回一个不作数的成功)⇒ **按铁律 0 属用户面 ⇒ 需 Owner/Bettor 批**

**方案 B(最小):换 async 但保持"不等"**
```
发出后不 await, 立即 return ok:true(用 .catch 吞掉)
```
- ✅ 只拿 origin,零用户面变化
- 🔴 **而它把那个说谎的 ok 原样留着**,并且新增一条"错误被 catch 吞掉"的路径
- 🔴 与本仓两条已记死的纪律直接冲突:**catch 返回合法空值 = 把失败翻译成没有数据**;**NO TX NO STATE**

🔨 **我的推荐是 A**,理由:B 用"零变化"换来的是**把一个已知谎言固化**;而 A 的代价(等 30s)是**如实**的代价。
🔴 **但用户面归 Owner/Bettor 拍,我不自己选。**

## 五、验收判据(落码后 diff 审 + 实测都用这套)

```
① origin 到位:  relay 侧收到的 payload 含 __origin='internal'
   🔴 判据不能只看码 —— 要在 relay 侧实读到那个字段(码里写了 ≠ 传到了)
② 对照臂:      故意不传 origin 跑一次 ⇒ 必须打出 [M0c-1 origin] warn
   ⇒ 证明这条断言有判别力, 而不是"反正都绿"
③ 用户面(仅方案 A):真在页面上点一次发卡按钮, 看到的是 txId 还是错误原文
   🔴 照 UI 红线: 真产品实测过才算 done, 代码对 ≠ 上线
④ armed 前置:  Bettor 已定 —— armed=on 且本条不改 ⇒ publish_card 落 authorize.mjs:110 被拒
   ⇒ 发 Agent Card 这条路会断 ⇒ 本条是 arm 的硬前置, 不是可选项
```

## 六、我填不了的格(不编)

- 🔴 **30s 够不够**:发一张卡的链上 TX 实际耗时我**没测过**。若常态 >30s,方案 A 会把成功也变成超时错误 ⇒ **落码前应先实测一次耗时**,而这一步我还没做。
- 🔴 **`scripts/_onboard-trader-m.mjs` 那个调用方**:它是否依赖"秒回"我没读它的时序假设。
- 🟡 **`sendCommand` 本身要不要留**:Bettor 的方向是「让那个变体不存在」而不是给它补参数。而它是否还有**非业务**用途(如内部控制命令),我**没有全仓核完**——只核到"业务命令里 n=1"。
