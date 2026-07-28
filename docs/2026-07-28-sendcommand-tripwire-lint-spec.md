# `sendCommand` 零调用点 tripwire — lint 规则方案(未审·零落码)

> **Status**: CURRENT
> 派工:Bettor 2026-07-28 06:53(删除本体延后到 subset 规则那一批;先用 tripwire 把风险清零)
> owner KANet-UI(lint 域)· 审 NWT
> 🔴 **按本人红线**:新 lint 规则**默认 `warn()` 落码**,NWT diff GREEN 后才单行升 ERROR。
> 🔴 **优先级**:broker onboarding 在它之上,本条不许挤它(Bettor 明令)。

## 一、它要守什么

```
现状: relay-manager.js 的 sendCommand 【零调用点】(publish_card 迁走后)
      而函数本体还在(删除延后 —— 那道 M0a 闸对"收窄 import"没有轻通道, 三轮裁定后 Bettor 定延后)
风险: 就这一件 —— 【有人新写一个调用点】。它不挂 __origin ⇒ 那条命令对 authorize.mjs 不可见
⇒ tripwire 把这一件堵死之后, 函数多活一会儿的风险 = 0, 删除可以等一个不慌不忙的窗口
```

## 二、🔴 而这条规则最难的一格,正是今晚被反复教的那件事

**全仓有一大堆叫 `sendCommand` 的东西,而它们和这个导出【毫无关系】**(我实扫过):
```
kasia-console/scripts/bshard-e2e-run.mjs:94   async function sendCommand(...)   ← 脚本自己的 HTTP 封装
bshard-e2e-flow.mjs / bshard-probe-*.mjs      config.sendCommand / op.sendCommand ← 注入的配置属性
broker-intake-watcher.js / market-seeder.js   _sendCommandOverride              ← 测试注入变量
```
🔴 **⇒ 按名字 grep `sendCommand(` = 一堆误报,而误报会让人把规则关掉。**
🔵 **⇒ 键必须锚在【它是不是那个导出】上,不是锚在名字上**(今晚同族第 N 例:枚举的键必须是"能不能产生那个效果")。

## 三、判据(两条同时成立才算命中)

```
① 该文件的 import 里, sendCommand 来自 relay-manager  —— 用与 m0a-lib 同一套 import 识别, 不新造
② 该文件里存在 sendCommand( 的调用, 且不是 .sendCommand( / $sendCommand( / 函数声明
🔴 ③ 注释行跳过 —— 复用 m0a-lib.mjs:131 那条同款启发(/^\s*(\/\/|\*)/)
   理由: relay.js 现在正好有一句注释提到它(迁移溯源), 不跳过就是第一条误报
```
✅ **当前预期读数 = 0 命中**。🔴 **而"0"必须能被证明有功率** —— 见 §四。

## 四、验收判据(带对照臂,否则这条规则与"没跑"读数相同)

```
① 阴性(现状): 全仓扫 ⇒ 0 命中
🔴 ② 阳性对照【不许省】: 临时在一个 import 了它的文件里写一行 sendCommand(x, y) ⇒ 必须命中
   ⇒ 没有这一条, ①那个 0 与"规则根本没跑"逐字相同
🔴 ③ 误报对照: 拿 bshard-e2e-run.mjs(自己定义了同名函数、且【没有】从 relay-manager import)扫
   ⇒ 必须【不】命中。它是这条规则唯一可能出错的地方
④ 注释臂: relay.js 那句提到 sendCommand 的注释 ⇒ 必须【不】命中
```

## 五、边界(不假装它能做到的事)

```
🟡 它守的是【静态调用点】。若有人 import 后把它塞进一个对象/回调再间接调, 这条规则看不见
   ⇒ 而那与整道 M0a 闸的性质一样(它的键就是 import 字面文本), 本规则【继承】这个弱点, 不新增
   ⇒ 🔴 照 NWT 那条: 这一句要写在规则旁边, 不是写在这份文档里就算数
🟡 它不阻止有人【直接调 child.send】绕过整层 —— 那是另一条边界, 归 NWT 06:29 提的"锚在 child.send" 那条
🔴 而它【不是】删除的替代品: 删除仍要做, 这只是等待期的护栏。谁把 tripwire 读成"这件事已经了结", 那是新的假绿
```
