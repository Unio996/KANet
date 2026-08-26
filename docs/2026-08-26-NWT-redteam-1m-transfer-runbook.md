# NWT 红队 — 1M KAS→J1 转账 runbook

> 作者 NWT(攻击审/关3/红队)· 2026-08-26 · 派工 Bettor(对等消息)· 被审 = `docs/2026-08-26-kanet-ui-1m-to-j1-transfer-runbook.md`(ac955242 + P1b/P1c,HEAD)
> 钱路 + Owner 令 + Bettor 执行前置闸。**default = 试图找一条能双发/部分落链/误报已落的路,找不到才 PASS。** 所有代码断言在 HEAD 逐处 `sed -n` 核过(非信 runbook 文本;runbook 是 d5a82648 时读的,我核的是当前 HEAD)。
> **总评:runbook 扎实,但第①点我找到了 Bettor 要的第三条双发路(承重,须补),②③是 PASS-with-note,④定位到 P2。**

---

## ① 双发险:第三条路 = **console 重启孤儿化在跑的 relay 子进程**(承重·须补 runbook)

Bettor 已 grep 关掉两条(console 层无 retry、relay 层重试不跨 submit)。我逐处核实了这两条**成立**,然后去找第三条,**找到了**。

### 1.1 前两条我复核成立 `[SRC HEAD 复核]`
- `/transfer` handler(`relay.js:511-527`):**单个 `sendCommandAsync`,无 retry 包装**,30s 默认超时,error 直接回 400/500。✅
- `sendCommandAsync`(`relay-manager.js:291-323`):30s timer 只做 `removeListener + reject`,**无重发、无 dedup、无幂等键**(requestId=`req-<ts>-<rand>` 每次全新)。✅
- relay 层 `_sendKaspaInner`(`transaction.mjs:231-239`):唯一重试 = `submittedTxIds.length===0 && !_isRetry && WS 断线` ⇒ 重连后重跑;**任何 tx submit 后绝不重试**(`:241` 抛 partial)。`withSendLock`(`:135`)同进程串行。✅
- **另核两条 runbook 没提但我查了**:①`transferAndConfirm`(`relay-manager.js:367`)是 transfer + poll check_utxo_landed 的 wrapper,**poll 的是只读 check_utxo_landed,不重发 transfer** —— 不是双发路(且 `/transfer` 用的是裸 `sendCommandAsync` 不走它)。②relay.mjs 启动**无 transfer replay/resume**(IPC 命令在内存,重启即丢、不重放;`grep pending_actions|resume|replay` 只命中会话 relation_states 去重,与 transfer 无关)—— 排除"重启自动重放"这条自动双发。

### 1.2 第三条路(承重发现)`[SRC HEAD 复核]`
**机制链:**
1. relay 子进程 = `fork('src/relay.mjs', {stdio:[...,'ipc']})`(`relay-manager.js:95`),**`detached` 缺省 = false**。
2. `child.on('exit')`(`:127`)**只做 `delete _relays[id]`,无 auto-restart** —— console 不会在转账中途自发重启一个 relay 子进程(排除 Bettor 猜的"supervisor 自愈重启 relay 子进程"这个**内部**子路:console 内部没有这个逻辑)。
3. **但外部 console 重启会孤儿化它**:console-supervisor 判 console 死 → headless `Stop-Process -Id <console> -Force` + 杀 pidfile。**Windows `Stop-Process` 不 tree-kill 子进程**(无 job object 级联),`fork(detached:false)` 的子在 Node 里也**不随父退出自动死**。⇒ **正在执行 1M 转账的 relay 子进程(3568)被孤儿化,继续跑完 getServerInfo→build→sign→submit→广播,1M 照样上链。**
4. 🔴 **孤儿的 TRANSFER 日志行丢了**:relay 子的 stdout 经 `stdio:'pipe'` 管到**旧 console** 再转写进 `logs/console.log`(`relay-manager.js:113`)。旧 console 一死,**这根管子断,孤儿之后打的 `TRANSFER … TX: <txid>` 行到不了 `logs/console.log`**。
5. ⇒ **T2(c) 的第一判据"`grep TRANSFER logs/console.log` 有没有新行"在 console 重启后【瞎】** —— 孤儿广播了,但日志里没有。若操作员按 runbook 把"没有新日志行"读成"没广播",→ 重发 → **2M**。

### 1.3 双发不自我保护(加重)`[SRC]`
有人会想"同一 UTXO 花两次会被双花拒,所以顶多一次成"。**不成立**:
- 源若是单个 mega-UTXO(623 记 10.8 亿单 UTXO):孤儿花 mega-UTXO ⇒ 1M→J1 + change(10.79 亿)回源。新子进程(重启后 re-spawn)重读 UTXO —— 孤儿的 `markUtxoSpent`(`transaction.mjs:236`)在**死进程的内存里**,新进程看不到 ⇒ 它选到那个**change UTXO**(或 RPC 尚未更新时选到同一 mega,撞双花被拒是运气)⇒ **第二笔 1M 从 change 里又发一次 = 真 2M**。
- ⇒ **双花保护只在"两笔恰好选同一 input"时生效,输入拓扑一变就漏**。不能靠它。

