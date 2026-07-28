# broker onboarding 落码方案(未批·零落码)

> **Status**: CURRENT
> 派工:Bettor 2026-07-28(batch: 第一段)· owner KANet-UI · 属**用户面 + 身份面** ⇒ 先出方案 → Bettor 批 → 落码 → NWT diff 审 → 真产品实测才算 done
> 设计依据:`docs/2026-07-26-broker-onboard-identity-design.md` v0.6(70b2c55b,Owner 已定调不搞权限分级)
> 🔴 **本文件是方案不是码。** 行号均为**本人实读**核过,非引用设计稿。

## 一、三处改动(设计稿 v0.6 的 ①②③),逐处给精确坐标

### ① 删掉 `bot_token` 必填

```
kasia-console/src/api/kanet-broker.js:270-272   if (!bot_token || …length < 20) { return 400 }   ⇒ 删
kasia-console/src/api/kanet-broker.js:279-291   getMe 校验块                                   ⇒ 包成"仅当提供了 token 才执行"
```
🔵 顺带解掉一条活性:今天 `api.telegram.org` 不可达 = **谁都进不来**(第三方在关键路径上);
改完只影响提供了 token 的人。

### ② `trust_level` 那一列的两个含义拆开

```
kasia-console/src/api/kanet-broker.js:308-318   onboarding 写 identities.trust_level='recommended'  ⇒ 删这一段
kasia-console/src/services/broker-bot-manager.js:73-80  approvedBrokers()                        ⇒ 去掉 trust_level 条件
```
✅ `approvedBrokers()` 保留 `b.bot_token_encrypted IS NOT NULL` —— **它必须留**:没 token 就没有 bot 可 fork,
这一条是**功能前提**,不是信任判断。(设计稿说"只认 `broker_onboarding`",这一条正是 `broker_onboarding` 上的条件。)

### 🔴 ②的涟漪 —— 设计稿没写,是我实读时撞到的,**它会让 UI 当场说反话**

```
【实读】kanet-broker.js:330  const approved = isApprovedTrust(idn?.trust_level)   ← GET 状态端点
【实读】kanet-broker.js:353  status: isApprovedTrust(r.trust_level) ? 'approved' : r.status  ← 列表
```
这两处**也在读那一列**。若 onboarding 不再写它:
```
🔴 新 broker: bot 照常被 fork 起来跑(approvedBrokers 已不看 trust_level)
🔴 而这两个端点会告诉他【未批准】
⇒ ⇒ 系统行为与它对用户的自述【相反】—— 而两边各自都"按代码正确工作"
```
🔨 **⇒ 所以 ② 不是"改两处",是【三个消费者一起改】**,否则修掉一个谎、造出另一个。
**建议**:这两处的 `approved` 改为由 `broker_onboarding` 自身推导(在册 + 有 token ⇒ bot 会跑),
**而"approved"这个词是否还该出现在用户面,归 Owner/Bettor** —— 因为按 v0.6 的定调,**根本不存在审批这件事**,
显示"已批准"本身就在暗示有一道并不存在的门。🔴 **我不自己改文案。**

### ③ `/api/kanet-broker/onboard` 进外部网关白名单

🔴 **这是 ① 生效的前提**:外面调不到这个端点,删掉必填等于什么都没做。
```
前置(NWT 已实跑, 我复核): kanet-broker.js 只导出 registerKanetBrokerRoutes(fastify), 它注册【9 条】路由
   —— 含 POST /api/kanet-broker/bots/stop(停掉任意 broker 的 bot)
⇒ 🔴 白名单 register 字段若直接填那个函数, 九条一起上外网
✅ 必须先把 onboard 抽成单路由注册函数 registerBrokerOnboardRoute(与 chat.js 已有做法一致)
🔵 而填错不会静默: 网关白名单要求【排序后完全相等】不是包含 ⇒ 多出的 8 条会让网关起不来并逐条列出
```
🔴 **③ 动的是对外暴露面 ⇒ 建议 @NWT 单独红队审这一段**,不与 ①② 合并成一个 verdict。

## 二、这次改动【会不会】动到钱

```
✅ 不动: 本次三处都不碰费率/分成/结算/托管钱包
🔴 而它确实降低了"成为 broker"的门槛 ⇒ 谁能进来变了
🟡 库里现有 broker = 1(且是我们自己的托管钱包)⇒ 存量影响面极小
🔴 但"影响面小"不等于"可以少审" —— 它是身份面, 而身份面的错要等有人用了才显形
```

## 三、验收判据(落码后逐条实测,不靠读码)

