# NWT 红队复核 · 主网迁移第1批(stress)执行证据(`a1c04ef1`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1182：按五点独立核（探针302+reason+行未插入；10行地址/余额比对，余额自己查链；拉起数；
> tick/events；日志无密钥材料），并查`cold_address_denied`出现2次的第二次是什么。

## 结论：**GREEN。全部独立复现，10/10地址+余额逐字对上；`cold_address_denied`两次是同一次探针
在两个不同代码层各打了一行日志，不是第二次独立拒绝事件。**

## 一、探针302+reason+行未插入——独立确认

- 只读查`relay_nodes`：`name LIKE 'zzz-admission-probe-%'`计数**0**——独立确认（不是读页面转述）。
- `events.hotwallet_relay_killed`计数**0**——独立确认。

## 二、`cold_address_denied`出现2次——查清第二次是什么

`console.warn`写的是**stderr**不是stdout（Node.js既有行为），先在stdout里搜索得到0命中，改搜stderr
命中恰好2行：
```
[relay-manager] hotwallet admission refuse kaspa:qrxw...(Trader-B地址): cold_address_denied
[relay] refuse import "zzz-admission-probe-1789332136552" (kaspa:qrxw...同一地址): hotwallet admission cold_address_denied
```
**两行来自同一次探针调用，不是两次独立拒绝事件**——第一行是`checkHotwalletAdmission()`函数内部自己的
warn（`relay-manager.js`），第二行是`relay.js:105`调用方在拿到`admission.ok=false`之后**自己另打的
一行warn**（两处warn是两个不同的log语句，各自独立存在于代码里，本会话此前审`a65c28dc`/`39ae30b1`时
已经读过这两行的位置）——同一个探针名字(`zzz-admission-probe-1789332136552`)、同一个地址在两行里逐字
出现，确认是一件事被两层各记了一笔账，不是又拒绝了别的什么候选。**结论：符合预期，不是异常。**

## 三、10行地址/余额比对——独立查链，不读页面数字

只读`relay_nodes`确认10行全部存在、地址逐字与证据页表格一致、`mnemonic_encrypted IS NOT NULL`。
**自己直接连mainnet kaspad(`ws://127.0.0.1:17110`)对10个地址跑`getBalancesByAddresses`**：10个数值
**逐一**跟证据页表格完全一致，合计`4.98498280 KAS`跟证据页总数完全一致——**这是我自己独立查链得到的
数字，不是读证据页信的**。

## 四、拉起数——独立核过程树

`Get-CimInstance Win32_Process -Filter "ParentProcessId=15396"`：**恰好10个`node.exe`子进程**，全部
`CreationDate=2026-09-14 03:42:53`（同一时刻）——独立确认，跟证据页描述一致。

## 五、tick/events——独立grep日志

`relayHealthMonitorTick`序列：导入后第一次tick`eligible=10 deadCount=10`（刚导入还没启动），随后连续
多次`eligible=10 deadCount=0`（全部启动且保持存活）——独立grep确认这条转变序列，不是读页面转述。
`relayHotwalletMonitorTick`：多次`checked=10 killed=0`（我这次观察窗口比Bettor地面核时更晚，看到10次
而不是7次，是时间往后推进的自然结果，不是数字不一致）。stdout+stderr全文grep`FATAL`0命中。

## 六、日志无密钥材料——独立grep确认

stderr全文grep`mnemonic`0命中；已读过`relay.js`/`crypto.js`相关代码路径（本会话此前审执行页时已确认
只打印`name`/`address`，从未interpolate密钥内容），这次日志实际产出跟代码审查结论一致。

## 七、给Bettor的处置建议

- **GREEN，可以进第2批**。
- 一个不阻塞的小提醒：这次证据页没有像之前"主网热钱包部署证据"那样留一份独立的日志文件副本进
  `docs/provenance/`目录（只有README.md，日志引用的是活动中的`logs/mainnet/`原文件）——活动日志会
  被下次重启覆盖，如果以后要回查这次的日志证据会找不到。建议以后每批证据页都跟着留一份日志副本，
  跟部署证据页的做法保持一致，不是本批的问题，是往后的建议。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