### 1.4 修法(须写进 runbook,承重)
- 🔴 **T2(c) 判据升级:凡 T1→T3 之间发生【任何 console 重启】(P2④ supervisor log 有 restart / console PID 变 / 心跳断过),`grep logs/console.log` 的日志证据【作废】** —— 孤儿的 stdout 已随断管丢失。**此时"是否已广播"的唯一权威 = 链读**(`getUtxosByAddresses([J1])` 找 `outpoint.transactionId==txid` 或直接看 J1 是否已有 1M UTXO;txid 未知时看 J1 地址是否新出现 1M 输出)。
- 🔴 **把链读从"fallback"提为"authoritative"**:runbook 现在 T2(c) 是"先 grep 日志→没有再等→再链读"。改为:**timeout 后第一权威动作 = 链读 J1**(日志只作辅助,且重启后不可信)。链上有 1M(哪怕 0-conf)= 已广播,绝不重发;链上确无 + 日志确无 + 无 console 重启痕迹,才是"真没发"。
- 🔵 **降概率(非承重)**:P2 已尽量保证起手 console 健康;可补一条"T1 后到 T3 前,KANet-UI 持续盯 console PID / 心跳,一旦变即广播 Bettor 冻结重发决策"。真正的防线是上面的链读-authoritative,不是降概率。
- 📌 **根治级(超出本 runbook,记一条)**:转账命令无幂等键 = 这一族的根。若日后做,relay 侧对 `{target,amount}` 在短窗内加一次性 nonce/去重(与 comm dedup 不同域),孤儿+新子就算都收到也只广播一次。**本次不改码,靠流程 + 链读兜。**

---

## ② G2 不满足 → 多笔形态与部分落链 `[SRC HEAD 复核]` — PASS-with-note

`transaction.mjs:190-201` 复核:
- `minSafeUtxo = amount + amount×65/100 + FEE_RESERVE_BASE`;`entries.sort(升序)`;`safeEntry = find(≥minSafeUtxo)`。有 ⇒ `selectedEntries=[safeEntry]`(单输入)。**无 ⇒ `selectedEntries` 保持 = 全部 entries**(`else` 注释"use all entries")。
- `:213` Generator(全部 input,一个 `PaymentOutput(J1,1M)`,change 回源);`:222-228` `while(generator.next())` **逐笔 sign+submit,push txId** —— **Generator 可产出多笔**(输入太多、单 tx 超 mass/size 时切成 compound 交易树)。
- `:241` 若 `submittedTxIds.length>0` 后失败 ⇒ 抛 partial(带已提交 txid 列表)。

**部分落链的真形态(比 runbook 说得更精确)**:compound 树里,`PaymentOutput(J1,1M)` **只在树的最后一笔**;中间笔全是**source→source 的 change 归并**。⇒ 部分失败 = 中间归并笔落链(**钱没离开源地址**,只是 UTXO 重组),**J1 拿到 0**。
- 🟢 **好消息**:这**不是丢钱**(中间笔的钱都还在源地址),且 **check_utxo_landed(J1, 中间txid) 会正确回 landed:false**(见 ③ 双锚)——中间 txid 不在 J1 名下。所以"把中间 txid 误当成付款成功"这条被双锚挡住。
- 🔴 **仍须 STOP**:partial 状态下源地址 UTXO 拓扑被搅乱(多了归并 change),**再发一次要重新评估 G1-G4**;且 partial 的多 txid 容易被人误读。runbook 的 **G2=STOP+先 consolidate** 是对的,保留。
- 🔵 **note**:runbook 说"G2 没有 ⇒ 失控形态",精确化为"钱不丢但 J1 拿 0 + 拓扑搅乱";consolidate 先做仍是正解。

---

## ③ check_utxo_landed 双锚 + reorg `[SRC HEAD 复核]` — PASS

`p2sh.mjs checkUtxoLanded(address, txid, networkId, minDepth)` 复核:
- **txid+address 双锚:是。** `getUtxosByAddresses([address])` → `find(e => e.outpoint.transactionId === txid)`。UTXO 必须**同时**在 `address` 名下 **且** 出自 `txid`。⇒ 中间归并 txid 对 J1 地址查 = 找不到 = landed:false(②的保护来源)。✅
- **reorg 安全:是。** `depth = virtualDaaScore − blockDaaScore`;`depth < minDepth(20) ⇒ landed:false`(继续 poll)。UTXO 落了又被 reorg 退 ⇒ 下次 `getUtxosByAddresses` 找不到 ⇒ landed:false。**不会有"落过就永久报已落"的假阳。** ✅
- **fail-closed:是。** `blockDaaScore` 读不到(4 级 fallback 全 null)⇒ `landed:false, depth:null`,不赌。✅
- 🔵 **note(verify-value-source 边角)**:`virtualDaaScore` 来自**这条 relay 连接的** `getBlockDagInfo`。若该 relay 的 kaspad 落后,virtual 偏小 ⇒ depth 偏小 ⇒ 顶多"更晚才判 landed"(安全方向),不会假阳。P1 已 gate isSynced,T3 在同步后跑,OK。
- 🔴 **叠加①**:T3 的链读是双发防线的最后一环,**它必须由 KANet-UI 第五 vantage(直连 kaspad,不经 console)独立跑一遍** —— runbook 已写(T3 两眼),保留;结合①,console 重启时这只**不经 console 的眼**是唯一可信的。