```
① 不带 bot_token 的 onboard 请求 ⇒ 成功入册
   🔴 对照臂: 带一个【无效】token 的请求 ⇒ 必须仍被 getMe 拒
      (证明"仅当提供了 token 才校验"没有把校验整个关掉)
② 不带 token 入册的 broker ⇒ approvedBrokers() 不返回他(没 token 无 bot 可跑)
   对照臂: 带有效 token 的 ⇒ 必须返回
③ 🔴 identities.trust_level: 新 onboard 之后该地址【不出现】 'recommended'
   对照臂: 该列对【别的来源】仍能被正常写(证明不是整列坏了)
④ 状态端点与列表页显示的东西, 与 bot 实际跑不跑【一致】—— 这一格是 ②涟漪 的验收
⑤ ③ 落地后: 从外部网关口打 onboard ⇒ 通; 打同文件其余 8 条中任意一条 ⇒ 【连不上】
   🔴 对照臂: 打一条已知在白名单里的路由 ⇒ 必须通(证明这次探测有功率)
⑥ 🔴 真产品实测: 在真页面上走一遍自助注册(UI 红线: 代码对 ≠ 上线)
```

## 四、我填不了 / 不打算填的格

- 🔴 **"approved" 这个词的用户面处置** —— 归 Owner/Bettor(见 ②涟漪)。我不自由发挥改文案。
- ~~🔴 **`bot_token` 变可选之后,一个没 token 的 broker 在产品里到底能干什么**~~ → ✅ **已补,见 §五**。
- 🟡 **③ 抽函数会不会碰到别的 import** —— 我只核到"只导出一个注册函数",**没有**核全仓还有谁 import 它。
- 🔴 **顺序**:①②③ 谁先谁后我给的默认是 ③ 最后(它把口开出去)。**若你要先开口再删必填,那中间会有一段"外面调得到但仍强制要 token"的窗口** —— 无害但会浪费一次外部尝试。

---

## 五、补回那格「没有 bot 的 broker 在产品里能干什么」(2026-07-28 实读下游,一好一坏)

### ✅ 好消息:市场详情页**本来就有降级链**,不会造出"注册了但用不了"的 broker

【实读 `kasia-console/src/ui/predictions-pool-detail.eta:575-591`】拿 TG 押注深链的顺序是:
```
① 先取该 broker 自己的 bot_username(/api/kanet-broker/onboard/status)
② 取不到 ⇒ 回落到【平台自己的 tg-bot】(/api/tg-bot/status)
③ 再取不到 ⇒ tgBetLink 保持 null, 页面不显示 TG 入口(不报错、不崩)
```
🔵 **⇒ 一个没有 bot_token 的 broker,他的市场仍然有 TG 押注入口 —— 走平台那只 bot。**
⇒ **我原先担心的"注册了但哪儿都用不了"不成立**,这一格可以从风险清单里划掉。
⚠️ **而它有一个归属上的后果,不是技术问题**:那样的 broker,其下注流量走**我们的** bot,
署名/品牌也是我们的。**这是产品决定不是实现细节 ⇒ 归 Owner/Bettor**,我只把它摆出来。

### 🔴 坏消息:有一句用户面文案会当场变成假话

【实读 `kasia-console/src/ui/broker-home.eta:543-545`】`copyTgLink()`:
```js
const bot = this.onboard?.result?.bot_username;
if (!bot) { alert('该 broker 无 TG bot 用户名·请先填写并提交 onboarding'); return; }
```
🔴 这句话把「没有 bot 用户名」**唯一地**归因成「你还没做完 onboarding」。
而 `bot_token` 变可选之后,**一个已经完整注册好的 broker 也会没有它** ⇒
**系统会叫一个已经注册完的人"去把注册做完"。**

🔵 **⇒ 这与 §一②那个涟漪是同一个病的第二个实例**:
> **一个字段同时被当作【功能开关】和【状态证明】用;
> 当我们把写它的那一处拿掉,所有"读它来推断状态"的地方就开始说假话 —— 而它们各自都"按代码正确工作"。**

🔨 **处置**:文案要改,但**改成什么是用户面** ⇒ 🔴 **我不自拟**。
把两种情形分开是必须的(「还没注册」vs「注册了但没接自己的 bot」),而具体措辞归 Owner/Bettor。

### 🔨 ⇒ 于是本方案的改动面要加一条

原来写的是「三处改动 + ②的涟漪(三个消费者)」。**现在是:**
```
① 删 bot_token 必填 + getMe 改成"仅当提供了 token"
② trust_level 拆两个含义 —— 🔴 三个消费者一起改(approvedBrokers + 两个 UI 状态端点)
③ onboard 抽单路由函数 + 进网关白名单(动对外暴露面 ⇒ 建议 @NWT 单独红队审)
④ 🔴 【新增】broker-home.eta copyTgLink 的文案 —— 用户面, 归 Owner/Bettor, 我不自拟
```
🔵 而**这四条里有三条是同一个根因的下游**:`bot_token` 与 `trust_level` 这两个字段,
各自都被当成了"这个人到哪一步了"的证明,而它们本来只是"他有没有交这个东西"。
