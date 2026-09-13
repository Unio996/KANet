# NWT 红队复核 · 主网账号迁移 runbook v0.3 + GO-E v0.6 步骤⑧

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`5d51660a`(迁移runbook v0.3) + `d59a1c2c`(GO-E v0.6，含v0.5→v0.6步骤⑧改写)。
> 方法：不读结论就信——独立`diff` `crypto.js`/`wallet.js`(b3711784 vs HEAD)、独立读四处"不落明文"代码路径、
> **用自己的只读连接直接查源库`C:\KANet\kasia-console\data\console.db`**（不是读文档里的数字）核对行数/账号名单，
> **用自己的RPC查询独立复现三个地址的链上余额**（NWT/Trader-B/stress-user-01，跟文档报的数字逐位比对），独立读
> `relay.js:161`删除路由的真实代码确认GO-E⑧改写属实。

## 结论：**GO-E v0.6 步骤⑧ GREEN。迁移runbook v0.3 五点审点全部PASS(含多项独立复现，非转述核对)，但有一条我判MUST-FIX(console重启期间自动拉起的残余风险不能只靠"操作纪律不重启"兜底)+两条1134-补要求的收尾(两层准入写进执行步骤/分批表加引用)尚未体现在这版，需要一次收尾修订才能视为完整**

## 一、GO-E v0.6 步骤⑧——GREEN

独立读了`relay.js:161-164`的当前代码：
```js
fastify.post('/relays/:id/delete', async (request, reply) => {
  deleteRelayNode(request.params.id);
  return reply.redirect('/relays');
});
```
**零`console.log`，`reply.redirect`无JSON body**——跟文档"凭调用后的空SELECT判定成功，不凭响应体"这条描述逐字
吻合。`deleteRelayNode()`（`relay-nodes.js:70-75`）内部只是两条`DELETE`（先清`skills`表FK依赖再删`relay_nodes`
本行），不打印任何字段、不碰其它relay——这条我在上一轮(v0.5审)已经独立核过，这次重新核对没有变化。步骤⑧改写
准确、`scripts/relay-delete-row.mjs`规格确实已撤（`grep`确认全仓不存在这个文件）。**GREEN**。

## 二、迁移runbook v0.3 —— 五审点逐条独立核验

### ①加密兼容性——PASS，独立diff确认

自己`git show b3711784:.../crypto.js`跟当前HEAD`diff`：`encrypt()`/`decrypt()`函数体**逐字节相同**，唯一差异是
新增了一个跟加解密无关的`currentKeyFingerprint()`。`wallet.js`同样`diff`：BIP44派生路径(`m/44'/111111'/0'/0/0`)
→32字节私钥提取→地址生成的**核心逻辑逐字节相同**，只是被抽成内部`derivePrivKeyHex()`供别处复用，`mainnet`分支
行为不变。**这条不是读文档信的，是我自己独立diff出来的结论跟文档结论一致**。**PASS**。

### ②③逐行验证+不落明文——PASS，四处代码路径独立读过

`index.js:151` `Fastify({logger:false,...})`——独立确认。`/relays`端点唯一的`console.log`只打印`name`
(`[relay] Auto-setup...`)，不含mnemonic字段——独立读过整个handler确认没有第二处日志。`createRelayNode()`
（`relay-nodes.js:22`）：`mnemonic ? encrypt(mnemonic) : null`——明文一进函数体就立即加密，独立确认逻辑上
明文从未在这个函数之外的任何地方以变量形式停留。全局错误处理器（`index.js:168`）：`console.error('[ERROR]',
error.message, ..., error.stack...)`——独立确认不触碰`request.body`。**四处独立核实，跟文档描述一致，PASS**。

### ④对账基线——**PASS，独立查源库+独立查链复现，不是读文档数字**

**没有相信文档报的数字**——用只读连接直接连`C:\KANet\kasia-console\data\console.db`自己查了一遍：
`network='mainnet'`共**20行**，**19行**同时有`address`+`mnemonic_encrypted`（`Opus`两者皆空）——跟文档§1.3的
名单**一字不差**（19个名字逐一核对：J2/NWT/KANet-UI/Trader-B/Trader-A/Qclaude/Trader-M/Bettor/MarketMaker-A/
8个stress-user/2个stress-control）。

**独立查了三个地址的链上余额**（自己的RPC调用，不是读文档表格）：
```
NWT            540.15205663   (文档: 540.15205663)  完全一致
Trader-B     20301.71703562   (文档: 20301.71703562) 完全一致
stress-user-01  0.494605      (文档: "各≈0.49-0.50")  落在声明范围内
```
**逐位数字完全一致，不是"差不多对得上"**。§1.4"旧库无`privkey_encrypted`列"这条我用一个失败的query反向确认了
（我自己第一次查询漏了这个列，SQLite直接报`no such column`——独立复现了这个schema事实，不是抄文档）。**PASS**。

### ⑤分批策略——PASS(NWT行裁定落地准确)，但两处1134-补要求的收尾未体现在这版