---

## ④ P1–P8 里"看着在闸、实际读不到值"的(verify-value-source) — **= P2③(+P2②)**

逐条追 P1-P8 的 Y 来源:
- **P2③ `events` 表 `rpc_health_check_failed` 的 `max(created_at)` 须早于 P1 通过 ≥10min** = 🔴 **fail-open,green-light-carries-no-information**。它读的是**"最近没有失败被记"**,而这**分不出**「健康(没失败)」与「写失败记录的那个 health-check 本身死了(所以也没新失败)」。监控一停,这个闸自动"变绿"。**这是最典型的 verify-value-source 违反:读的是"失败的缺席"而非"健康的在场"。** 同族记忆 `reference-channel-verified-receipt-reads-local-db-not-chain`(读本地 DB 的绿 ≠ 真相)。
- **P2② `get_rpc_state`(IPC)** = 次一等:读的是 **relay 子进程【自报】的 RPC 态**。WS 半开(自以为连着、实际死)时它照报 ok。**自报不是地面真相。**
- **对照:真正读到权威 binding 的只有两处** —— ①P1 的 `kaspad-rpc-probe`(独立直连节点,是 positive probe 不是 absence);②**执行时** `transaction.mjs:149 if(!isSynced) throw`(relay 自己在广播前一刻从 getServerInfo 取的 isSynced,是唯一"到手才算"的运行时闸)。⇒ **P1/P2 是【建议性】前置,真正兜底的是执行时 :149。**
- 🔵 **note**::149 只 gate isSynced,**不 gate utxoindex 可用**(F-B:isSynced 可 true 而 utxoindex 空)。但这条**失败向安全**:utxoindex 空 ⇒ entries=[] ⇒ totalBalance=0 ⇒ `:191 Insufficient balance` throw ⇒ **不广播**。所以"isSynced 真、utxoindex 假"的转账会被"余额不足"安全挡下,不会误发到错地方。P1b/P1c 在**判据层**再挡一次(别让操作员据空集读数做决策)。
- **修法**:P2 应至少有一条**positive 独立探针**(P1 的 probe 已经是),**别把 P2③ 的 absence 当健康闸** —— 把 P2③ 降为"辅助信号",P2 的 PASS 判据锚在 P1 的 positive probe + :149 运行时闸上。

---

## 交付判词
| 点 | 结论 |
|---|---|
| ① 双发第三路 | 🔴 **承重发现**:console 重启孤儿化在跑 relay 子 → 广播照做但日志行随断管丢 → T2(c) 日志判据瞎 → 双花不自我保护(拓扑变即漏)⇒ 2M。**修**:console 重启后日志证据作废,链读 J1 升为 authoritative(非 fallback);根治级 = 转账幂等键(超本 runbook)。 |
| ② G2 多笔 | 🟢 PASS-with-note:部分失败是 source→source 归并落链(**钱不丢、J1 拿 0**),双锚挡住"中间 txid 当付款";G2=STOP+consolidate 保留。 |
| ③ check_utxo_landed | 🟢 PASS:txid+address 双锚、minDepth20 reorg 安全、fail-closed 全成立。结合①,须由不经 console 的第五 vantage 独立跑。 |
| ④ verify-value-source | 🔴 **P2③**(rpc_health_check_failed 的 absence = fail-open 绿灯无信息)+ P2②(self-report);真闸在 P1 positive probe + 执行时 :149 isSynced。**别拿 P2③ 当健康闸。** |

**总 verdict:runbook 方向对、G2/G3/落链双眼/T2(c) 不重试骨架都对,但①是执行前必补的承重缺口。** 补上①的"console 重启⇒日志作废⇒链读 authoritative"+ ④的"P2③降辅助、锚 positive probe",这份 runbook 可支撑执行。**未补①前,若执行期间 console 抖过一次,双发风险实存。**

## 附:复核命令(只读)
- `sed -n '511,527p' kasia-console/src/api/relay.js`(/transfer 无 retry)
- `sed -n '291,323p' kasia-console/src/services/relay-manager.js`(sendCommandAsync 无 dedup)
- `sed -n '95,130p' kasia-console/src/services/relay-manager.js`(fork detached:false + exit 只 delete)
- `sed -n '185,249p' kasia-relay/src/lib/transaction.mjs`(G2 选择 + 多笔 submit + partial)
- `checkUtxoLanded` full in `kasia-relay/src/lib/p2sh.mjs`(txid+address 双锚 + depth)
