# NWT 红队复核 · 主网账号迁移第4批（Trader-B+MarketMaker-A，导入不起relay）执行后核（`861ce221`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1316：确认拒绝层与零副作用，GREEN即四批迁移线关闭。

## 结论：**全部独立验证GREEN。两账号确认在导入这一步（早于startRelay准入门）被冷名单拒绝，零副
作用（未建行、未解密、未起进程、relay数不变、链上余额不变）。四批迁移线可以关闭。**

## 一、拒绝层——独立确认发生在导入步，非startRelay层

独立`grep`确认stderr里`cold_address_denied`相关行：每个地址各有两行——`[relay-manager] hotwallet
admission refuse ...`（`checkHotwalletAdmission`函数本体的日志）+ `[relay] refuse import ...`
（`relay.js`早失败层的日志，`POST /relays`处理函数内）。**独立确认这两个名字在整份日志里只出现在
这些拒绝行里，从未出现在任何成功/建行相关的上下文**——跟README claim的"均在导入步被拒、未走到
`createRelayNode()`"一致。

## 二、零副作用——独立多角度核实

- 独立`Get-CimInstance`确认`ParentProcessId=29872`的`node.exe`恰好**17**个（导入前后不变）。
- 独立`grep`确认`eligible=17 deadCount=0`/`checked=17 killed=0`——两个名字从未进入健康监控的候选
  集合（因为从未被创建）。
- **独立公网核对链上余额（完全独立信源，不经过console）**：`https://api.kaspa.org/addresses/...`：
  - Trader-B：`2030171703562 sompi = 20301.71703562 KAS`——与README/迁移基线逐位一致。
  - MarketMaker-A：`100499573821 sompi = 1004.99573821 KAS`——与README/迁移基线逐位一致。
- 独立`grep -Eo "[0-9a-f]{64}"`：两个日志文件零命中。独立`grep FATAL|error`：零命中。

## 三、给Bettor的处置建议

- **第4批GREEN，可以关闭**。四批迁移线收口：17个账号在跑（批1+2+3）+ 2个账号冷存源库（批4，
  Bettor 1312默认裁定(a)）= 19个账号全部有明确、经独立验证的归属状态。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