**NWT行裁定**：v0.3把v0.1那条留白改写成"归为'有资金档，不列冷、不并入验证批'，等2-1硬上限落地后按上限判断，
最终Owner拍"——跟Bettor 1134转给我的原话一致，措辞没有走样（没有提前下"导"或"不导"的结论）。**PASS**。

**但两处Bettor 1134-补要求的东西，这版还没写进去**（不是这版写错了，是还没轮到这版去改——1134-补跟这次审点
是同一批发给我的，KANet-UI在v0.3落笔时大概率还没看到）：
1. **分批表顺序跟我2-1规格§7的三档顺序（stress→≤21.5小额→NWT，冷不进任何批次）实质上已经一致**——不需要
   重排，但目前runbook自己没有引用我那份规格的具体章节号，建议加一句显式引用（`docs/2026-09-14-nwt-mainnet-
   relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md §7`），不是内容错，是可追溯性的小缺口。
2. **两层准入（导入端点早失败+`startRelay()`准入门）目前完全没有写进runbook的执行步骤**——runbook§6只有一句
   "任何一批转常驻前仍要满足2-1规格...本页不重复展开"，这是**引用**不是**集成**。这条我判需要在下一版里明确
   写成执行步骤的一部分（见下节MUST-FIX，这条跟MUST-FIX是同一个技术问题的两个角度：一个是"现在缺"，一个是
   "为什么现在缺是真实风险不是形式问题"）。

## 三、我自己发现的一条MUST-FIX——"导入期间不重启console"这条操作纪律不足以兜底

runbook §4自己已经诚实地写了这条：**如果导入期间console意外重启一次，`startAllRelays()`仍然会把所有新导入的
行拉起来**（`RH_OFF`只管30秒cron，不管开机无条件的`startAllRelays()`），给出的应对是"导入这批账号全程不重启
console"。**这条我判不够，理由**：

1. **这是操作承诺，不是机器强制的控制**——跟GO-E系列反复确认过的"充得少≠天然上限"是同一类问题：这个环境是
   **多智能体共享同一台机**（Bettor/J2/KANet-UI/NWT/J1都能独立操作这台机器），执行导入的操作员承诺"不重启"，
   约束不了**另一个不知道导入正在进行的会话**去重启console做别的事（部署、修复、routine ops）——这不是假设性
   担忧，本会话历史上console被意外重启过好几次（GO-C/GO-D系列反复处理过这类事故）。
2. **正确的技术兜底是：我那份2-1规格的`startRelay()`准入门(冷清单+per-relay+总额三条检查)必须在这次迁移的
   第一行导入之前就已经部署并生效**——不是"以后转常驻前"才需要，是**现在，第一批stress账号导入之前**就需要。
   理由：一旦这三条检查真的钉在`startRelay()`里，即便console意外重启、`startAllRelays()`把新导入的行都拉起来，
   **每一行会不会真的被拉起、拉起后风险敞口有多大，都被per-relay/总额上限卡死在Owner已经接受的范围内**——
   "不小心重启"这件事从"可能造成任意敞口"降级成"敞口被机制盖了顶"，这才是真正的兜底，不是靠承诺不犯错。
3. **具体要求**：`RELAY_HOTWALLET_COLD_ADDRESSES`/`RELAY_HOTWALLET_PER_RELAY_MAX_KAS`/`RELAY_HOTWALLET_TOTAL_MAX_KAS`
   三个env + `startRelay()`的检查代码，必须在**任何一行**（含stress账号）导入之前落地生效，不能等到"要常驻"
   才补——这条我把它从"另一件独立待办"提升为"这次迁移的前置阻断条件"。

## 四、其余记档

- runbook §1.1自己点出`console.db-shm`mtime是今天、可能有进程仍持有连接——**这条我认可需要在执行前解决，
  不能带着"不知道谁在连"的状态就开始导入**，建议列为执行前检查清单的第一项（不是脚注）。
- §6提到"如果需要人工排查mismatch行，走Owner单独受控信道核对，不进本仓任何脚本输出/日志/文档"——这条纪律
  跟本会话GO-B/GO-E系列一贯的"密钥不进agent视野"原则一致，认可。

## 五、给Bettor的处置建议

- **GO-E v0.6 ⑧ GREEN**。
- **迁移runbook v0.3 五点PASS**（含多处独立复现：diff/查源库/查链余额，不是核对转述）。
- **一条MUST-FIX**：2-1规格的`startRelay()`三条准入检查必须在**第一批（含stress账号）导入之前**部署生效，
  "全程不重启console"这条操作承诺不能单独作为兜底——这条我把它从"另一件独立待办"提升为这次迁移的前置阻断
  条件，不是可以并行推进的两件事。
- **两处收尾**（非阻塞但要补）：分批表加一句引用我2-1规格§7；把两层准入写成runbook执行步骤的一部分而不是
  一句引用——这两条我理解KANet-UI大概率还没来得及处理（1134-补跟这次审点同批发出），下一版补上即可，
  不需要因为这两条推翻已经PASS的五点。
- `console.db-shm`持有者身份未查这条建议提升为执行前检查清单第一项。
